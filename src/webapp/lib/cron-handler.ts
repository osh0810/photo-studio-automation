/**
 * Phase 3 Cron 핸들러 — 누적된 톡톡 메시지를 사용자별로 잠금 → 배치 처리.
 *
 * 이번 Step 3 범위:
 *   - 좀비 잠금 복구
 *   - pending 사용자 조회 (debounce 10초)
 *   - 사용자별 직렬 잠금
 *   - placeholder processBatch (Step 4에서 실 구현)
 *   - 결과 반영 (성공: done_ai / 실패: pending 롤백)
 *
 * processing_status 값:
 *   - pending     : 처리 대기 (sender_type='customer')
 *   - processing  : 본 핸들러가 잠금 후 처리 중
 *   - done_ai     : AI 처리 완료 (Step 4-5에서 실제로 set)
 *   - done_echo   : webhook 단계에서 작가님 echo로 자동 종료
 *   - echo        : 작가님 본인 echo INSERT 시점
 */

import type { Env } from '../../types';
import { loadCustomerContext, type MilestoneKey } from './customer-context';
import { matchLearnedRule, incrementRuleApplyCount } from './rule-matcher';
import { analyzeWithAI } from './batch-analyzer';
import { executeRecordMilestone, type MilestoneType } from './ai-tools';
import {
	createAutoRuleMessage,
	createRuleConfirmMessage,
	createAiAutoMessage,
	createAiConfirmMessage,
	createDuplicateMessage,
	createOverflowMessage,
} from './system-message-builder';
import { countTodayAICalls } from '../handlers/chat-api';
import { sendPushNotification } from './push-sender';
import type { CustomerContext } from './customer-context';

// ─── 타입 ──────────────────────────────────────────────────────────────

export interface TalkMessageRow {
	id: number;
	talk_id: string;
	sender_type: 'customer' | 'studio';
	message_content: string | null;
	image_url: string | null;
	message_at: string;
	received_at: string;
	processing_status:
		| 'pending'
		| 'processing'
		| 'done_ai'
		| 'done_echo'
		| 'echo';
	ai_chat_message_id: number | null;
}

type CronEnv = Env & { CRON_BATCH_LIMIT?: string };

// ─── 상수 ──────────────────────────────────────────────────────────────

const ZOMBIE_THRESHOLD = '-30 minutes';
const DEBOUNCE_THRESHOLD = '-10 seconds';
const DEFAULT_BATCH_LIMIT = 10;
const USER_PROCESS_TIMEOUT_MS = 15_000;

// ─── 좀비 잠금 복구 ────────────────────────────────────────────────────

async function recoverZombieLocks(env: CronEnv): Promise<number> {
	const result = await env.DB.prepare(
		`UPDATE talk_messages
		 SET processing_status = 'pending'
		 WHERE processing_status = 'processing'
		   AND strftime('%Y-%m-%d %H:%M:%S', received_at) < datetime('now', ?1)`,
	)
		.bind(ZOMBIE_THRESHOLD)
		.run();
	return result.meta?.changes ?? 0;
}

// ─── pending 사용자 조회 (마지막 메시지 후 10초 경과) ──────────────────

interface PendingUser {
	talk_id: string;
	last_msg_at: string;
	msg_count: number;
}

async function findPendingUsers(env: CronEnv, limit: number): Promise<PendingUser[]> {
	const result = await env.DB.prepare(
		`SELECT talk_id, MAX(message_at) AS last_msg_at, COUNT(*) AS msg_count
		 FROM talk_messages
		 WHERE processing_status = 'pending'
		 GROUP BY talk_id
		 HAVING strftime('%Y-%m-%d %H:%M:%S', MAX(message_at)) < datetime('now', ?1)
		 LIMIT ?2`,
	)
		.bind(DEBOUNCE_THRESHOLD, limit)
		.all<PendingUser>();
	return result.results || [];
}

// ─── 잠금: pending → processing ───────────────────────────────────────

async function lockUserMessages(env: CronEnv, talkId: string): Promise<number[]> {
	const result = await env.DB.prepare(
		`UPDATE talk_messages
		 SET processing_status = 'processing'
		 WHERE talk_id = ?1 AND processing_status = 'pending'
		 RETURNING id`,
	)
		.bind(talkId)
		.all<{ id: number }>();
	return (result.results || []).map((r) => r.id);
}

// ─── milestone_type 변환 ──────────────────────────────────────────────

const DEFAULT_DAILY_LIMIT = 200;

// ─── 푸시 발송 디스패처 ────────────────────────────────────────────────

async function dispatchPush(
	env: CronEnv,
	context: CustomerContext,
	msgId: number,
	requiresConfirmation: boolean,
	confirmText?: string,
): Promise<void> {
	if (!env.ALLOWED_EMAIL) {
		console.log('[batch] push skip — ALLOWED_EMAIL 미설정');
		return;
	}
	const targets = context.talk_history.filter((m) => m.is_target);
	const firstMsg =
		(targets[0]?.message_content || '').slice(0, 80);
	const customerLabel =
		context.customer.customer_name ||
		`미등록(${context.customer.talk_id.slice(0, 12)}...)`;

	const title = requiresConfirmation
		? `❓ ${customerLabel} 확인 필요`
		: `${customerLabel} 새 메시지`;
	const body = requiresConfirmation && confirmText
		? confirmText.slice(0, 150)
		: firstMsg;

	try {
		const result = await sendPushNotification(env as any, env.ALLOWED_EMAIL, {
			title,
			body,
			data: {
				chat_message_id: msgId,
				talk_id: context.customer.talk_id,
			},
			tag: `talk_${context.customer.talk_id}`,
			requires_confirmation: requiresConfirmation,
		});
		console.log(
			`[batch] push 발송: sent=${result.sent}, failed=${result.failed}`,
		);
	} catch (err) {
		console.error('[batch] push 발송 실패 (무시):', err);
	}
}

function milestoneKeyToType(key: MilestoneKey): MilestoneType {
	// shoot_date는 _at 미포함 + ai-tools의 enum은 'shoot' — 별도 매핑.
	if (key === 'shoot_date') return 'shoot';
	return key.replace(/_at$/, '') as MilestoneType;
}

// ─── 배치 처리 본체 ────────────────────────────────────────────────────

async function processBatch(
	env: CronEnv,
	talkId: string,
	pendingMessageIds: number[],
): Promise<{ ai_chat_message_id?: number; error?: string }> {
	console.log(
		`[batch] processBatch start talk_id=${talkId} target=${pendingMessageIds.length}건`,
	);

	try {
		// 1. 컨텍스트 로드
		const context = await loadCustomerContext(env, talkId, pendingMessageIds);

		// 2. 학습 규칙 매칭
		const ruleResult = await matchLearnedRule(env, context);

		if (ruleResult.matched) {
			console.log(
				`[batch] 학습 규칙 매칭 → rule_id=${ruleResult.rule_id} rule_type=${ruleResult.rule_type} confirm=${ruleResult.require_confirmation}`,
			);

			// 2-a. 확인 필요 → confirm 메시지
			if (ruleResult.require_confirmation) {
				const msgId = await createRuleConfirmMessage(env, context, ruleResult);
				console.log(
					`[batch] 학습 규칙 confirm → ai_chat_msg_id=${msgId}`,
				);
				await dispatchPush(env, context, msgId, true);
				return { ai_chat_message_id: msgId };
			}

			// 2-b. 자동 적용
			const action = ruleResult.action;
			if (action.type === 'record_milestone' && context.customer.booking_id) {
				const milestoneType = milestoneKeyToType(action.milestone_type);

				// content 결정
				let content: string | undefined;
				if (action.use_message_as_content) {
					const targets = context.talk_history.filter((m) => m.is_target);
					content = targets
						.map((m) => m.message_content ?? '')
						.join('\n');
				}

				const toolResult = await executeRecordMilestone(env as any, {
					booking_id: context.customer.booking_id,
					milestone_type: milestoneType,
					content,
				});

				const isSuccess =
					typeof toolResult === 'object' &&
					toolResult !== null &&
					(toolResult as any).success === true;

				if (isSuccess) {
					await incrementRuleApplyCount(env, ruleResult.rule_id);
					const msgId = await createAutoRuleMessage(
						env,
						context,
						ruleResult,
						toolResult,
					);
					console.log(
						`[batch] 학습 규칙 자동 적용 success → ai_chat_msg_id=${msgId}`,
					);
					await dispatchPush(env, context, msgId, false);
					return { ai_chat_message_id: msgId };
				}

				// 도구 실패 → 작가님 확인 요청으로 폴백
				console.log(
					`[batch] 학습 규칙 자동 적용 실패 → confirm 폴백 (toolResult=${JSON.stringify(toolResult).slice(0, 200)})`,
				);
				const msgId = await createRuleConfirmMessage(env, context, ruleResult);
				await dispatchPush(env, context, msgId, true);
				return { ai_chat_message_id: msgId };
			}

			// booking_id 없거나 unknown action
			console.log(
				`[batch] 학습 규칙 자동 적용 불가 (booking_id 또는 action 부적합) → confirm 폴백`,
			);
			const msgId = await createRuleConfirmMessage(env, context, ruleResult);
			await dispatchPush(env, context, msgId, true);
			return { ai_chat_message_id: msgId };
		}

		// 3. AI 일일 한도 체크
		const dailyLimit =
			parseInt(env.AI_DAILY_LIMIT || '') || DEFAULT_DAILY_LIMIT;
		const todayCount = await countTodayAICalls(env.DB);
		if (todayCount >= dailyLimit) {
			console.log(
				`[batch] AI 한도 초과 today=${todayCount}/${dailyLimit} → overflow 메시지`,
			);
			const msgId = await createOverflowMessage(
				env,
				context,
				todayCount,
				dailyLimit,
			);
			await dispatchPush(env, context, msgId, true);
			return { ai_chat_message_id: msgId };
		}

		// 4. AI 분석
		console.log(`[batch] AI 분석 시작 talk_id=${talkId}`);
		const aiResult = await analyzeWithAI(env, context);

		// 5. 결과별 system 메시지 + 푸시 (duplicate는 푸시 skip)
		let msgId: number;
		let requiresConfirmation = false;
		let shouldPush = true;
		let confirmText: string | undefined;
		switch (aiResult.type) {
			case 'auto_processed':
				msgId = await createAiAutoMessage(
					env,
					context,
					aiResult.tool_uses,
					aiResult.summary,
				);
				requiresConfirmation = false;
				break;
			case 'awaiting_confirm':
				msgId = await createAiConfirmMessage(
					env,
					context,
					aiResult.ai_text,
					aiResult.confirmation,
				);
				requiresConfirmation = aiResult.confirmation != null;
				confirmText = aiResult.ai_text;
				break;
			case 'info_only':
				// info_only는 채팅창 노이즈 방지 위해 system 메시지 INSERT 스킵.
				// talk_messages는 done_ai로 마킹되지만 ai_chat_message_id는 NULL.
				console.log(
					`[batch] info_only 분류 → system 메시지 INSERT 스킵 ` +
						`(summary="${(aiResult.summary || '').slice(0, 50)}...")`,
				);
				console.log(
					`[batch] processBatch end talk_id=${talkId} info_only (no system msg)`,
				);
				return { ai_chat_message_id: undefined };
			case 'duplicate':
				msgId = await createDuplicateMessage(env, context);
				shouldPush = false; // duplicate는 푸시 skip
				break;
			case 'error':
				return { error: aiResult.reason };
		}

		console.log(
			`[batch] AI 결과=${aiResult.type} → system 메시지 id=${msgId}`,
		);
		if (shouldPush) {
			await dispatchPush(env, context, msgId, requiresConfirmation, confirmText);
		} else {
			console.log(`[batch] push skip (type=${aiResult.type})`);
		}
		console.log(
			`[batch] processBatch end talk_id=${talkId} ai_chat_msg_id=${msgId}`,
		);
		return { ai_chat_message_id: msgId };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error('[batch] processBatch error:', reason);
		return { error: reason };
	}
}

// ─── 결과 반영 ─────────────────────────────────────────────────────────

async function markBatchDoneAi(
	env: CronEnv,
	ids: number[],
	aiChatMessageId: number | null,
): Promise<void> {
	if (ids.length === 0) return;
	if (aiChatMessageId === null) {
		// info_only 케이스: ai_chat_message_id는 NULL 그대로, 상태만 done_ai
		const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
		await env.DB.prepare(
			`UPDATE talk_messages
			 SET processing_status = 'done_ai'
			 WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.run();
		return;
	}
	const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
	await env.DB.prepare(
		`UPDATE talk_messages
		 SET processing_status = 'done_ai',
		     ai_chat_message_id = ?1
		 WHERE id IN (${placeholders})`,
	)
		.bind(aiChatMessageId, ...ids)
		.run();
}

async function rollbackBatch(env: CronEnv, ids: number[]): Promise<void> {
	if (ids.length === 0) return;
	const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
	await env.DB.prepare(
		`UPDATE talk_messages
		 SET processing_status = 'pending'
		 WHERE id IN (${placeholders})`,
	)
		.bind(...ids)
		.run();
}

// ─── 시스템 로그 (console.log만 — 영속화는 추후 hook) ─────────────────

async function recordSystemLog(
	_env: CronEnv,
	kind: string,
	payload: Record<string, unknown>,
): Promise<void> {
	console.log(`[systemlog] ${kind} ${JSON.stringify(payload)}`);
	// TODO: 향후 _systemLogs 시트/테이블 결정 시 영속화
}

// ─── 타임아웃 ──────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`timeout(${ms}ms): ${label}`)), ms),
		),
	]);
}

// ─── done_echo milestone 스캔 ─────────────────────────────────────────
// 작가님이 직접 답장해서 done_echo로 종료된 고객 메시지 중
// AI가 보지 못한 것들을 최대 2시간 소급해서 milestone 감지.
// auto_processed(milestone 기록)만 적용; awaiting_confirm은 스킵(작가님이 이미 처리).

async function scanDoneEchoForMilestones(env: CronEnv): Promise<void> {
	// batch_id IS NULL → 아직 스캔 안 됨 (정상 처리 경로에선 UUID가 들어가거나
	// echo_scan 마킹이 없으면 미처리)
	const rows = await env.DB.prepare(
		`SELECT id, talk_id FROM talk_messages
		 WHERE processing_status = 'done_echo'
		   AND sender_type = 'customer'
		   AND batch_id IS NULL
		   AND message_at >= datetime('now', '-2 hours')
		 ORDER BY talk_id, message_at ASC`,
	).all<{ id: number; talk_id: string }>();

	if (!rows.results?.length) return;

	// talk_id별로 묶기
	const byTalkId = new Map<string, number[]>();
	for (const r of rows.results) {
		const list = byTalkId.get(r.talk_id) ?? [];
		list.push(r.id);
		byTalkId.set(r.talk_id, list);
	}

	for (const [talkId, ids] of byTalkId) {
		// 스캔 중 마킹 (재진입 방지)
		const ph = ids.map((_, i) => `?${i + 1}`).join(',');
		await env.DB.prepare(
			`UPDATE talk_messages SET batch_id = 'echo_scan' WHERE id IN (${ph})`,
		).bind(...ids).run();

		try {
			const context = await loadCustomerContext(env as unknown as Env, talkId, ids);
			const result = await analyzeWithAI(env as unknown as Env, context, { echoScanMode: true });

			if (result.type === 'auto_processed') {
				console.log(
					`[echo-scan] talk_id=${talkId} milestone 자동기록 tools=${result.tool_uses.map((t) => t.name).join(',')}`,
				);
			} else if (result.type === 'awaiting_confirm') {
				// done_echo 소급 스캔에서 awaiting_confirm → 채팅창 카드 생성 + 배너 표시
				const msgId = await createAiConfirmMessage(
					env as unknown as Env,
					context,
					result.ai_text,
					result.confirmation,
				);
				console.log(
					`[echo-scan] talk_id=${talkId} awaiting_confirm → system 메시지 생성 id=${msgId}`,
				);
				await dispatchPush(
					env,
					context,
					msgId,
					result.confirmation != null,
					result.ai_text,
				);
			} else {
				console.log(`[echo-scan] talk_id=${talkId} 스킵 type=${result.type}`);
			}
		} catch (e: any) {
			console.error(`[echo-scan] talk_id=${talkId} 오류:`, e?.message || e);
			// 오류 시 batch_id를 NULL로 되돌려 다음 스캔에서 재시도
			await env.DB.prepare(
				`UPDATE talk_messages SET batch_id = NULL WHERE id IN (${ph}) AND batch_id = 'echo_scan'`,
			).bind(...ids).run();
		}
	}
}

// ─── 메인 entry ───────────────────────────────────────────────────────

export async function handleScheduled(
	_controller: ScheduledController,
	env: CronEnv,
): Promise<void> {
	const startedAt = Date.now();
	const startedIso = new Date(startedAt).toISOString();
	console.log(`[cron] 시작: 시각=${startedIso}`);

	const batchLimit =
		parseInt(env.CRON_BATCH_LIMIT || '') || DEFAULT_BATCH_LIMIT;

	let processed = 0;
	let failed = 0;

	try {
		// 1) 좀비 잠금 복구
		const zombies = await recoverZombieLocks(env);
		console.log(`[cron] 좀비 잠금 복구 ${zombies}건`);

		// 2) pending 사용자 조회
		const users = await findPendingUsers(env, batchLimit);
		console.log(`[cron] pending 사용자 ${users.length}명 발견`);

		// 3) 사용자별 직렬 처리
		for (const user of users) {
			const talkId = user.talk_id;
			let lockedIds: number[] = [];
			try {
				lockedIds = await lockUserMessages(env, talkId);
				if (lockedIds.length === 0) {
					// race: 다른 인스턴스가 먼저 잠갔거나 echo로 done_echo됨
					console.log(`[cron] talk_id=${talkId} 잠금 0건 (race) — 스킵`);
					continue;
				}
				console.log(
					`[cron] talk_id=${talkId} 메시지 ${lockedIds.length}건 처리 시작`,
				);

				const result = await withTimeout(
					processBatch(env, talkId, lockedIds),
					USER_PROCESS_TIMEOUT_MS,
					`processBatch ${talkId}`,
				);

				if (result.error) {
					await rollbackBatch(env, lockedIds);
					failed++;
					console.log(
						`[cron] talk_id=${talkId} 결과=error 사유=${result.error}`,
					);
				} else if (result.ai_chat_message_id != null) {
					await markBatchDoneAi(env, lockedIds, result.ai_chat_message_id);
					processed++;
					console.log(
						`[cron] talk_id=${talkId} 결과=success ai_msg=${result.ai_chat_message_id}`,
					);
				} else {
					// info_only: ai_chat_message_id 없이 done_ai 마킹 (채팅창 노이즈 방지)
					await markBatchDoneAi(env, lockedIds, null);
					processed++;
					console.log(
						`[cron] talk_id=${talkId} 결과=success (info_only, no system msg)`,
					);
				}
			} catch (e) {
				const reason = e instanceof Error ? e.message : String(e);
				if (lockedIds.length > 0) {
					await rollbackBatch(env, lockedIds).catch((rbErr) =>
						console.error(`[cron] rollback 실패 talk_id=${talkId}:`, rbErr),
					);
				}
				failed++;
				console.log(`[cron] talk_id=${talkId} 결과=error 사유=${reason}`);
			}
		}
	} catch (e) {
		console.error('[cron] 치명적 실패:', e);
	}

	// 4) done_echo milestone 스캔 (작가님이 직접 답장해서 AI가 못 본 메시지 소급 처리)
	try {
		await scanDoneEchoForMilestones(env);
	} catch (e) {
		console.error('[cron] echo-scan 실패:', e);
	}

	const duration = Date.now() - startedAt;
	await recordSystemLog(env, 'cron_run', {
		processed,
		failed,
		duration_ms: duration,
	});
	console.log(
		`[cron] 종료: 처리=${processed}, 실패=${failed}, 소요=${duration}ms`,
	);
}

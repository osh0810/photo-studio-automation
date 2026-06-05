/**
 * Phase 3 Step 4-C: 톡톡 배치 처리 결과를 ai_chat_messages에 system 메시지로 기록.
 *
 * 7가지 케이스:
 *   - createAutoRuleMessage    학습 규칙 자동 적용 성공
 *   - createRuleConfirmMessage 학습 규칙 매칭 + 확인 필요
 *   - createAiAutoMessage      AI가 도구 호출로 자동 처리
 *   - createAiConfirmMessage   AI가 작가님 확인 요청
 *   - createInfoOnlyMessage    AI가 단순 보고
 *   - createDuplicateMessage   중복 흐름 감지
 *   - createOverflowMessage    AI 일일 한도 초과
 */

import type { Env } from '../../types';
import type { CustomerContext } from './customer-context';
import type { RuleMatchResult } from './rule-matcher';

// ─── 메타데이터 타입 ───────────────────────────────────────────────────

export interface SystemMessageMetadata {
	source: 'naver_talk';
	talk_id: string;
	customer_name: string | null;
	booking_id: string | null;
	message_count: number;
	raw_messages: string[];

	processing: {
		type:
			| 'auto_rule'
			| 'ai_auto'
			| 'ai_confirm'
			| 'info_only'
			| 'duplicate'
			| 'overflow';
		rule_id?: number;
		tool_calls?: any[];
		confirmation?: {
			action_id: string;
			action_type: 'record_milestone';
			params: any;
			buttons: Array<{ label: string; value: 'yes' | 'no' }>;
		};
	};

	push_sent?: boolean;
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────

function customerLabel(ctx: CustomerContext): string {
	return (
		ctx.customer.customer_name ||
		`미등록(talk_id=${ctx.customer.talk_id})`
	);
}

function getTargetMessages(ctx: CustomerContext): string[] {
	return ctx.talk_history
		.filter((m) => m.is_target)
		.map((m) => m.message_content ?? '');
}

function quotedTargets(targets: string[]): string {
	return targets.map((t) => `"${t}"`).join('\n');
}

function headerLine(ctx: CustomerContext, count: number): string {
	return `🔔 [${customerLabel(ctx)}] 새 메시지 (${count}건)`;
}

async function insertSystemMessage(
	env: Env,
	text: string,
	metadata: SystemMessageMetadata,
): Promise<number> {
	const createdAt = new Date().toISOString();
	const inserted = await env.DB.prepare(
		`INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
		 VALUES ('system', ?1, NULL, ?2, ?3)
		 RETURNING id`,
	)
		.bind(text, JSON.stringify(metadata), createdAt)
		.first<{ id: number }>();
	if (!inserted) throw new Error('system 메시지 INSERT 실패');
	return inserted.id;
}

function baseMetadata(
	ctx: CustomerContext,
	targets: string[],
): Pick<
	SystemMessageMetadata,
	| 'source'
	| 'talk_id'
	| 'customer_name'
	| 'booking_id'
	| 'message_count'
	| 'raw_messages'
> {
	return {
		source: 'naver_talk',
		talk_id: ctx.customer.talk_id,
		customer_name: ctx.customer.customer_name,
		booking_id: ctx.customer.booking_id,
		message_count: targets.length,
		raw_messages: targets,
	};
}

// ─── 1) 학습 규칙 자동 적용 ───────────────────────────────────────────

export async function createAutoRuleMessage(
	env: Env,
	context: CustomerContext,
	ruleResult: Extract<RuleMatchResult, { matched: true }>,
	toolResult: any,
): Promise<number> {
	const targets = getTargetMessages(context);
	const milestone = ruleResult.action.milestone_type;
	const contentExtra =
		toolResult && typeof toolResult === 'object' && 'auto_resolved' in toolResult
			? ''
			: '';
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`✅ 자동 처리: ${milestone} 기록 (학습규칙 #${ruleResult.rule_id})`,
		ruleResult.rule_description ? `→ ${ruleResult.rule_description}` : null,
		contentExtra || null,
	]
		.filter((l) => l !== null)
		.join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: {
			type: 'auto_rule',
			rule_id: ruleResult.rule_id,
			tool_calls: [
				{
					name: 'record_milestone',
					input: ruleResult.action,
					result: toolResult,
				},
			],
		},
	};
	return insertSystemMessage(env, text, metadata);
}

// ─── 2) 학습 규칙 매칭 + 확인 필요 ────────────────────────────────────

export async function createRuleConfirmMessage(
	env: Env,
	context: CustomerContext,
	ruleResult: Extract<RuleMatchResult, { matched: true }>,
): Promise<number> {
	const targets = getTargetMessages(context);
	const action = ruleResult.action;
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`💡 학습 규칙 매칭: ${ruleResult.rule_description}`,
		`record_milestone(${action.milestone_type}${
			action.use_message_as_content ? ', content="...(메시지 본문)"' : ''
		})`,
		`실행할까요?`,
	].join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: {
			type: 'ai_confirm',
			rule_id: ruleResult.rule_id,
			confirmation: {
				action_id: crypto.randomUUID(),
				action_type: 'record_milestone',
				params: action,
				buttons: [
					{ label: '✅ 네', value: 'yes' },
					{ label: '❌ 아니오', value: 'no' },
				],
			},
		},
	};
	return insertSystemMessage(env, text, metadata);
}

// ─── 3) AI 자동 처리 ───────────────────────────────────────────────────

export async function createAiAutoMessage(
	env: Env,
	context: CustomerContext,
	toolUses: any[],
	aiSummary: string,
): Promise<number> {
	const targets = getTargetMessages(context);
	const summary = aiSummary || toolUses.map((t) => t.name).join(', ') + ' 실행 완료';
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`✅ AI 자동 처리:`,
		summary,
	].join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: {
			type: 'ai_auto',
			tool_calls: toolUses,
		},
	};
	return insertSystemMessage(env, text, metadata);
}

// ─── 4) AI 확인 요청 ───────────────────────────────────────────────────

export async function createAiConfirmMessage(
	env: Env,
	context: CustomerContext,
	aiText: string,
	confirmation: {
		type: string;
		milestone_type?: string;
		content?: string;
		date?: string;
		require_confirmation?: boolean;
	} | null,
): Promise<number> {
	const targets = getTargetMessages(context);
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`❓ ${aiText}`,
	].join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: { type: 'ai_confirm' },
	};

	// confirmation 객체가 record_milestone + booking_id 있으면 버튼 메타 채움
	if (
		confirmation &&
		confirmation.type === 'record_milestone' &&
		context.customer.booking_id
	) {
		metadata.processing.confirmation = {
			action_id: crypto.randomUUID(),
			action_type: 'record_milestone',
			params: {
				booking_id: context.customer.booking_id,
				milestone_type: confirmation.milestone_type,
				content: confirmation.content,
				date: confirmation.date,
			},
			buttons: [
				{ label: '✅ 네', value: 'yes' },
				{ label: '❌ 아니오', value: 'no' },
			],
		};

		// 추가보정 요청 — sentinel 버튼 패턴용 metadata (chat.ts가 type 기준으로 버튼 렌더)
		if (confirmation.milestone_type === 'revision_requested') {
			(metadata as any).type = 'revision_confirm_pending';
			(metadata as any).booking_id = context.customer.booking_id;
			(metadata as any).talk_id = context.customer.talk_id;
			(metadata as any).customer_name = context.customer.customer_name;
			(metadata as any).revision_content = confirmation.content ?? '';
		}
	}

	return insertSystemMessage(env, text, metadata);
}

// ─── 5) 단순 보고 ──────────────────────────────────────────────────────

/**
 * @deprecated Phase 3 Step 5 후속 결정으로 info_only는 채팅창 표시 안 함
 *   (cron-handler가 INSERT 스킵). 향후 옵션 변경 시 부활 가능.
 */
export async function createInfoOnlyMessage(
	env: Env,
	context: CustomerContext,
	aiSummary: string,
): Promise<number> {
	const targets = getTargetMessages(context);
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`📋 ${aiSummary}`,
	].join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: { type: 'info_only' },
	};
	return insertSystemMessage(env, text, metadata);
}

// ─── 6) 중복 흐름 ──────────────────────────────────────────────────────

export async function createDuplicateMessage(
	env: Env,
	context: CustomerContext,
): Promise<number> {
	const targets = getTargetMessages(context);
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`⚠️ 이미 처리된 흐름과 동일 — 무시함`,
	].join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: { type: 'duplicate' },
	};
	return insertSystemMessage(env, text, metadata);
}

// ─── 7) AI 한도 초과 ───────────────────────────────────────────────────

export async function createOverflowMessage(
	env: Env,
	context: CustomerContext,
	todayCount: number,
	dailyLimit: number,
): Promise<number> {
	const targets = getTargetMessages(context);
	const text = [
		headerLine(context, targets.length),
		quotedTargets(targets),
		``,
		`⛔ 오늘 AI 호출 한도 초과 (${todayCount}/${dailyLimit})`,
		`작가님이 직접 처리해주세요. 다음날 자동 재처리 예정.`,
	].join('\n');

	const metadata: SystemMessageMetadata = {
		...baseMetadata(context, targets),
		processing: { type: 'overflow' },
	};
	return insertSystemMessage(env, text, metadata);
}

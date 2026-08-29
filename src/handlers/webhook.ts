/**
 * 네이버 톡톡 webhook 진입점.
 *
 * 처리 순서는 CLAUDE.md 의 3-tier 방어선을 그대로 따른다:
 *   1) 원본 payload 를 `_원본백업` 시트에 먼저 박는다.  ← 이게 실패하면 그 뒤
 *      모든 상태가 유실되므로 `CriticalBackupError` 로 별도 분기.
 *   2) dedup / 고객검색 / 분류 / 시트업데이트 / Discord 순으로 진행.
 *   3) 어느 단계에서 에러가 터지든 `DISCORD_WEBHOOK_ERROR` 로 알리고,
 *      가능한 한 `_원본백업` 행의 처리상태를 `처리실패` 로 표시한다.
 *
 * 네이버 톡톡은 2xx 가 돌아오지 않으면 재전송한다 — 처리 실패해도 200 을
 * 돌려주는 게 기본 정책. (백업만큼은 실패해도 200 인 이유: 어차피 현재
 * 코드가 재전송 받은 것도 못 막음. 알림으로 사람이 즉시 대응.)
 *
 * Invariant: `event === "echo"` (사장님 본인이 보낸 메시지를 webhook 으로
 * 되받는 이벤트) 는 백업만 남기고 어떤 send-side 코드 (classifier / Discord
 * PROCESSED / 자동발신) 도 호출하지 않는다 — 무한 발송 루프 방지.
 */

import {
	formatErrorAlert,
} from "../lib/alerts";
import { isDuplicate, markProcessed } from "../lib/dedup";
import {
	type RawWebhookPayload,
} from "../services/backup";
import {
	type Env,
} from "../types";
import {
	matchEchoToBooking,
	notifyEchoMatchResult,
} from "../webapp/lib/echo-matcher";
import { handleEchoDriveLink } from "../webapp/lib/echo-drive-handler";
import { sendPushNotification } from "../webapp/lib/push-sender";


/**
 * payload.timestamp(ms) → SQLite datetime 형식 'YYYY-MM-DD HH:MM:SS'.
 * 누락/유효성 실패 시 현재 시각.
 *
 * SQLite의 datetime('now') / strftime() 결과와 문자열 비교가 가능하도록
 * 'T' 구분자를 공백으로 바꾸고 milliseconds + 'Z'를 제거한다. ISO 8601
 * 형식('2026-05-09T...Z')으로 저장하면 'T'(0x54) > ' '(0x20) 때문에
 * 문자열 비교가 깨진다.
 */
function msToSqliteFormat(timestamp: unknown): string {
	const d =
		typeof timestamp === 'number' && Number.isFinite(timestamp)
			? new Date(timestamp)
			: new Date();
	return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * talk_messages 테이블에 INSERT.
 *   - event === "send"  → sender_type='customer', processing_status='pending'
 *   - event === "echo"  → sender_type='studio',   processing_status='echo'
 *   - 그 외 (open/leave/friend 등) → null 반환 (스킵)
 *
 * raw_payload는 항상 그대로 직렬화해 보존.
 */
async function insertTalkMessage(
	env: Env,
	payload: RawWebhookPayload,
): Promise<{ id: number; senderType: "customer" | "studio"; messageAt: string } | null> {
	const event = payload.event;
	let senderType: "customer" | "studio";
	let processingStatus: "pending" | "echo";
	if (event === "send") {
		senderType = "customer";
		processingStatus = "pending";
	} else if (event === "echo") {
		senderType = "studio";
		processingStatus = "echo";
	} else {
		return null;
	}

	const talkId = payload.user ?? "";
	if (!talkId) {
		console.warn("[webhook] D1 INSERT 스킵 — user 필드 누락");
		return null;
	}

	const messageContent = payload.textContent?.text ?? "";
	const imageUrl = (payload as any).imageContent?.imageUrl ?? null;
	const messageAt = msToSqliteFormat((payload as any).timestamp);
	const rawPayload = JSON.stringify(payload);

	const inserted = await env.DB.prepare(
		`INSERT INTO talk_messages
			(talk_id, sender_type, message_content, image_url,
			 message_at, processing_status, event_type, raw_payload)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
		 RETURNING id`,
	)
		.bind(
			talkId,
			senderType,
			messageContent,
			imageUrl,
			messageAt,
			processingStatus,
			event,
			rawPayload,
		)
		.first<{ id: number }>();

	if (!inserted) return null;
	return { id: inserted.id, senderType, messageAt };
}

/**
 * studio echo 처리: 같은 talk_id의 미처리 고객 메시지를 'done_echo'로 일괄 표시.
 *
 * 'pending'(아직 시작 안 함) + 'processing'(Cron이 한창 돌리는 중)을 모두 포함:
 * 작가님이 직접 답장한 시점 이전의 고객 메시지는 봇 응답이 불필요하다.
 *
 * processing_status 값 의미:
 *   - pending     : 처리 대기 (customer, AI 처리 후보)
 *   - processing  : Cron이 잠금 걸고 처리 중
 *   - done_ai     : AI가 처리 완료
 *   - done_echo   : 작가님 echo로 자동 종료 (AI 호출 X)  ← 본 함수가 set
 *   - echo        : 작가님 본인의 echo 메시지 INSERT 시점부터 (studio)
 */
async function handleStudioEcho(
	env: Env,
	talkId: string,
	messageAt: string,
): Promise<{ updated: number }> {
	const result = await env.DB.prepare(
		`UPDATE talk_messages
		 SET processing_status = 'done_echo'
		 WHERE talk_id = ?1
		   AND processing_status IN ('pending', 'processing')
		   AND strftime('%Y-%m-%d %H:%M:%S', message_at) <= strftime('%Y-%m-%d %H:%M:%S', ?2)`,
	)
		.bind(talkId, messageAt)
		.run();
	return { updated: result.meta?.changes ?? 0 };
}

/**
 * 네이버 톡톡 webhook 페이로드 형식 검증.
 * 1차 방어선은 URL path secret이고, 본 함수는 보조.
 * 형식 위반 시에도 200 OK 반환(handler 호출자의 책임) — 네이버 재전송 차단.
 */
function isValidNaverPayload(payload: unknown): payload is RawWebhookPayload {
	if (!payload || typeof payload !== 'object') return false;
	const p = payload as Record<string, unknown>;

	if (typeof p.event !== 'string') return false;
	if (!['send', 'echo', 'open', 'leave', 'friend'].includes(p.event)) return false;

	if (typeof p.user !== 'string' || p.user.length === 0) return false;

	if (p.event === 'send' || p.event === 'echo') {
		if (p.messageId === undefined || p.messageId === null) return false;
		const hasText = p.textContent && typeof p.textContent === 'object';
		const hasImage = p.imageContent && typeof p.imageContent === 'object';
		if (!hasText && !hasImage) return false;
	}

	return true;
}

const CHAT_PUSH_TAGS = new Set(['new-customer', 'review-needed', 'frame-missing']);

async function safeSendPush(
	env: Env,
	title: string,
	body: string,
	tag?: string,
): Promise<void> {
	if (!env.ALLOWED_EMAIL) return;
	const plainBody = body.replace(/\*\*/g, '').replace(/`/g, '').slice(0, 150);
	try {
		await sendPushNotification(env as any, env.ALLOWED_EMAIL, { title, body: plainBody, tag });
	} catch (err) {
		console.error('[webhook] 푸시 발송 실패:', err);
	}

	if (tag && CHAT_PUSH_TAGS.has(tag) && env.DB) {
		const fullPlain = body.replace(/\*\*/g, '').replace(/`/g, '');
		try {
			await (env.DB as D1Database).prepare(
				`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
				 VALUES ('system', ?1, ?2, datetime('now'))`,
			)
				.bind(`${title}\n${fullPlain}`, JSON.stringify({ type: 'push_notification', tag }))
				.run();
		} catch (dbErr) {
			console.error('[webhook] 채팅 시스템 메시지 삽입 실패:', dbErr);
		}
	}
}

export async function handleWebhook(
	request: Request,
	env: Env,
): Promise<Response> {
	// 1. payload 파싱
	let payload: RawWebhookPayload;
	try {
		payload = (await request.json()) as RawWebhookPayload;
	} catch (err) {
		console.error("[webhook] JSON 파싱 실패:", err);
		const { title, content } = formatErrorAlert("payload 파싱", err, null);
		await safeSendPush(env, title, content, 'webhook-parse-error');
		return new Response("invalid json", { status: 200 });
	}

	// 1.5 페이로드 형식 검증 (네이버 톡톡 형식이 아니면 조용히 200 반환)
	if (!isValidNaverPayload(payload)) {
		console.warn(
			`[webhook] 네이버 톡톡 형식 아님, payload=${JSON.stringify(payload).slice(0, 200)}`,
		);
		return new Response("invalid payload", { status: 200 });
	}

	const messageId = String(payload.messageId ?? "");
	const dedupKey = messageId && payload.user ? `${payload.user}:${messageId}` : messageId;

	// 2. dedup
	if (dedupKey && isDuplicate(dedupKey)) {
		console.warn(`[webhook] 중복 messageId 스킵 messageId=${messageId}`);
		return new Response("duplicate", { status: 200 });
	}

	const incomingText = payload.textContent?.text ?? "";
	console.log(
		`[webhook] 톡톡 수신: user=${payload.user ?? "-"}, type=${payload.event ?? "-"}, len=${incomingText.length}`,
	);

	// 3. D1 INSERT (최우선 — Sheets 백업보다 먼저 실행해 메시지 유실 방지)
	try {
		const d1Result = await insertTalkMessage(env, payload);
		if (d1Result) {
			console.log(
				`[webhook] D1 INSERT id=${d1Result.id} sender=${d1Result.senderType}`,
			);
			if (d1Result.senderType === "studio") {
				const echoResult = await handleStudioEcho(
					env,
					payload.user ?? "",
					d1Result.messageAt,
				);
				console.log(
					`[webhook] echo 감지 → pending/processing ${echoResult.updated}건 → done_echo`,
				);
			}
		}
	} catch (d1Err) {
		console.error("[webhook] D1 INSERT 실패:", d1Err);
	}

	// 3.5. _원본백업 시트 백업 비활성화 — D1에 raw_payload 포함 전체 저장 중
	const backupRow: { rowNumber: number } = { rowNumber: 0 };

	// 4-a. echo 이벤트는 별도 분기 — 사장님이 보낸 메시지가 되돌아온 것이라
	// classifier / Discord PROCESSED / 자동발신을 절대 거치면 안 된다 (무한루프).
	if (payload.event === "echo") {
		await handleEchoEvent(env, payload).catch((echoErr) => {
			console.error("[webhook] echo 처리 실패:", echoErr);
		});
		if (dedupKey) markProcessed(dedupKey);
		return new Response("ok", { status: 200 });
	}

	// 4-b. 그 외 비-send 이벤트(open, leave, friend 등)는 백업만 남기고 스킵.
	// 비-send 도 무조건 200 OK — 톡톡이 재전송하지 않도록. (echo 는 위에서 별도 분기)
	if (payload.event && payload.event !== "send") {
		console.log(`[webhook] 비-send 이벤트 스킵 event=${payload.event}`);
		if (dedupKey) markProcessed(dedupKey);
		return new Response("ok", { status: 200 });
	}

	// 5. 구 파이프라인 비활성화 — 신 배치 분석기(cron-handler)가 D1 기반으로 처리.
	// processMessage(Sheets 조회 → 구 분류기 → Sheets 업데이트 → Discord/push)는
	// 신 시스템과 중복 실행되어 오탐(신규 고객 오판정) 원인이 됐으므로 제거.

	if (dedupKey) markProcessed(dedupKey);
	console.log(`[webhook] 처리 완료 rowNumber=${backupRow.rowNumber}`);
	return new Response("ok", { status: 200 });
}

/**
 * echo 이벤트 처리 — 사장님이 보낸 메시지가 webhook 으로 되돌아온 케이스.
 *
 * 안전 불변식 (위반 시 무한 발송 루프):
 *   - classifier 호출 금지
 *   - Discord PROCESSED 알림 금지
 *   - 톡톡 자동 발신 금지
 *   - `processMessage` 진입 금지 (그 안에서 위 작업이 일어남)
 *
 * 현재는 `_원본백업` 행을 "처리완료" 로 표시하고 일반 send 와 구분되도록
 * 분류결과 컬럼에 "echo (사장님 발송 메시지)" 만 기록한다.
 */
async function handleEchoEvent(
	env: Env,
	payload: RawWebhookPayload,
): Promise<void> {
	const talkId = payload.user ?? "";
	// 일반 echo 는 디버그 로그 — 운영 중 노이즈가 되지 않도록 console.debug.
	console.debug(
		`[webhook] echo 이벤트 수신 (사장님 발송) talkId=${talkId || "-"}`,
	);

	// Phase 4.5 Step 2: 확정문자 echo 매칭 → bookings/customers 자동 보완.
	// 무한 발송 루프 방지 불변식 준수 (정규식 파싱만, classifier/Discord/톡톡 발신/processMessage 진입 없음).
	const echoText = payload.textContent?.text ?? "";
	let isConfirmEcho = false;
	try {
		const matchResult = await matchEchoToBooking(env as any, talkId, echoText);
		console.log(
			`[webhook] echo 매칭 결과: ${matchResult.status} booking=${matchResult.bookingId ?? "-"}`,
		);
		if (matchResult.status !== "not_confirm") {
			isConfirmEcho = true;
			await notifyEchoMatchResult(env as any, matchResult).catch(
				(notifyErr) => {
					console.error("[webhook] echo 매칭 알림 실패:", notifyErr);
				},
			);
		}
	} catch (matchErr) {
		console.error("[webhook] echo 매칭 실패:", matchErr);
	}

	// Phase 6-B Step 5: 확정문자 echo가 아닌 경우에만 Drive 링크 감지 → milestone 업데이트
	if (!isConfirmEcho && echoText.includes("drive.google.com")) {
		try {
			const driveResult = await handleEchoDriveLink(env as any, talkId, echoText);
			console.log(
				`[webhook] echo drive 결과: ${driveResult.status} booking=${driveResult.bookingId ?? "-"}`,
			);
		} catch (driveErr) {
			console.error("[webhook] echo drive 처리 실패:", driveErr);
		}
	}

}


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
	formatNewCustomerAlert,
	formatProcessedAlert,
	formatReviewAlert,
	summarizeClassification,
} from "../lib/alerts";
import { isDuplicate, markProcessed } from "../lib/dedup";
import { withRetry } from "../lib/retry";
import {
	backupWebhookPayload,
	CriticalBackupError,
	updateBackupStatus,
	type RawWebhookPayload,
} from "../services/backup";
import { classifyMessage } from "../services/classifier";
import { sendDiscordAlert } from "../services/discord";
import {
	appendCustomerRow,
	searchCustomerByTalkId,
	updateCustomerCells,
} from "../services/sheets";
import {
	AlertLevel,
	CustomerStage,
	formatStage,
	parseStage,
	type ClassificationInput,
	type ClassificationResult,
	type Customer,
	type Env,
} from "../types";
import {
	matchEchoToBooking,
	notifyEchoMatchResult,
} from "../webapp/lib/echo-matcher";
import { handleEchoDriveLink } from "../webapp/lib/echo-drive-handler";

type CustomerMatch = NonNullable<
	Awaited<ReturnType<typeof searchCustomerByTalkId>>
>;

function nowKstTimestamp(): string {
	const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
		`${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
	);
}

/** KST 기준 `YYYY-MM-DD`. 비고 자동 기록 태그에 사용. */
function todayKstDate(): string {
	const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

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

function safeSendDiscord(
	env: Env,
	webhook: string,
	level: AlertLevel,
	title: string,
	content: string,
): Promise<void> {
	return sendDiscordAlert(webhook, level, title, content).catch((err) => {
		console.error("Discord 전송 실패:", err);
	});
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
		const { title, content } = formatErrorAlert("payload 파싱", err, null);
		await safeSendDiscord(env, env.DISCORD_WEBHOOK_ERROR, AlertLevel.ERROR, title, content);
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

	// 2. dedup
	if (messageId && isDuplicate(messageId)) {
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

	// 3.5. 백업 (시트) — D1 이후 실행. 실패해도 D1은 이미 저장됐으므로 early return 없음
	let backupRow: { rowNumber: number } = { rowNumber: 0 };
	try {
		backupRow = await backupWebhookPayload(env, payload);
		console.log(`[webhook] 시트 append OK rowNumber=${backupRow.rowNumber}`);
	} catch (err) {
		console.error("[webhook] 백업 실패 (D1은 저장됨):", err);
		const stage = err instanceof CriticalBackupError ? "_원본백업 저장 (CRITICAL)" : "_원본백업 저장";
		const { title, content } = formatErrorAlert(stage, err, payload);
		await safeSendDiscord(env, env.DISCORD_WEBHOOK_ERROR, AlertLevel.CRITICAL, title, content);
		// early return 제거 — 계속 진행
	}

	// 4-a. echo 이벤트는 별도 분기 — 사장님이 보낸 메시지가 되돌아온 것이라
	// classifier / Discord PROCESSED / 자동발신을 절대 거치면 안 된다 (무한루프).
	if (payload.event === "echo") {
		await handleEchoEvent(env, payload, backupRow.rowNumber).catch((echoErr) => {
			console.error("[webhook] echo 처리 실패:", echoErr);
		});
		if (messageId) markProcessed(messageId);
		return new Response("ok", { status: 200 });
	}

	// 4-b. 그 외 비-send 이벤트(open, leave, friend 등)는 백업만 남기고 스킵.
	// 비-send 도 무조건 200 OK — 톡톡이 재전송하지 않도록. (echo 는 위에서 별도 분기)
	if (payload.event && payload.event !== "send") {
		console.log(`[webhook] 비-send 이벤트 스킵 event=${payload.event}`);
		await updateBackupStatus(env, backupRow.rowNumber, "처리완료", {
			분류결과: `${payload.event} 이벤트 (처리 스킵)`,
		}).catch((updateErr) => {
			console.error("[webhook] 백업 상태 갱신 실패:", updateErr);
		});
		if (messageId) markProcessed(messageId);
		return new Response("ok", { status: 200 });
	}

	// 5. 파이프라인 (고객검색 → 분류 → 분기)
	try {
		await processMessage(env, payload, backupRow.rowNumber);
	} catch (err) {
		console.error("[webhook] 처리 실패:", err);
		const stage = err instanceof Error ? err.name || "처리 실패" : "처리 실패";
		const { title, content } = formatErrorAlert(stage, err, payload);
		await safeSendDiscord(
			env,
			env.DISCORD_WEBHOOK_ERROR,
			AlertLevel.ERROR,
			title,
			`${content}\n\n**백업 행**: ${backupRow.rowNumber}`,
		);
		// 백업 행 상태 갱신은 베스트 에포트 — 실패해도 위 Discord 알림으로 사람이 안다.
		await updateBackupStatus(env, backupRow.rowNumber, "처리실패", {
			에러메시지: err instanceof Error ? err.message : String(err),
		}).catch((updateErr) => {
			console.error("[webhook] 백업 상태 갱신 실패:", updateErr);
		});
	}

	if (messageId) markProcessed(messageId);
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
	rowNumber: number,
): Promise<void> {
	const talkId = payload.user ?? "";
	// 일반 echo 는 디버그 로그 — 운영 중 노이즈가 되지 않도록 console.debug.
	console.debug(
		`[webhook] echo 이벤트 수신 (사장님 발송) talkId=${talkId || "-"} rowNumber=${rowNumber}`,
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

	await updateBackupStatus(env, rowNumber, "처리완료", {
		분류결과: "echo (사장님 발송 메시지)",
	});
}

async function processMessage(
	env: Env,
	payload: RawWebhookPayload,
	rowNumber: number,
): Promise<void> {
	const talkId = payload.user ?? "";
	// 페이로드에 이름 없음 — Profile API 연동 전까진 빈 문자열로 유지.
	const talkName = "";
	const messageText = payload.textContent?.text ?? "";
	// 이미지/파일 이벤트 shape 확인 전까진 텍스트로 간주. classifier 도 타입보다
	// 본문에 의존하므로 현 시점에선 충분.
	const messageType: ClassificationInput["message"]["타입"] = "text";

	if (!talkId) throw new Error("user 필드 누락 — 고객 식별 불가");

	console.log(`[webhook] processMessage 시작 talkId=${talkId}`);

	const existing = await withRetry(() => searchCustomerByTalkId(env, talkId));

	if (!existing) {
		console.log(`[webhook] 신규 고객 (DB 미등록) talkId=${talkId}`);
		await handleNewCustomer(env, rowNumber, talkId, talkName, messageText);
		return;
	}
	console.log(
		`[webhook] 기존 고객 매칭 고객ID=${existing.data.고객ID} 현재단계=${existing.data.현재단계 || "-"} 시트행=${existing.rowNumber}`,
	);

	const input: ClassificationInput = {
		customer: {
			고객명: existing.data.고객명,
			고객ID: existing.data.고객ID,
			현재단계: (existing.data.현재단계 || CustomerStage.S0) as CustomerStage,
			원본발송일: existing.data.원본발송일,
			셀렉수신일: existing.data.셀렉수신일,
			보정본발송일: existing.data.보정본발송일,
			추가보정요청일: existing.data.추가보정요청일,
			비고: existing.data.비고,
		},
		message: {
			원문: messageText,
			수신시각: nowKstTimestamp(),
			타입: messageType,
		},
	};
	const result = await withRetry(() => classifyMessage(env, input));
	console.log(
		`[webhook] 분류 완료 intent=${result.intent} confidence=${result.confidence} review=${result.human_review_needed} from=${result.stage_change?.from ?? "-"} to=${result.stage_change?.to ?? "-"}`,
	);

	if (result.human_review_needed) {
		await handleReviewNeeded(env, existing, result, messageText, rowNumber);
		return;
	}

	await handleAutoProcess(env, existing, result, rowNumber, messageText);
}

async function handleNewCustomer(
	env: Env,
	rowNumber: number,
	talkId: string,
	talkName: string,
	messageText: string,
): Promise<void> {
	console.log(`[webhook] handleNewCustomer talkId=${talkId}`);
	// 비고 컬럼은 사용자 전용 — 시스템은 쓰지 않는다. 메시지 원문은
	// _원본백업 시트와 Discord #긴급에러 알림으로 이미 남음.
	await withRetry(() =>
		appendCustomerRow(env, {
			고객명: talkName,
			톡톡ID: talkId,
			현재단계: CustomerStage.S0,
			검토상태: "검토필요",
		}),
	);

	const { title, content } = formatNewCustomerAlert(talkName, messageText);
	await safeSendDiscord(env, env.DISCORD_WEBHOOK_ERROR, AlertLevel.WARNING, title, content);

	await updateBackupStatus(env, rowNumber, "검토필요", {
		분류결과: "신규고객",
	});
}

async function handleReviewNeeded(
	env: Env,
	existing: CustomerMatch,
	result: ClassificationResult,
	messageText: string,
	rowNumber: number,
): Promise<void> {
	console.log(
		`[webhook] handleReviewNeeded 고객ID=${existing.data.고객ID} reason=${result.review_reason ?? "-"}`,
	);
	const name = existing.data.고객명 || existing.data.톡톡ID;
	const { title, content } = formatReviewAlert(
		name,
		messageText,
		result.review_reason ?? "",
		result.suggested_reply ?? "",
	);
	await safeSendDiscord(env, env.DISCORD_WEBHOOK_ERROR, AlertLevel.WARNING, title, content);

	await updateBackupStatus(env, rowNumber, "검토필요", {
		매칭고객ID: existing.data.고객ID,
		분류결과: summarizeClassification(result),
	});
}

/**
 * 비고 컬럼은 기본적으로 사용자 전용 — Claude 의 field_updates.비고추가 는 무시한다.
 * 단, 아래 intent 는 "시스템이 추적해야 하는 사고성 이벤트" 라 예외적으로 자동 append.
 *
 *   - "원본누락": 원본 일부 누락 → S2→S1 자동 전환 + 비고 기록
 *   - "재촬영요청": 셀렉 철회/재촬영 → S3→S2 자동 전환 + 비고 기록
 *   - "액자누락": 별도 반자동 분기(`handleFrameMissing`) 에서 처리하므로 이 Map 에는 포함하지 않는다.
 *
 * Record 의 value 는 비고 라인의 태그 텍스트 (예: "원본 누락 신고").
 */
const BIGO_AUTO_WRITE_TAGS: Record<string, string> = {
	원본누락: "원본 누락 신고",
	재촬영요청: "재촬영 요청",
};

async function handleAutoProcess(
	env: Env,
	existing: CustomerMatch,
	result: ClassificationResult,
	rowNumber: number,
	messageText: string,
): Promise<void> {
	const currentStage = existing.data.현재단계 || "";

	// 액자누락 + S7 은 반자동 분기 — 단계 변경 없이 비고/검토상태만 갱신하고
	// Discord #긴급에러 로 즉시 알린다.
	if (result.intent === "액자누락" && currentStage === CustomerStage.S7) {
		await handleFrameMissing(env, existing, result, messageText, rowNumber);
		return;
	}

	const customerUpdates: Partial<Customer> = {};

	// Soft guard: Claude 가 가끔 to=from 으로 "변경 없음" 을 돌려주는 경우가 있어
	// 무의미한 시트 쓰기를 막는다. 진짜 전환이 필요한 경우만 현재단계 업데이트.
	const newStage = result.stage_change?.to ?? null;
	if (newStage && newStage !== currentStage) {
		customerUpdates.현재단계 = newStage as CustomerStage;
	}

	const fu = result.field_updates ?? {};
	if (fu.셀렉수신일) customerUpdates.셀렉수신일 = fu.셀렉수신일;
	if (fu.셀렉컷) customerUpdates.셀렉컷 = fu.셀렉컷;
	if (fu.추가보정요청일) customerUpdates.추가보정요청일 = fu.추가보정요청일;
	if (fu.액자옵션) customerUpdates.액자옵션 = fu.액자옵션;

	// 추가보정내용: S6→S5a 루프일 때만 "[N차]" 마커로 누적, 그 외는 덮어쓰기.
	// S5b→S5a 번복은 overwrite (사양 확정) — 번복은 성격상 현재 요청이 우선.
	if (fu.추가보정내용) {
		if (
			currentStage === CustomerStage.S6 &&
			newStage === CustomerStage.S5A
		) {
			const prev = existing.data.추가보정내용 || "";
			// 기존 값에 [N차] 마커가 몇 번 찍혔는지 센다. 마커 없음 → 2차부터 시작
			// (최초 S4→S5a 는 마커 없이 저장되므로 첫 루프는 [2차]).
			const roundCount = (prev.match(/\[(\d+)차\]/g) || []).length + 2;
			customerUpdates.추가보정내용 = prev
				? `${prev}\n[${roundCount}차] ${fu.추가보정내용}`
				: fu.추가보정내용;
		} else {
			customerUpdates.추가보정내용 = fu.추가보정내용;
		}
	}

	// 비고 자동 append (원본누락 / 재촬영요청).
	// 액자누락은 위에서 별도 분기로 처리됐으므로 여기 들어오지 않음.
	const bigoTag = BIGO_AUTO_WRITE_TAGS[result.intent];
	if (bigoTag) {
		const prev = existing.data.비고 || "";
		const snippet = messageText.slice(0, 100);
		const line = `[자동] ${bigoTag} (${todayKstDate()}): ${snippet}`;
		customerUpdates.비고 = prev ? `${prev}\n${line}` : line;
	}

	const updateKeys = Object.keys(customerUpdates);
	console.log(
		`[webhook] handleAutoProcess 고객ID=${existing.data.고객ID} 시트행=${existing.rowNumber} updates=[${updateKeys.join(",")}]`,
	);
	if (updateKeys.length > 0) {
		await withRetry(() => updateCustomerCells(env, existing.rowNumber, customerUpdates));
		console.log(
			`[webhook] handleAutoProcess 셀 업데이트 완료 시트행=${existing.rowNumber}`,
		);
	} else {
		console.log("[webhook] handleAutoProcess 업데이트 대상 없음");
	}

	const oldStageCode = existing.data.현재단계 || "";
	const newStageCode = parseStage(newStage ?? "");
	const { title, content } = formatProcessedAlert(
		existing.data.고객명 || existing.data.톡톡ID,
		result.intent,
		oldStageCode ? formatStage(oldStageCode) : "",
		newStageCode ? formatStage(newStageCode) : newStage,
	);
	await safeSendDiscord(env, env.DISCORD_WEBHOOK_PROCESSED, AlertLevel.INFO, title, content);

	await updateBackupStatus(env, rowNumber, "처리완료", {
		매칭고객ID: existing.data.고객ID,
		분류결과: summarizeClassification(result),
	});
}

/**
 * 액자누락 + S7 반자동 처리.
 *   - 현재단계: S7 그대로 유지 (자동 전환하지 않는다 — 액자 재발주는 사장님이 직접 결정)
 *   - 비고: "[자동] 액자 누락 신고 (YYYY-MM-DD): {메시지 100자}" append (기존 비고 보존)
 *   - 검토상태: "액자누락확인" 으로 표시해 시트에서 필터 가능
 *   - Discord: #처리내역 이 아니라 #긴급에러 / CRITICAL 로 즉시 알림
 */
async function handleFrameMissing(
	env: Env,
	existing: CustomerMatch,
	result: ClassificationResult,
	messageText: string,
	rowNumber: number,
): Promise<void> {
	console.log(
		`[webhook] handleFrameMissing 고객ID=${existing.data.고객ID} 시트행=${existing.rowNumber}`,
	);

	const snippet = messageText.slice(0, 100);
	const prev = existing.data.비고 || "";
	const line = `[자동] 액자 누락 신고 (${todayKstDate()}): ${snippet}`;
	const customerUpdates: Partial<Customer> = {
		// 현재단계는 손대지 않는다 (S7 유지).
		비고: prev ? `${prev}\n${line}` : line,
		검토상태: "액자누락확인",
	};

	await withRetry(() =>
		updateCustomerCells(env, existing.rowNumber, customerUpdates),
	);
	console.log(
		`[webhook] handleFrameMissing 셀 업데이트 완료 시트행=${existing.rowNumber}`,
	);

	const customerName = existing.data.고객명 || existing.data.톡톡ID;
	const urgentContent = [
		`**고객**: ${customerName} (${existing.data.고객ID})`,
		`**현재단계**: S7 유지 (반자동 처리 — 액자 재발주 판단 필요)`,
		`**메시지**: ${snippet}`,
		`**조치**: 비고에 자동 기록, 검토상태 → "액자누락확인"`,
	].join("\n");
	await safeSendDiscord(
		env,
		env.DISCORD_WEBHOOK_ERROR,
		AlertLevel.CRITICAL,
		`⚠️ 액자 누락 신고 — ${customerName}`,
		urgentContent,
	);

	await updateBackupStatus(env, rowNumber, "처리완료", {
		매칭고객ID: existing.data.고객ID,
		분류결과: summarizeClassification(result),
	});
}

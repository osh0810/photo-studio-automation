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

	const messageId = payload.message?.id ?? "";

	// 2. dedup
	if (messageId && isDuplicate(messageId)) {
		return new Response("duplicate", { status: 200 });
	}

	// 3. 백업 (최우선)
	let backupRow: { rowNumber: number };
	try {
		backupRow = await backupWebhookPayload(env, payload);
	} catch (err) {
		const stage = err instanceof CriticalBackupError ? "_원본백업 저장 (CRITICAL)" : "_원본백업 저장";
		const { title, content } = formatErrorAlert(stage, err, payload);
		await safeSendDiscord(env, env.DISCORD_WEBHOOK_ERROR, AlertLevel.CRITICAL, title, content);
		return new Response("backup failed", { status: 200 });
	}

	// 4. 파이프라인 (고객검색 → 분류 → 분기)
	try {
		await processMessage(env, payload, backupRow.rowNumber);
	} catch (err) {
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
			console.error("백업 상태 갱신 실패:", updateErr);
		});
	}

	if (messageId) markProcessed(messageId);
	return new Response("ok", { status: 200 });
}

async function processMessage(
	env: Env,
	payload: RawWebhookPayload,
	rowNumber: number,
): Promise<void> {
	const talkId = payload.user?.id ?? "";
	const talkName = payload.user?.name ?? "";
	const messageText = payload.message?.text ?? "";
	const rawType = payload.message?.type ?? "text";
	const messageType: ClassificationInput["message"]["타입"] =
		rawType === "image" || rawType === "file" || rawType === "sticker"
			? rawType
			: "text";

	if (!talkId) throw new Error("user.id 누락 — 고객 식별 불가");

	const existing = await withRetry(() => searchCustomerByTalkId(env, talkId));

	if (!existing) {
		await handleNewCustomer(env, rowNumber, talkId, talkName, messageText);
		return;
	}

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

	if (result.human_review_needed) {
		await handleReviewNeeded(env, existing, result, messageText, rowNumber);
		return;
	}

	await handleAutoProcess(env, existing, result, rowNumber);
}

async function handleNewCustomer(
	env: Env,
	rowNumber: number,
	talkId: string,
	talkName: string,
	messageText: string,
): Promise<void> {
	await withRetry(() =>
		appendCustomerRow(env, {
			고객명: talkName,
			톡톡ID: talkId,
			현재단계: CustomerStage.S0,
			검토상태: "검토필요",
			비고: `[자동] 신규 메시지: ${messageText}`.slice(0, 500),
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

async function handleAutoProcess(
	env: Env,
	existing: CustomerMatch,
	result: ClassificationResult,
	rowNumber: number,
): Promise<void> {
	const customerUpdates: Partial<Customer> = {};

	const newStage = result.stage_change?.to ?? null;
	if (newStage) customerUpdates.현재단계 = newStage as CustomerStage;

	const fu = result.field_updates ?? {};
	if (fu.셀렉수신일) customerUpdates.셀렉수신일 = fu.셀렉수신일;
	if (fu.셀렉컷) customerUpdates.셀렉컷 = fu.셀렉컷;
	if (fu.추가보정요청일) customerUpdates.추가보정요청일 = fu.추가보정요청일;
	if (fu.추가보정내용) customerUpdates.추가보정내용 = fu.추가보정내용;
	if (fu.액자옵션) customerUpdates.액자옵션 = fu.액자옵션;
	if (fu.비고추가) {
		const prev = existing.data.비고 || "";
		customerUpdates.비고 = prev ? `${prev}\n${fu.비고추가}` : fu.비고추가;
	}

	if (Object.keys(customerUpdates).length > 0) {
		await withRetry(() => updateCustomerCells(env, existing.rowNumber, customerUpdates));
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

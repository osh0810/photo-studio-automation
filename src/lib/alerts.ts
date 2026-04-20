/**
 * Discord webhook 본문 포맷터.
 *
 * `sendDiscordAlert(webhookUrl, level, title, content)` 가 받는 문자열
 * 두 개를 만들어주는 역할만 한다 — 전송/색상/타임스탬프는 services/discord.ts
 * 가 담당. 이쪽에선 한국어 메시지 톤만 일관되게 유지한다.
 */

import type { ClassificationResult, MessageIntent } from "../types";

export interface AlertContent {
	title: string;
	content: string;
}

const PAYLOAD_PREVIEW_LIMIT = 1500;

function stagePart(oldStage: string, newStage: string | null | undefined): string {
	const left = (oldStage ?? "").trim();
	const right = (newStage ?? "").trim();
	if (left && right && left !== right) return ` (${left} → ${right})`;
	if (left || right) return ` (${left || right})`;
	return "";
}

export function formatProcessedAlert(
	customerName: string,
	intent: MessageIntent | string,
	oldStage: string,
	newStage: string | null,
): AlertContent {
	const stage = stagePart(oldStage, newStage);
	return {
		title: `✅ ${customerName} - ${intent}${stage}`,
		content:
			`**고객**: ${customerName}\n` +
			`**분류**: ${intent}\n` +
			`**단계 변경**: ${oldStage || "-"} → ${newStage || "-"}`,
	};
}

export function formatReviewAlert(
	customerName: string,
	message: string,
	reason: string,
	suggestedReply: string,
): AlertContent {
	return {
		title: `📌 ${customerName} - 검토 필요`,
		content:
			`**고객**: ${customerName}\n` +
			`**메시지**: ${message}\n` +
			`**검토 사유**: ${reason || "-"}\n` +
			`**제안 답변**: ${suggestedReply || "-"}`,
	};
}

export function formatErrorAlert(
	stage: string,
	error: unknown,
	payload: unknown,
): AlertContent {
	const errMessage =
		error instanceof Error
			? `${error.name}: ${error.message}`
			: String(error);
	const payloadJson = (() => {
		try {
			return JSON.stringify(payload, null, 2);
		} catch {
			return String(payload);
		}
	})();
	const truncated =
		payloadJson.length > PAYLOAD_PREVIEW_LIMIT
			? payloadJson.slice(0, PAYLOAD_PREVIEW_LIMIT) + "\n…(생략)"
			: payloadJson;
	return {
		title: `🚨 시스템 에러 - ${stage}`,
		content:
			`**단계**: ${stage}\n` +
			`**에러**: ${errMessage}\n` +
			`**Payload**:\n\`\`\`json\n${truncated}\n\`\`\``,
	};
}

export function formatNewCustomerAlert(
	talkUserName: string,
	message: string,
): AlertContent {
	const name = talkUserName || "(이름미상)";
	return {
		title: `👤 신규 고객 - ${name}`,
		content:
			`**톡톡 사용자**: ${name}\n` +
			`**첫 메시지**: ${message}\n` +
			`고객목록 시트에 신규 행이 추가되었습니다. 정보를 보완해 주세요.`,
	};
}

/** 분류 결과를 백업 시트의 `분류결과` 컬럼에 적기 위한 한 줄 요약. */
export function summarizeClassification(result: ClassificationResult): string {
	const from = result.stage_change?.from ?? "";
	const to = result.stage_change?.to ?? "";
	const stage = from || to ? ` ${from || "-"}→${to || "-"}` : "";
	return `${result.intent}/${result.confidence}${stage}`;
}

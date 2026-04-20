/**
 * Discord webhook 본문 포맷터.
 *
 * `sendDiscordAlert(webhookUrl, level, title, content)` 가 받는 문자열
 * 두 개를 만들어주는 역할만 한다 — 전송/색상/타임스탬프는 services/discord.ts
 * 가 담당. 이쪽에선 한국어 메시지 톤만 일관되게 유지한다.
 */

import { CustomerStage, type ClassificationResult, type Customer, type MessageIntent } from "../types";

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

// ─── 일일 Cron 알림 (Phase 2) ──────────────────────────────────────────
//
// Discord 전송용 AlertLevel(INFO/WARNING/…) 과 별개로, 일일 리포트 본문에서
// 항목을 분류할 때 쓰는 "업무 상태" 레이블. 색상/severity 매핑이 아니라
// 운영자 시선에서의 분류(긴급/일반/확인필요)라서 독립 타입.

export type DailyAlertLevel = "긴급" | "일반" | "확인필요";

export interface AlertItem {
	level: DailyAlertLevel;
	customerName: string;
	customerId: string;
	stage: CustomerStage;
	/** 예: "보정본 12일 지연 (셀렉 4/8 → 오늘 4/20)" */
	message: string;
	/** 예: "보정본 발송 또는 고객 안내 필요" */
	recommendation: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 시트 셀에 적힌 날짜 문자열 → UTC midnight Date.
 * 허용 포맷:
 *   - `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY/MM/DD` (시간 부분 뒤따라도 OK)
 *   - `MM/DD` / `M-D` (연도 생략 → 올해 기준, 단 `today` 기준 한 달 이상
 *     미래면 작년으로 해석 — 연말 롤오버 대응)
 * 파싱 실패/빈 값은 null — 호출자가 "기준일 없음" 으로 처리한다.
 */
function parseSheetDate(raw: string | undefined, today: Date): Date | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const ymd = trimmed.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
	if (ymd) {
		return new Date(
			Date.UTC(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10)),
		);
	}
	const md = trimmed.match(/^(\d{1,2})[-./](\d{1,2})$/);
	if (md) {
		const m = parseInt(md[1], 10) - 1;
		const d = parseInt(md[2], 10);
		const y = today.getUTCFullYear();
		let dt = new Date(Date.UTC(y, m, d));
		if (dt.getTime() > today.getTime() + 30 * DAY_MS) {
			dt = new Date(Date.UTC(y - 1, m, d));
		}
		return dt;
	}
	return null;
}

function daysBetween(from: Date, to: Date): number {
	return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function formatShortDate(d: Date): string {
	return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 단일 고객에 대해 오늘(KST midnight) 기준으로 알림이 필요한지 판정.
 * 알림 대상이면 `AlertItem`, 아니면 `null`.
 *
 * 단계별 기준 (CLAUDE.md / README 표와 일치):
 *   S1 촬영완료      — 촬영일 +1d, 원본발송일 비어있음 → 일반
 *   S2 원본발송      — 원본발송일 +7d 일반 / +14d 긴급, 셀렉수신일 비어있음
 *   S3 셀렉수신      — 셀렉수신일 +7d 일반 / +14d 긴급, 보정본발송일 비어있음
 *   S4 보정발송      — 보정본발송일 +1d → 확인필요 (추가보정 여부 확인)
 *   S5a 추가보정요청  — 추가보정요청일 +7d 일반 / +14d 긴급, 추가보정본발송일 비어있음
 *   S5b 추가보정없음  — 기준일(보정본발송일 우선, 없으면 최종수정일시) +1d,
 *                     액자발주일 비어있음 → 일반
 *   S6 추가보정발송  — 추가보정본발송일 +1d, 액자발주일 비어있음 → 일반
 *   S0 / S7          — 알림 없음
 */
export function evaluateCustomer(customer: Customer, today: Date): AlertItem | null {
	const stage = customer.현재단계;
	if (!stage || stage === CustomerStage.S0 || stage === CustomerStage.S7) return null;

	const name = customer.고객명 || customer.톡톡ID || "(이름없음)";
	const id = customer.고객ID || "";

	const 촬영 = parseSheetDate(customer.촬영일, today);
	const 원본 = parseSheetDate(customer.원본발송일, today);
	const 셀렉 = parseSheetDate(customer.셀렉수신일, today);
	const 보정 = parseSheetDate(customer.보정본발송일, today);
	const 추가요청 = parseSheetDate(customer.추가보정요청일, today);
	const 추가발송 = parseSheetDate(customer.추가보정본발송일, today);
	const 액자 = parseSheetDate(customer.액자발주일, today);
	const 최종수정 = parseSheetDate(customer.최종수정일시, today);
	const todayShort = formatShortDate(today);

	const item = (
		level: DailyAlertLevel,
		message: string,
		recommendation: string,
	): AlertItem => ({
		level,
		customerName: name,
		customerId: id,
		stage,
		message,
		recommendation,
	});

	switch (stage) {
		case CustomerStage.S1: {
			if (!촬영 || 원본) return null;
			const days = daysBetween(촬영, today);
			if (days < 1) return null;
			return item(
				"일반",
				`원본 ${days}일 미발송 (촬영 ${formatShortDate(촬영)} → 오늘 ${todayShort})`,
				"원본 발송 필요",
			);
		}
		case CustomerStage.S2: {
			if (!원본 || 셀렉) return null;
			const days = daysBetween(원본, today);
			if (days >= 14) {
				return item(
					"긴급",
					`셀렉 ${days}일 미수신 (원본 ${formatShortDate(원본)} → 오늘 ${todayShort})`,
					"리마인드 메시지 추천",
				);
			}
			if (days >= 7) {
				return item(
					"일반",
					`셀렉 ${days}일 미수신 (원본 ${formatShortDate(원본)} → 오늘 ${todayShort})`,
					"리마인드 메시지 추천",
				);
			}
			return null;
		}
		case CustomerStage.S3: {
			if (!셀렉 || 보정) return null;
			const days = daysBetween(셀렉, today);
			if (days >= 14) {
				return item(
					"긴급",
					`보정본 ${days}일 지연 (셀렉 ${formatShortDate(셀렉)} → 오늘 ${todayShort})`,
					"보정본 발송 또는 고객 안내 필요",
				);
			}
			if (days >= 7) {
				return item(
					"일반",
					`보정본 ${days}일 지연 (셀렉 ${formatShortDate(셀렉)} → 오늘 ${todayShort})`,
					"보정본 발송 또는 고객 안내 필요",
				);
			}
			return null;
		}
		case CustomerStage.S4: {
			if (!보정) return null;
			const days = daysBetween(보정, today);
			if (days < 1) return null;
			return item(
				"확인필요",
				`보정본 발송 ${days}일차 (${formatShortDate(보정)} → 오늘 ${todayShort})`,
				"추가보정 여부 확인",
			);
		}
		case CustomerStage.S5A: {
			if (!추가요청 || 추가발송) return null;
			const days = daysBetween(추가요청, today);
			if (days >= 14) {
				return item(
					"긴급",
					`추가보정 ${days}일 지연 (요청 ${formatShortDate(추가요청)} → 오늘 ${todayShort})`,
					"추가보정본 발송 필요",
				);
			}
			if (days >= 7) {
				return item(
					"일반",
					`추가보정 ${days}일 지연 (요청 ${formatShortDate(추가요청)} → 오늘 ${todayShort})`,
					"추가보정본 발송 필요",
				);
			}
			return null;
		}
		case CustomerStage.S5B: {
			// 보정 확정 후 액자 발주까지 — 기준일은 보정본발송일 우선, 없으면
			// 최종수정일시 (S5b 진입 시점의 근사치). 둘 다 없으면 건너뜀.
			if (액자) return null;
			const base = 보정 ?? 최종수정;
			if (!base) return null;
			const days = daysBetween(base, today);
			if (days < 1) return null;
			return item(
				"일반",
				`액자 발주 필요 (보정 확정 ${formatShortDate(base)})`,
				"액자 발주 또는 옵션 확인",
			);
		}
		case CustomerStage.S6: {
			if (액자 || !추가발송) return null;
			const days = daysBetween(추가발송, today);
			if (days < 1) return null;
			return item(
				"일반",
				`액자 발주 필요 (추가보정 발송 ${formatShortDate(추가발송)})`,
				"액자 발주 또는 옵션 확인",
			);
		}
	}
	return null;
}

const DAILY_EMBED_LIMIT = 4000;

/**
 * 일일 Discord 리포트 본문 빌더.
 * - 제목: `🌅 오늘의 누락방지 알림 (YYYY-MM-DD)` (KST 날짜)
 * - 본문: 🔴긴급 → 🟡일반 → 📌확인필요 → 📷오늘촬영 순서
 * - 알림/촬영 모두 0건이면 "✨ 오늘은 모든 것이 정상이에요!"
 * - Discord embed description 4096자 제한 여유분 확보 위해 4000자에서 절단.
 */
export function formatDailyReport(
	items: AlertItem[],
	today: Date,
	todayShootings: Customer[] = [],
): { title: string; content: string } {
	const y = today.getUTCFullYear();
	const m = String(today.getUTCMonth() + 1).padStart(2, "0");
	const d = String(today.getUTCDate()).padStart(2, "0");
	const title = `🌅 오늘의 누락방지 알림 (${y}-${m}-${d})`;

	if (items.length === 0 && todayShootings.length === 0) {
		return { title, content: "✨ 오늘은 모든 것이 정상이에요!" };
	}

	const urgent = items.filter((i) => i.level === "긴급");
	const normal = items.filter((i) => i.level === "일반");
	const review = items.filter((i) => i.level === "확인필요");

	const lines: string[] = [];
	const pushSection = (emoji: string, label: string, xs: AlertItem[]) => {
		if (xs.length === 0) return;
		lines.push(`${emoji} **${label} (${xs.length}건)**`);
		for (const x of xs) {
			lines.push(`- **${x.customerName}**: ${x.message}`);
			lines.push(`  → ${x.recommendation}`);
		}
		lines.push("");
	};

	pushSection("🔴", "긴급", urgent);
	pushSection("🟡", "일반", normal);
	pushSection("📌", "확인필요", review);

	if (todayShootings.length > 0) {
		lines.push(`📷 **오늘 촬영 예정 (${todayShootings.length}건)**`);
		for (const c of todayShootings) {
			const cname = c.고객명 || c.톡톡ID || "(이름없음)";
			const kind = c.촬영종류 || "-";
			lines.push(`- ${cname}: ${kind}`);
		}
	}

	let content = lines.join("\n").trimEnd();
	if (content.length > DAILY_EMBED_LIMIT) {
		content = content.slice(0, DAILY_EMBED_LIMIT) + "\n…(생략)";
	}
	return { title, content };
}

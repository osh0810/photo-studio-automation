import { ALERT_COLORS, AlertLevel } from "../types";

/**
 * KST(UTC+9) 기준 `YYYY-MM-DD HH:mm:ss KST` 문자열.
 * Discord embed의 `timestamp` 필드는 UTC ISO를 요구하고 클라이언트 로케일로
 * 렌더링되므로, 한국시간 고정 표시용으로 footer에 별도로 넣는다.
 */
function formatKstTimestamp(date: Date): string {
	const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
	const pad = (n: number) => n.toString().padStart(2, "0");
	const yyyy = kst.getUTCFullYear();
	const mm = pad(kst.getUTCMonth() + 1);
	const dd = pad(kst.getUTCDate());
	const hh = pad(kst.getUTCHours());
	const mi = pad(kst.getUTCMinutes());
	const ss = pad(kst.getUTCSeconds());
	return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} KST`;
}

export async function sendDiscordAlert(
	webhookUrl: string,
	level: AlertLevel,
	title: string,
	content: string,
): Promise<void> {
	const now = new Date();
	const payload = {
		embeds: [
			{
				title: `[${level}] ${title}`,
				description: content,
				color: ALERT_COLORS[level],
				timestamp: now.toISOString(),
				footer: { text: formatKstTimestamp(now) },
			},
		],
	};

	const res = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`Discord webhook 호출 실패: ${res.status} ${res.statusText} — ${body}`,
		);
	}
}

/**
 * 네이버 톡톡 파트너 "보내기" API 클라이언트.
 *
 *   POST https://gw.talk.naver.com/chatbot/v1/event
 *   Headers:
 *     Content-Type: application/json;charset=UTF-8
 *     Authorization: ${NAVER_TALK_TOKEN}
 *   Body:
 *     {
 *       "event": "send",
 *       "user": "<talkId>",
 *       "textContent": { "text": "<message>" },
 *       "options": { "notification": true }
 *     }
 *
 *   ※ options.notification: 고객 단말에 push 알림을 띄울지 여부. 파트너 API 기본값이
 *     false 라 명시하지 않으면 고객 폰에 알림이 안 뜬다 (챗봇 능동 발송 케이스에선 true 필수).
 *     참고: https://github.com/navertalk/chatbot-api
 *
 * 응답:
 *   2xx + { "success": true, ... } 또는 { "resultCode": "00", ... } 이면 성공.
 *   파트너 API가 버전에 따라 두 포맷을 섞어 쓰므로 둘 다 받아준다.
 *   4xx / 5xx / 네트워크 에러는 throw NaverTalkApiError — retry 헬퍼가
 *   status 필드로 재시도 여부를 판정한다.
 */

import type { Env } from "../types";

const NAVER_TALK_SEND_URL = "https://gw.talk.naver.com/chatbot/v1/event";

export class NaverTalkApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body: string,
	) {
		super(message);
		this.name = "NaverTalkApiError";
	}
}

export interface NaverTalkSendResult {
	/** API 레벨 성공 여부 (HTTP 2xx && resultCode 가 성공). */
	success: boolean;
	/** 네이버 응답의 resultCode (예: "00"). 없으면 undefined. */
	resultCode?: string;
	/** API 응답 본문 그대로 (디버깅 / 시스템로그에 남길 용도). */
	raw: unknown;
	/** 요청 시작 → 응답 수신까지 걸린 시간 (ms). */
	durationMs: number;
}

export interface NaverTalkSendOptions {
	/**
	 * 고객 단말에 push 알림을 띄울지. 기본 true (챗봇이 능동적으로 고객에게 말을 거는
	 * 모든 케이스 — 원본발송/보정본발송/추가보정발송/액자발주 안내 등).
	 * 조용히 보내고 싶을 때(예: 동일 내용 재전송, 관리용 주석)만 false.
	 */
	notification?: boolean;
}

/**
 * success 판정 기준:
 *   1) HTTP status 2xx.
 *   2) body 에 `success: false` 명시가 없고, `resultCode` 가 없거나 "00".
 *
 * 네이버 파트너 API 가 HTTP 200 을 주면서도 본문에 에러 코드를 돌려주는
 * 케이스가 있어서 두 레벨을 모두 확인한다.
 */
function isNaverSuccess(body: unknown): {
	success: boolean;
	resultCode?: string;
} {
	if (!body || typeof body !== "object") return { success: true };
	const obj = body as Record<string, unknown>;
	const resultCode =
		typeof obj.resultCode === "string" ? obj.resultCode : undefined;
	const explicitSuccess = obj.success;
	if (explicitSuccess === false) return { success: false, resultCode };
	if (resultCode !== undefined && resultCode !== "00") {
		return { success: false, resultCode };
	}
	return { success: true, resultCode };
}

export async function sendNaverTalkMessage(
	env: Env,
	talkId: string,
	message: string,
	opts: NaverTalkSendOptions = {},
): Promise<NaverTalkSendResult> {
	const startedAt = Date.now();
	const notification = opts.notification ?? true;
	const payload = {
		event: "send",
		user: talkId,
		textContent: { text: message },
		options: { notification },
	};

	let res: Response;
	try {
		res = await fetch(NAVER_TALK_SEND_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json;charset=UTF-8",
				Authorization: env.NAVER_TALK_TOKEN,
			},
			body: JSON.stringify(payload),
		});
	} catch (err) {
		// fetch 자체가 throw — 네트워크/DNS/timeout. retry 헬퍼가 재시도.
		const reason = err instanceof Error ? err.message : String(err);
		throw new NaverTalkApiError(`네이버 톡톡 네트워크 오류: ${reason}`, 0, "");
	}

	const rawBody = await res.text();
	const durationMs = Date.now() - startedAt;

	if (!res.ok) {
		// 4xx/5xx — retry 는 5xx/429 만 재시도한다 (status 로 판별).
		throw new NaverTalkApiError(
			`네이버 톡톡 API 실패 (${res.status})`,
			res.status,
			rawBody,
		);
	}

	let parsed: unknown;
	try {
		parsed = rawBody ? JSON.parse(rawBody) : {};
	} catch {
		// 본문이 JSON 이 아니어도 HTTP 200 이면 성공 취급 — 원문은 raw 로 전달.
		return {
			success: true,
			raw: rawBody,
			durationMs,
		};
	}

	const { success, resultCode } = isNaverSuccess(parsed);
	return { success, resultCode, raw: parsed, durationMs };
}

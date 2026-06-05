/**
 * Gmail API 클라이언트 (Phase 4).
 *
 * - access_token은 호출자가 google-tokens.getValidAccessToken으로 받아 전달.
 * - REST API v1 (라이브러리 없음).
 */

interface GmailMessageHeader {
	name: string;
	value: string;
}

interface GmailMessagePart {
	partId?: string;
	mimeType?: string;
	filename?: string;
	headers?: GmailMessageHeader[];
	body?: {
		size?: number;
		data?: string;
		attachmentId?: string;
	};
	parts?: GmailMessagePart[];
}

export interface GmailMessage {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet?: string;
	historyId?: string;
	internalDate?: string;
	payload?: GmailMessagePart;
	sizeEstimate?: number;
}

export interface GmailListResponse {
	messages?: Array<{ id: string; threadId: string }>;
	nextPageToken?: string;
	resultSizeEstimate?: number;
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * 메시지 목록 조회.
 * query 예: 'from:naverbooking_noreply@navercorp.com after:2026/05/09'
 */
export async function listMessages(
	accessToken: string,
	query: string,
	maxResults = 10,
	pageToken?: string,
): Promise<GmailListResponse> {
	const params = new URLSearchParams({
		q: query,
		maxResults: String(maxResults),
	});
	if (pageToken) params.set('pageToken', pageToken);

	const res = await fetch(`${GMAIL_API_BASE}/messages?${params}`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => '');
		console.error(
			`[gmail-client] listMessages 실패 status=${res.status}: ${errText.slice(0, 300)}`,
		);
		throw new Error(`Gmail API listMessages failed: ${res.status}`);
	}

	return (await res.json()) as GmailListResponse;
}

/**
 * 메시지 상세 조회 (full format으로 본문 + 헤더 모두 가져옴).
 */
export async function getMessage(
	accessToken: string,
	messageId: string,
): Promise<GmailMessage> {
	const res = await fetch(
		`${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}?format=full`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);

	if (!res.ok) {
		const errText = await res.text().catch(() => '');
		console.error(
			`[gmail-client] getMessage 실패 id=${messageId} status=${res.status}: ${errText.slice(0, 300)}`,
		);
		throw new Error(`Gmail API getMessage failed: ${res.status}`);
	}

	return (await res.json()) as GmailMessage;
}

/**
 * 메시지에서 헤더 값 추출 (대소문자 무시).
 */
export function getHeader(message: GmailMessage, name: string): string | null {
	const headers = message.payload?.headers || [];
	const target = name.toLowerCase();
	const header = headers.find((h) => h.name.toLowerCase() === target);
	return header?.value || null;
}

/**
 * Gmail body.data는 base64url 인코딩 → UTF-8 문자열로 디코딩.
 */
function base64UrlDecode(s: string): string {
	let str = s.replace(/-/g, '+').replace(/_/g, '/');
	while (str.length % 4) str += '=';
	const bin = atob(str);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * 메시지 본문에서 text/plain 추출.
 * payload.parts 재귀 탐색.
 */
export function extractPlainBody(message: GmailMessage): string | null {
	const payload = message.payload;
	if (!payload) return null;

	// 단일 파트
	if (payload.mimeType === 'text/plain' && payload.body?.data) {
		return base64UrlDecode(payload.body.data);
	}

	function findTextPart(part: GmailMessagePart): string | null {
		if (part.mimeType === 'text/plain' && part.body?.data) {
			return base64UrlDecode(part.body.data);
		}
		if (part.parts) {
			for (const sub of part.parts) {
				const result = findTextPart(sub);
				if (result) return result;
			}
		}
		return null;
	}

	return findTextPart(payload);
}

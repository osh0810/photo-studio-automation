/**
 * 카카오 OAuth 토큰 관리 + 카카오톡 메시지 발송.
 *
 * - getValidKakaoToken(env): 만료 5분 전이면 refresh_token으로 자동 갱신.
 * - sendKakaoMessage(env, text): 카카오톡 나에게 보내기 (단일 메시지, ≤200자).
 * - sendKakaoMessageLong(env, fullText): 줄바꿈 기준 200자 분할 순차 발송.
 *
 * 토큰은 kakao_tokens 테이블 id=1 싱글턴으로 저장됨.
 * 갱신 실패 시 null 반환 — /auth/kakao 재진행 필요.
 */

interface Env {
	DB: D1Database;
	KAKAO_REST_API_KEY: string;
	KAKAO_CLIENT_SECRET?: string;
	[key: string]: unknown;
}

interface KakaoTokenRow {
	id: number;
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: string;
	updated_at: string;
}

const REFRESH_BEFORE_MINUTES = 5;

function parseSqliteDatetime(s: string): Date {
	return new Date(s.replace(' ', 'T') + 'Z');
}

function toSqliteDatetime(d: Date): string {
	return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

export async function getValidKakaoToken(env: Env): Promise<string | null> {
	const row = await env.DB.prepare(
		`SELECT id, user_id, access_token, refresh_token, expires_at, updated_at
		 FROM kakao_tokens WHERE id = 1`,
	).first<KakaoTokenRow>();

	if (!row) {
		console.warn('[kakao-tokens] 토큰 없음 — /auth/kakao 필요');
		return null;
	}

	const now = new Date();
	const expiresAt = parseSqliteDatetime(row.expires_at);
	const refreshThreshold = new Date(
		expiresAt.getTime() - REFRESH_BEFORE_MINUTES * 60 * 1000,
	);

	if (now < refreshThreshold) {
		return row.access_token;
	}

	console.log('[kakao-tokens] access_token 갱신 시작');

	const refreshParams: Record<string, string> = {
		grant_type: 'refresh_token',
		client_id: env.KAKAO_REST_API_KEY,
		refresh_token: row.refresh_token,
	};
	if (env.KAKAO_CLIENT_SECRET) refreshParams.client_secret = env.KAKAO_CLIENT_SECRET;

	const refreshRes = await fetch('https://kauth.kakao.com/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(refreshParams),
	});

	if (!refreshRes.ok) {
		const errText = await refreshRes.text();
		console.error('[kakao-tokens] 갱신 실패:', errText);
		return null;
	}

	const refreshed = (await refreshRes.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
		refresh_token_expires_in?: number;
	};

	const newExpiresAt = toSqliteDatetime(
		new Date(Date.now() + refreshed.expires_in * 1000),
	);

	// 카카오는 refresh 시 새 refresh_token을 내려줄 수 있음 (있으면 갱신)
	const newRefreshToken = refreshed.refresh_token ?? row.refresh_token;

	await env.DB.prepare(
		`UPDATE kakao_tokens
		 SET access_token = ?1, refresh_token = ?2, expires_at = ?3, updated_at = datetime('now')
		 WHERE id = 1`,
	)
		.bind(refreshed.access_token, newRefreshToken, newExpiresAt)
		.run();

	console.log(`[kakao-tokens] 갱신 완료, 새 expires_at: ${newExpiresAt}`);
	return refreshed.access_token;
}

export async function sendKakaoMessage(env: Env, text: string): Promise<void> {
	const accessToken = await getValidKakaoToken(env);
	if (!accessToken) {
		throw new Error('[kakao] 토큰 없음 — /auth/kakao 필요');
	}

	const templateObject = JSON.stringify({
		object_type: 'text',
		text,
		link: {
			web_url: 'https://studio-task-safeguard.koreakyw0822.workers.dev/chat',
			mobile_web_url: 'https://studio-task-safeguard.koreakyw0822.workers.dev/chat',
		},
	});

	const res = await fetch(
		'https://kapi.kakao.com/v2/api/talk/memo/default/send',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ template_object: templateObject }),
		},
	);

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`[kakao] 메시지 발송 실패 ${res.status}: ${errText}`);
	}

	console.log('[kakao] 메시지 발송 완료');
}

export async function sendKakaoMessageLong(
	env: Env,
	fullText: string,
): Promise<void> {
	const MAX_LEN = 200;
	const chunks: string[] = [];

	const lines = fullText.split('\n');
	let current = '';

	for (const line of lines) {
		const candidate = current ? current + '\n' + line : line;
		if (candidate.length > MAX_LEN) {
			if (current) chunks.push(current.trim());
			current = line;
		} else {
			current = candidate;
		}
	}
	if (current.trim()) chunks.push(current.trim());

	for (let i = 0; i < chunks.length; i++) {
		const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n` : '';
		await sendKakaoMessage(env, prefix + chunks[i]);
		if (i < chunks.length - 1) {
			await new Promise<void>((r) => setTimeout(r, 100));
		}
	}
}

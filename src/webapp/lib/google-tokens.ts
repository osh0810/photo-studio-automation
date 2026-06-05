/**
 * Google OAuth 토큰 관리 유틸 (Phase 4 — Gmail/Calendar API).
 *
 * - getValidAccessToken(env): 만료 5분 전이면 refresh_token으로 자동 갱신.
 * - getTokenStatus(env): 디버그용 상태 조회.
 *
 * 토큰은 google_tokens 테이블 id=1 싱글턴으로 저장됨.
 * 갱신 실패(invalid_grant 등) 시 null 반환 — 작가님이 /auth/google?reauth=1
 * 다시 진행해야 함.
 */

interface Env {
	DB: D1Database;
	GOOGLE_OAUTH_CLIENT_ID: string;
	GOOGLE_OAUTH_CLIENT_SECRET: string;
}

interface GoogleTokenRow {
	id: number;
	user_email: string;
	access_token: string;
	refresh_token: string;
	expires_at: string;
	scope: string;
	updated_at: string;
}

const REFRESH_BEFORE_MINUTES = 5;

/** SQLite datetime('YYYY-MM-DD HH:MM:SS') → Date(UTC) 안전 파싱. */
function parseSqliteDatetime(s: string): Date {
	// 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DDTHH:MM:SSZ'
	return new Date(s.replace(' ', 'T') + 'Z');
}

function toSqliteDatetime(d: Date): string {
	return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * 유효한 access_token 반환. 필요 시 refresh.
 * 토큰 없거나 갱신 실패 시 null (호출자가 reauth 안내 처리).
 */
export async function getValidAccessToken(env: Env): Promise<string | null> {
	const row = await env.DB.prepare(
		`SELECT id, user_email, access_token, refresh_token, expires_at, scope, updated_at
		 FROM google_tokens WHERE id = 1`,
	).first<GoogleTokenRow>();

	if (!row) {
		console.warn('[google-tokens] 토큰 없음 — /auth/google?reauth=1 필요');
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

	// 갱신 필요
	console.log('[google-tokens] access_token 갱신 시작');

	const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: env.GOOGLE_OAUTH_CLIENT_ID,
			client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
			refresh_token: row.refresh_token,
			grant_type: 'refresh_token',
		}),
	});

	if (!refreshRes.ok) {
		const errText = await refreshRes.text();
		console.error('[google-tokens] 갱신 실패:', errText);
		if (refreshRes.status === 400 || errText.includes('invalid_grant')) {
			console.error(
				'[google-tokens] refresh_token 무효 — /auth/google?reauth=1 재진행 필요',
			);
		}
		return null;
	}

	const refreshed = (await refreshRes.json()) as {
		access_token: string;
		expires_in: number;
		scope?: string;
		token_type?: string;
	};

	const newExpiresAt = toSqliteDatetime(
		new Date(Date.now() + refreshed.expires_in * 1000),
	);

	await env.DB.prepare(
		`UPDATE google_tokens
		 SET access_token = ?1, expires_at = ?2, updated_at = datetime('now')
		 WHERE id = 1`,
	)
		.bind(refreshed.access_token, newExpiresAt)
		.run();

	console.log(`[google-tokens] 갱신 완료, 새 expires_at: ${newExpiresAt}`);

	return refreshed.access_token;
}

/**
 * 토큰 상태 조회 (디버그용).
 */
export async function getTokenStatus(env: Env): Promise<{
	exists: boolean;
	user_email?: string;
	expires_at?: string;
	scope?: string;
	expired?: boolean;
}> {
	const row = await env.DB.prepare(
		`SELECT user_email, expires_at, scope FROM google_tokens WHERE id = 1`,
	).first<{ user_email: string; expires_at: string; scope: string }>();

	if (!row) return { exists: false };

	const expired = new Date() > parseSqliteDatetime(row.expires_at);
	return {
		exists: true,
		user_email: row.user_email,
		expires_at: row.expires_at,
		scope: row.scope,
		expired,
	};
}

/**
 * 파일 프록시 링크 생성/조회.
 * Drive URL을 만료 가능한 단기 프록시 URL로 변환한다.
 */

const TOKEN_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateToken(length = 10): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join('');
}

export async function createProxyToken(
	db: D1Database,
	originalUrl: string,
	bookingId: string,
	linkType: 'original' | 'retouched' | 'revision',
	expiresInDays: number,
	baseUrl: string,
): Promise<string> {
	const token = generateToken();
	const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d{3}Z$/, '');

	await db
		.prepare(
			`INSERT INTO file_proxy_tokens (token, original_url, booking_id, link_type, expires_at)
			 VALUES (?1, ?2, ?3, ?4, ?5)`,
		)
		.bind(token, originalUrl, bookingId, linkType, expiresAt)
		.run();

	return `${baseUrl}/f/${token}`;
}

export interface ProxyTokenRow {
	token: string;
	original_url: string;
	booking_id: string | null;
	link_type: string | null;
	expires_at: string;
}

export async function lookupProxyToken(
	db: D1Database,
	token: string,
): Promise<{ row: ProxyTokenRow; expired: boolean } | null> {
	const row = await db
		.prepare(`SELECT * FROM file_proxy_tokens WHERE token = ?1 LIMIT 1`)
		.bind(token)
		.first<ProxyTokenRow>();

	if (!row) return null;

	const expired = new Date(row.expires_at + 'Z') < new Date();
	return { row, expired };
}

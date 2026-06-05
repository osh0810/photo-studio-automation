/**
 * 세션 관리 모듈.
 * 로그인 후 세션 ID를 쿠키로 발급하고, 요청마다 검증.
 */

interface Session {
  session_id: string;
  user_email: string;
  expires_at: string;
  created_at: string;
  user_agent?: string;
}

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7일

/**
 * 새 세션 생성 + DB 저장.
 */
export async function createSession(
  db: D1Database,
  userEmail: string,
  userAgent?: string
): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  
  await db.prepare(
    `INSERT INTO sessions (session_id, user_email, expires_at, created_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    sessionId,
    userEmail,
    expiresAt.toISOString(),
    now.toISOString(),
    userAgent || null
  ).run();
  
  return { sessionId, expiresAt };
}

/**
 * 세션 ID로 사용자 정보 조회.
 * 만료되었거나 없으면 null.
 */
export async function getSession(
  db: D1Database,
  sessionId: string
): Promise<Session | null> {
  const row = await db.prepare(
    `SELECT * FROM sessions WHERE session_id = ?`
  ).bind(sessionId).first<Session>();
  
  if (!row) return null;
  
  // 만료 검사
  if (new Date(row.expires_at) < new Date()) {
    // 만료된 세션 정리 (선택)
    await db.prepare(`DELETE FROM sessions WHERE session_id = ?`).bind(sessionId).run();
    return null;
  }
  
  return row;
}

/**
 * 로그아웃 - 세션 삭제.
 */
export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE session_id = ?`).bind(sessionId).run();
}

/**
 * 만료된 세션 정리 (Cron으로 실행).
 */
export async function cleanupExpiredSessions(db: D1Database): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `DELETE FROM sessions WHERE expires_at < ?`
  ).bind(now).run();
  return result.meta.changes ?? 0;
}

/**
 * 쿠키에서 세션 ID 추출.
 */
export function getSessionIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'session_id') return value;
  }
  return null;
}

/**
 * 세션 쿠키 헤더 생성.
 */
export function createSessionCookie(sessionId: string, expiresAt: Date): string {
  const expires = expiresAt.toUTCString();
  return `session_id=${sessionId}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * 로그아웃용 쿠키 (즉시 만료).
 */
export function createLogoutCookie(): string {
  return `session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}
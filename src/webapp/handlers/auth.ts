/**
 * Google OAuth 인증 핸들러.
 * 
 * 흐름:
 *   GET /auth/login   → Google OAuth 페이지로 리다이렉트
 *   GET /auth/callback → 코드 받아서 토큰 교환 + 세션 생성
 *   POST /auth/logout → 세션 삭제
 */

import {
  createSession,
  deleteSession,
  getSessionIdFromRequest,
  createSessionCookie,
  createLogoutCookie,
} from '../lib/session';

interface Env {
  DB: D1Database;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  ALLOWED_EMAIL: string;
}

/**
 * 환경에 따라 redirect URI 결정.
 */
function getRedirectUri(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/auth/callback`;
}

/**
 * SQLite datetime 형식으로 변환 ('YYYY-MM-DD HH:MM:SS', UTC).
 * Phase 3 message_at 버그 교훈: 'T' 포함 ISO 8601은 SQLite datetime() 결과와
 * 문자열 비교가 깨짐.
 */
function toSqliteDatetime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * GET /auth/google?reauth=1 - Phase 4+: Gmail/Calendar scope 동의 + refresh_token 발급.
 *
 * 기존 /auth/login은 Phase 1 로그인용으로 유지(scope: openid email profile,
 * access_type: online). 이 라우트는 별도로 offline scope를 요구해 refresh_token을
 * google_tokens 테이블(id=1)에 저장한다.
 */
export async function handleReauth(request: Request, env: Env): Promise<Response> {
  const redirectUri = getRedirectUri(request);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope:
      'openid email profile ' +
      'https://www.googleapis.com/auth/gmail.readonly ' +
      'https://www.googleapis.com/auth/calendar.events ' +
      'https://www.googleapis.com/auth/drive',
    access_type: 'offline',
    prompt: 'consent',
    state: 'reauth',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return Response.redirect(authUrl, 302);
}

/**
 * GET /auth/login - Google OAuth 로그인 시작.
 */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const redirectUri = getRedirectUri(request);
  
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return Response.redirect(authUrl, 302);
}

/**
 * GET /auth/callback - OAuth 콜백, 코드 교환.
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return new Response(`OAuth 에러: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response('인증 코드 누락', { status: 400 });
  }

  const redirectUri = getRedirectUri(request);

  // 1. 토큰 교환 (공통)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[auth] 토큰 교환 실패:', errText);
    return new Response(`토큰 교환 실패: ${errText}`, { status: 500 });
  }

  const tokenData = (await tokenRes.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!tokenData.id_token) {
    return new Response('id_token 없음', { status: 500 });
  }

  // 2. id_token에서 이메일 추출 (간단 디코딩, 검증은 Google이 함)
  const idToken = tokenData.id_token;
  const payload = JSON.parse(
    atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
  );

  const userEmail: string = payload.email;
  if (!userEmail) {
    return new Response('이메일 정보 없음', { status: 500 });
  }

  // 3. 허용된 이메일인지 확인
  if (userEmail !== env.ALLOWED_EMAIL) {
    return new Response(
      `<h1>접근 거부</h1><p>이 시스템에 접근 권한이 없습니다: ${userEmail}</p>`,
      {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }

  // 4. 분기: reauth(Phase 4) vs 일반 로그인(Phase 1)
  if (state === 'reauth') {
    if (!tokenData.refresh_token) {
      console.error('[auth] reauth인데 refresh_token 없음 — Google 측 캐시 가능');
      return new Response(
        `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>refresh_token 미발급</title>` +
          `<style>body{font-family:-apple-system;max-width:560px;margin:50px auto;padding:20px;line-height:1.6}h1{color:#ef4444}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>` +
          `<body><h1>⚠️ refresh_token이 발급되지 않았습니다</h1>` +
          `<p>Google 측 캐시 때문일 수 있습니다. 다음 순서로 시도해주세요:</p>` +
          `<ol><li><a href="https://myaccount.google.com/permissions" target="_blank">Google 계정 → 보안 → 사용자 액세스</a> 페이지로 이동</li>` +
          `<li>"마음껏스튜디오" 권한 삭제</li>` +
          `<li><a href="/auth/google?reauth=1"><code>/auth/google?reauth=1</code></a> 다시 접속</li></ol>` +
          `</body></html>`,
        { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    const expiresAt = toSqliteDatetime(
      new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000),
    );

    await env.DB.prepare(
      `INSERT INTO google_tokens (id, user_email, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (1, ?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         user_email = excluded.user_email,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = datetime('now')`,
    )
      .bind(
        userEmail,
        tokenData.access_token ?? '',
        tokenData.refresh_token,
        expiresAt,
        tokenData.scope ?? '',
      )
      .run();

    console.log(`[auth] reauth 성공: user=${userEmail}, scope=${tokenData.scope}`);

    return new Response(
      `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>권한 동의 완료</title>` +
        `<style>body{font-family:-apple-system;max-width:500px;margin:50px auto;padding:20px;text-align:center;line-height:1.6}h1{color:#22c55e}</style></head>` +
        `<body><h1>✅ 권한 동의 완료</h1>` +
        `<p>Gmail + Calendar 접근 권한이 등록되었습니다.</p>` +
        `<p>5분 이내에 cron이 새 메일을 처리합니다.</p>` +
        `<p><a href="/">홈으로</a></p>` +
        `</body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // 5. 일반 로그인 — 세션 생성
  const userAgent = request.headers.get('User-Agent') || undefined;
  const { sessionId, expiresAt } = await createSession(env.DB, userEmail, userAgent);

  // 6. 쿠키 설정 + 메인(채팅)으로 리다이렉트
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': createSessionCookie(sessionId, expiresAt),
    },
  });
}

/**
 * POST /auth/logout - 로그아웃.
 */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = getSessionIdFromRequest(request);
  if (sessionId) {
    await deleteSession(env.DB, sessionId);
  }
  
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/login',
      'Set-Cookie': createLogoutCookie(),
    },
  });
}

/**
 * 인증 미들웨어 - 보호된 라우트에서 호출.
 * 인증 실패 시 /login으로 리다이렉트.
 */
export async function requireAuth(
  request: Request,
  env: Env
): Promise<{ userEmail: string } | Response> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) {
    return Response.redirect(new URL('/login', request.url).toString(), 302);
  }
  
  const { getSession } = await import('../lib/session');
  const session = await getSession(env.DB, sessionId);
  
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/login',
        'Set-Cookie': createLogoutCookie(),
      },
    });
  }
  
  return { userEmail: session.user_email };
}
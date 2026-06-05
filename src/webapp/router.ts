/**
 * 웹앱 라우터 - 새 시스템 진입점.
 * 기존 webhook 시스템과 별도 경로로 통합.
 */

import { handleLogin, handleCallback, handleLogout, handleReauth, requireAuth } from './handlers/auth';
import { renderLoginPage } from './ui/login';
import { renderDashboardPage } from './ui/dashboard';
import { renderChatPage } from './ui/chat';
import {
  handleGetBookings,
  handleGetBookingDetail,
  handleGetStats,
  handleGetDashboardBookings,
  handlePatchMilestone,
  handleManualBooking,
  handleProductSearch,
} from './handlers/dashboard-api';
import {
  handleGetMessages,
  handleSend,
  handleAIProcess,
  handleChatConfirm,
} from './handlers/chat-api';
import { handleRulesPage, handleGetRules, handleToggleRule } from './handlers/rules';
import { handleReportPage, handleGetReport } from './handlers/report';
import {
  handleGetVapidPublicKey,
  handleSubscribe,
  handleUnsubscribe,
} from './handlers/push-api';
import { handleFrameOrderWebhook } from './handlers/frame-order-webhook';
import { MANIFEST_JSON } from './static/manifest';
import { SW_JS } from './static/sw';
import { ICON_SVG } from './static/icon';
import { getValidKakaoToken, sendKakaoMessageLong } from './lib/kakao-client';

interface Env {
  DB: D1Database;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ALLOWED_EMAIL: string;
  ANTHROPIC_API_KEY: string;
  AI_DAILY_LIMIT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  [key: string]: unknown;
}

export async function handleWebappRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // ==========================================
  // 인증 관련 (인증 불필요)
  // ==========================================
  
  if (pathname === '/login' && request.method === 'GET') {
    return new Response(renderLoginPage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  
  if (pathname === '/auth/login' && request.method === 'GET') {
    return handleLogin(request, env);
  }

  // Phase 4: Gmail/Calendar scope 동의 + refresh_token 발급
  if (pathname === '/auth/google'
      && request.method === 'GET'
      && url.searchParams.get('reauth') === '1') {
    return handleReauth(request, env);
  }

  // 카카오 OAuth: 로그인 시작
  if (pathname === '/auth/kakao' && request.method === 'GET') {
    if (!env.KAKAO_REST_API_KEY) {
      return new Response('KAKAO_REST_API_KEY 미설정', { status: 500 });
    }
    const redirectUri = `${new URL(request.url).origin}/auth/kakao/callback`;
    const params = new URLSearchParams({
      client_id: env.KAKAO_REST_API_KEY,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'talk_message',
    });
    return Response.redirect(`https://kauth.kakao.com/oauth/authorize?${params}`, 302);
  }

  // 카카오 OAuth: 콜백 — 코드 → 토큰 교환 + DB 저장
  if (pathname === '/auth/kakao/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) {
      return new Response('code 파라미터 없음', { status: 400 });
    }
    if (!env.KAKAO_REST_API_KEY) {
      return new Response('KAKAO_REST_API_KEY 미설정', { status: 500 });
    }
    const redirectUri = `${new URL(request.url).origin}/auth/kakao/callback`;

    const tokenParams: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: env.KAKAO_REST_API_KEY,
      redirect_uri: redirectUri,
      code,
    };
    if (env.KAKAO_CLIENT_SECRET) tokenParams.client_secret = env.KAKAO_CLIENT_SECRET;

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(`카카오 토큰 발급 실패: ${errText}`, { status: 500 });
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      id?: number;
    };

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '');
    const userId = String(tokenData.id ?? 'kakao_user');

    await env.DB.prepare(
      `INSERT OR REPLACE INTO kakao_tokens
       (id, user_id, access_token, refresh_token, expires_at, created_at, updated_at)
       VALUES (1, ?1, ?2, ?3, ?4, datetime('now'), datetime('now'))`,
    )
      .bind(userId, tokenData.access_token, tokenData.refresh_token, expiresAt)
      .run();

    return new Response(
      '✅ 카카오톡 연동 완료! 창을 닫으셔도 됩니다.',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  if (pathname === '/auth/callback' && request.method === 'GET') {
    return handleCallback(request, env);
  }
  
  if (pathname === '/auth/logout' && request.method === 'POST') {
    return handleLogout(request, env);
  }

  // ==========================================
  // 정적 파일 (PWA 자원, 인증 불필요)
  // ==========================================

  if (pathname === '/manifest.json' && request.method === 'GET') {
    return new Response(MANIFEST_JSON, {
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  if (pathname === '/sw.js' && request.method === 'GET') {
    return new Response(SW_JS, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      },
    });
  }

  if (pathname === '/icon.svg' && request.method === 'GET') {
    return new Response(ICON_SVG, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  // ==========================================
  // 보호된 라우트 - 인증 필요
  // ==========================================

// 메인 페이지 = 채팅
if (pathname === '/' || pathname === '/chat') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;

    return new Response(renderChatPage(auth.userEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

if (pathname === '/dashboard') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;

    return new Response(renderDashboardPage(auth.userEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

// 학습 규칙 페이지 + API
if (pathname === '/rules' && request.method === 'GET') {
    return handleRulesPage(request, env);
}

if (pathname === '/api/rules' && request.method === 'GET') {
    return handleGetRules(request, env);
}

{
    const m = pathname.match(/^\/api\/rules\/(\d+)\/toggle$/);
    if (m && request.method === 'PATCH') {
        return handleToggleRule(request, env, m[1]);
    }
}

// 운영 점검 리포트
if (pathname === '/report' && request.method === 'GET') {
    return handleReportPage(request, env);
}

if (pathname === '/api/report' && request.method === 'GET') {
    return handleGetReport(request, env);
}

// API 라우트 추가
if (pathname === '/api/bookings' && request.method === 'GET') {
    return handleGetBookings(request, env);
}

if (pathname.startsWith('/api/bookings/') && request.method === 'GET') {
    const bookingId = pathname.replace('/api/bookings/', '');
    return handleGetBookingDetail(request, env, bookingId);
}

if (pathname === '/api/stats' && request.method === 'GET') {
    return handleGetStats(request, env);
}

if (pathname === '/api/bookings/manual' && request.method === 'POST') {
    return handleManualBooking(request, env);
}

if (pathname === '/api/products/search' && request.method === 'GET') {
    return handleProductSearch(request, env);
}

// 채팅 API
if (pathname === '/api/chat/messages' && request.method === 'GET') {
    return handleGetMessages(request, env);
}

if (pathname === '/api/chat/send' && request.method === 'POST') {
    return handleSend(request, env);
}

if (pathname === '/api/chat/ai-process' && request.method === 'POST') {
    return handleAIProcess(request, env);
}

if (pathname === '/api/chat/confirm' && request.method === 'POST') {
    return handleChatConfirm(request, env);
}

if (pathname === '/api/chat/trigger-email' && request.method === 'GET') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    try {
        const { handleScheduledEmail } = await import('./lib/cron-email');
        await handleScheduledEmail(env as any);
        return Response.json({ ok: true, message: '메일 확인 완료' });
    } catch (e: any) {
        return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}

// 푸시 API
if (pathname === '/api/push/vapid-public-key' && request.method === 'GET') {
    return handleGetVapidPublicKey(request, env);
}

if (pathname === '/api/push/subscribe' && request.method === 'POST') {
    return handleSubscribe(request, env);
}

if (pathname === '/api/push/subscribe' && request.method === 'DELETE') {
    return handleUnsubscribe(request, env);
}

// 대시보드 v2 API
if (pathname === '/api/dashboard/bookings' && request.method === 'GET') {
  return handleGetDashboardBookings(request, env);
}

{
  const m = pathname.match(/^\/api\/dashboard\/bookings\/([^/]+)\/milestone$/);
  if (m && request.method === 'PATCH') {
    return handlePatchMilestone(request, env, decodeURIComponent(m[1]));
  }
}

// 액자발주 웹훅 (인증: ADMIN_TOKEN, 인증 없음)
if (pathname === '/webhook/frame-order' && request.method === 'POST') {
  return handleFrameOrderWebhook(request, env);
}

  // 매칭 없음 - null 반환 → 메인 라우터가 다음 핸들러 시도
  return null;
}
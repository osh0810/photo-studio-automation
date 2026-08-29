/**
 * 웹앱 라우터 - 새 시스템 진입점.
 * 기존 webhook 시스템과 별도 경로로 통합.
 */

import { handleLogin, handleCallback, handleLogout, handleReauth, requireAuth } from './handlers/auth';
import { renderLoginPage } from './ui/login';
import { renderDashboardPage } from './ui/dashboard';
import { renderChatPage } from './ui/chat';
import { renderCostPage } from './ui/cost';
import {
  handleGetBookings,
  handleGetBookingDetail,
  handleGetStats,
  handleGetDashboardBookings,
  handlePatchMilestone,
  handleManualBooking,
  handleProductSearch,
  handleTalkContacts,
  handleGetCostLog,
  handleGetProxyLinks,
  handleDeleteProxyLink,
  handleGetSettings,
  handlePatchSetting,
} from './handlers/dashboard-api';
import { renderLinksPage } from './ui/links';
import {
  handleGetMessages,
  handleSend,
  handleAIProcess,
  handleChatConfirm,
  handleSkipConfirm,
  handleGetPendingConfirmations,
} from './handlers/chat-api';
import { handleRulesPage, handleGetRules, handleToggleRule } from './handlers/rules';
import {
  handleGetMemos,
  handlePatchMemo,
  handleDeleteMemo,
  handleReorderMemos,
} from './handlers/memo-api';
import { renderMemosPage } from './ui/memo';
import { handleReportPage, handleGetReport } from './handlers/report';
import {
  handleGetVapidPublicKey,
  handleSubscribe,
  handleUnsubscribe,
} from './handlers/push-api';
import { handleFrameOrderWebhook } from './handlers/frame-order-webhook';
import {
  handlePhotoUpload,
  handlePhotoBatchMessage,
  handlePhotoServe,
  handlePhotoThumb,
  handlePhotoCaption,
  handlePhotoGroup,
  handlePhotoUngroupOne,
  handlePhotoGroupDissolve,
  handlePhotoSets,
  handlePhotoStorage,
  handlePhotoSetDelete,
  handlePhotoBookingLink,
  handlePhotoDelete,
  handlePhotoGroupAllDelete,
} from './handlers/photo-handler';
import { MANIFEST_JSON } from './static/manifest';
import { SW_JS } from './static/sw';
import { ICON_SVG } from './static/icon';
import { getValidKakaoToken, sendKakaoMessageLong } from './lib/kakao-client';

interface Env {
  DB: D1Database;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_DRIVE_PHOTOS_FOLDER_ID: string;
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

if (pathname === '/api/talk-contacts' && request.method === 'GET') {
    return handleTalkContacts(request, env);
}

if (pathname === '/api/cost' && request.method === 'GET') {
    return handleGetCostLog(request, env);
}

if (pathname === '/cost' && request.method === 'GET') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    return new Response(renderCostPage(auth.userEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

// 개발 메모 페이지
if (pathname === '/memos' && request.method === 'GET') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    return new Response(renderMemosPage(auth.userEmail), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

// 개발 메모 API
if (pathname === '/api/memos' && request.method === 'GET') {
    return handleGetMemos(request, env);
}

if (pathname === '/api/memos/reorder' && request.method === 'POST') {
    return handleReorderMemos(request, env);
}

{
    const m = pathname.match(/^\/api\/memos\/(\d+)$/);
    if (m && request.method === 'PATCH') {
        return handlePatchMemo(request, env, m[1]);
    }
    if (m && request.method === 'DELETE') {
        return handleDeleteMemo(request, env, m[1]);
    }
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

if (pathname === '/api/chat/pending-confirmations' && request.method === 'GET') {
    return handleGetPendingConfirmations(request, env);
}

if (pathname === '/api/chat/skip-confirm' && request.method === 'POST') {
    return handleSkipConfirm(request, env);
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

// ── Phase 7: 사진 API ────────────────────────────────────────────────────────

if (pathname === '/api/photos/upload' && request.method === 'POST') {
  return handlePhotoUpload(request, env);
}

if (pathname === '/api/photos/batch-message' && request.method === 'POST') {
  return handlePhotoBatchMessage(request, env);
}

if (pathname.startsWith('/api/photos/serve/') && request.method === 'GET') {
  const r2Key = pathname.replace('/api/photos/serve/', '');
  return handlePhotoServe(request, env, r2Key);
}

{
  const m = pathname.match(/^\/api\/photos\/thumb\/(\d+)$/);
  if (m && request.method === 'GET') {
    return handlePhotoThumb(request, env, m[1]);
  }
}

if (pathname === '/api/photos/caption' && request.method === 'POST') {
  return handlePhotoCaption(request, env);
}

if (pathname === '/api/photos/group' && request.method === 'POST') {
  return handlePhotoGroup(request, env);
}

if (pathname === '/api/photos/ungroup-one' && request.method === 'POST') {
  return handlePhotoUngroupOne(request, env);
}

{
  const m = pathname.match(/^\/api\/photos\/group\/([^/]+)$/);
  if (m && request.method === 'DELETE') {
    return handlePhotoGroupDissolve(request, env, m[1]);
  }
}

if (pathname === '/api/photos/sets' && request.method === 'GET') {
  return handlePhotoSets(request, env);
}

if (pathname === '/api/photos/storage' && request.method === 'GET') {
  return handlePhotoStorage(request, env);
}

{
  const m = pathname.match(/^\/api\/photos\/booking\/([^/]+)$/);
  if (m && request.method === 'DELETE') {
    return handlePhotoSetDelete(request, env, m[1]);
  }
}

if (pathname === '/api/photos/booking-link' && request.method === 'POST') {
  return handlePhotoBookingLink(request, env);
}

{
  const m = pathname.match(/^\/api\/photos\/photo\/(\d+)$/);
  if (m && request.method === 'DELETE') {
    return handlePhotoDelete(request, env, m[1]);
  }
}

{
  const m = pathname.match(/^\/api\/photos\/group-all\/([^/]+)$/);
  if (m && request.method === 'DELETE') {
    return handlePhotoGroupAllDelete(request, env, m[1]);
  }
}

// 링크 관리 페이지
if (pathname === '/links' && request.method === 'GET') {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  return new Response(renderLinksPage(auth.userEmail), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// 프록시 링크 API
if (pathname === '/api/proxy-links' && request.method === 'GET') {
  return handleGetProxyLinks(request, env);
}

// 앱 설정 API
if (pathname === '/api/settings' && request.method === 'GET') {
  return handleGetSettings(request, env);
}
if (pathname === '/api/settings' && request.method === 'PATCH') {
  return handlePatchSetting(request, env);
}
{
  const m = pathname.match(/^\/api\/proxy-links\/([A-Za-z0-9]+)$/);
  if (m && request.method === 'DELETE') {
    return handleDeleteProxyLink(request, env, m[1]);
  }
}

// 파일 프록시 링크: /f/:token (인증 불필요, 공개 접근)
{
  const m = pathname.match(/^\/f\/([A-Za-z0-9]+)$/);
  if (m && request.method === 'GET') {
    const { lookupProxyToken } = await import('./lib/proxy-link');
    const result = await lookupProxyToken(env.DB, m[1]);

    if (!result) {
      return new Response('링크를 찾을 수 없습니다.', { status: 404 });
    }

    // 접속 이력 기록 (만료 여부와 무관하게 카운트)
    await env.DB.prepare(
      `UPDATE file_proxy_tokens
       SET access_count = access_count + 1, last_accessed_at = datetime('now')
       WHERE token = ?1`,
    ).bind(m[1]).run().catch(() => {});

    if (result.expired) {
      return new Response(
        `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>링크 만료</title>
        <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9f9f9}
        .box{background:#fff;border-radius:12px;padding:40px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:360px}
        h2{color:#e53e3e;margin-bottom:12px}p{color:#555;line-height:1.6}</style></head>
        <body><div class="box"><h2>링크가 만료되었습니다</h2>
        <p>마음껏스튜디오에 문의해 주세요.</p></div></body></html>`,
        { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    return Response.redirect(result.row.original_url, 302);
  }
}

  // 매칭 없음 - null 반환 → 메인 라우터가 다음 핸들러 시도
  return null;
}
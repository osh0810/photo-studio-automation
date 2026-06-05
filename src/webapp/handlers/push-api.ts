/**
 * 푸시 구독 관리 API.
 *
 *   GET    /api/push/vapid-public-key  — 클라이언트가 subscribe 시 사용할 공개키
 *   POST   /api/push/subscribe         — 구독 등록 (UPSERT)
 *   DELETE /api/push/subscribe         — 구독 해제 (endpoint 기준)
 *
 * 실제 발송은 Step 6b에서 src/webapp/lib/push-sender.ts에 구현 예정.
 */

import { requireAuth } from './auth';

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  [key: string]: unknown;
}

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  // 표준 PushSubscription.toJSON() 형태도 동일
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// ─── GET /api/push/vapid-public-key ───────────────────────────────────

export async function handleGetVapidPublicKey(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const key = env.VAPID_PUBLIC_KEY;
  if (!key) {
    console.log('[push] VAPID_PUBLIC_KEY 미설정 — 구독 비활성');
    return jsonError(503, 'VAPID 키가 설정되지 않았습니다');
  }

  return Response.json({ key });
}

// ─── POST /api/push/subscribe ─────────────────────────────────────────

export async function handleSubscribe(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: SubscribeBody;
  try {
    body = await request.json<SubscribeBody>();
  } catch {
    return jsonError(400, '잘못된 JSON 본문');
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const authKey = body.keys?.auth?.trim();

  if (!endpoint || !p256dh || !authKey) {
    return jsonError(400, 'endpoint, keys.p256dh, keys.auth 모두 필요');
  }

  const userAgent = request.headers.get('User-Agent') || '';
  const now = new Date().toISOString();

  // UPSERT (endpoint UNIQUE)
  await env.DB.prepare(
    `INSERT INTO push_subscriptions
       (user_email, endpoint, keys_p256dh, keys_auth, user_agent, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_email = excluded.user_email,
       keys_p256dh = excluded.keys_p256dh,
       keys_auth = excluded.keys_auth,
       user_agent = excluded.user_agent,
       updated_at = excluded.updated_at`,
  )
    .bind(auth.userEmail, endpoint, p256dh, authKey, userAgent.slice(0, 200), now)
    .run();

  console.log(
    `[push] subscribe ok email=${auth.userEmail} endpoint=${endpoint.slice(0, 60)}...`,
  );

  return Response.json({ success: true });
}

// ─── DELETE /api/push/subscribe ───────────────────────────────────────

export async function handleUnsubscribe(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { endpoint?: string };
  try {
    body = await request.json<{ endpoint?: string }>();
  } catch {
    return jsonError(400, '잘못된 JSON 본문');
  }

  const endpoint = body.endpoint?.trim();
  if (!endpoint) return jsonError(400, 'endpoint 필요');

  const result = await env.DB.prepare(
    `DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_email = ?2`,
  )
    .bind(endpoint, auth.userEmail)
    .run();

  console.log(
    `[push] unsubscribe ok email=${auth.userEmail} changes=${result.meta?.changes ?? 0}`,
  );

  return Response.json({ success: true, deleted: result.meta?.changes ?? 0 });
}

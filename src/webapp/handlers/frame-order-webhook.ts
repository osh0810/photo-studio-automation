/**
 * POST /webhook/frame-order
 *
 * 아트르 발주 시스템에서 액자발주 완료를 수신해 bookings.frame_ordered_at을 업데이트.
 * 인증: Authorization 헤더 == ADMIN_TOKEN
 */

import { sendPushNotification } from '../lib/push-sender';

interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  ALLOWED_EMAIL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  [key: string]: unknown;
}

interface FrameOrderPayload {
  customer_name?: string;
  arttre_order_no?: string;
  ordered_at?: string;
}

interface BookingRow {
  booking_id: string;
  customer_name: string;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function toSqliteDatetime(s: string): string {
  // "2026-05-28 19:46:15" → 그대로 / ISO 8601 → SQLite 형식으로 변환
  return s.replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

async function insertSystemMessage(
  db: D1Database,
  message: string,
  metadataType: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const metadata = JSON.stringify({ type: metadataType, ...extra });
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  await db
    .prepare(
      `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
       VALUES ('system', ?1, ?2, ?3)`,
    )
    .bind(message, metadata, now)
    .run();
}

export async function handleFrameOrderWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  // ── 인증 ────────────────────────────────────────────────────────────────
  if (!env.ADMIN_TOKEN) {
    return jsonError(500, 'ADMIN_TOKEN 미설정');
  }
  const auth = request.headers.get('Authorization') ?? '';
  if (auth !== env.ADMIN_TOKEN) {
    return jsonError(401, '인증 실패');
  }

  // ── payload 파싱 ─────────────────────────────────────────────────────────
  let body: FrameOrderPayload;
  try {
    body = await request.json<FrameOrderPayload>();
  } catch {
    return jsonError(400, '잘못된 JSON 본문');
  }

  const rawName = body.customer_name?.trim();
  const orderNo = body.arttre_order_no?.trim();
  const orderedAt = body.ordered_at?.trim();

  if (!rawName || !orderNo || !orderedAt) {
    return jsonError(400, 'customer_name, arttre_order_no, ordered_at 모두 필요');
  }

  // "님" 제거
  const customerName = rawName.replace(/님$/, '').trim();
  const orderedAtSql = toSqliteDatetime(orderedAt);

  console.log(
    `[frame-order] name="${customerName}" order_no=${orderNo} ordered_at=${orderedAtSql}`,
  );

  // ── 매칭 쿼리 ────────────────────────────────────────────────────────────
  const rows = await env.DB.prepare(
    `SELECT booking_id, customer_name
     FROM bookings
     WHERE ?1 LIKE '%' || customer_name || '%'
       AND cancelled = 0
       AND frame_ordered_at IS NULL`,
  )
    .bind(customerName)
    .all<BookingRow>();

  const matches = rows.results ?? [];

  // ── 0건: 매칭 실패 ────────────────────────────────────────────────────────
  if (matches.length === 0) {
    console.warn(`[frame-order] 매칭 실패: name="${customerName}" order_no=${orderNo}`);

    await insertSystemMessage(
      env.DB,
      `📦 액자발주 매칭 실패\n고객명: ${rawName}\n발주번호: ${orderNo}\n발주일시: ${orderedAt}\n\n취소되지 않은 예약 중 frame_ordered_at이 비어 있는 건을 찾지 못했습니다. 수동으로 확인해 주세요.`,
      'frame_order_unmatched',
      { customer_name: rawName, arttre_order_no: orderNo, ordered_at: orderedAt },
    );

    return Response.json({
      success: false,
      matched: 0,
      message: '매칭되는 예약 없음 — 채팅창에 알림 삽입',
    });
  }

  // ── 2건 이상: 동명이인 ────────────────────────────────────────────────────
  if (matches.length >= 2) {
    console.warn(
      `[frame-order] 동명이인 ${matches.length}건: name="${customerName}" order_no=${orderNo}`,
    );

    const list = matches
      .map((r, i) => `${i + 1}. booking_id=${r.booking_id} / ${r.customer_name}`)
      .join('\n');

    await insertSystemMessage(
      env.DB,
      `📦 액자발주 동명이인 — 수동 선택 필요\n고객명: ${rawName}\n발주번호: ${orderNo}\n발주일시: ${orderedAt}\n\n매칭된 예약 ${matches.length}건:\n${list}\n\n올바른 예약에 frame_ordered_at을 직접 입력해 주세요.`,
      'frame_order_ambiguous',
      {
        customer_name: rawName,
        arttre_order_no: orderNo,
        ordered_at: orderedAt,
        candidates: matches.map((r) => ({
          booking_id: r.booking_id,
          customer_name: r.customer_name,
        })),
      },
    );

    return Response.json({
      success: false,
      matched: matches.length,
      message: `동명이인 ${matches.length}건 — 채팅창에 선택 요청 삽입`,
      candidates: matches.map((r) => r.booking_id),
    });
  }

  // ── 1건: 정상 업데이트 ────────────────────────────────────────────────────
  const booking = matches[0];
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  await env.DB.prepare(
    `UPDATE bookings
     SET frame_ordered_at = ?1,
         updated_at = ?2
     WHERE booking_id = ?3`,
  )
    .bind(orderedAtSql, now, booking.booking_id)
    .run();

  console.log(
    `[frame-order] updated booking_id=${booking.booking_id} frame_ordered_at=${orderedAtSql}`,
  );

  // 완료 시스템 메시지
  await insertSystemMessage(
    env.DB,
    `📦 액자발주 완료\n고객명: ${rawName}\n발주번호: ${orderNo}\n발주일시: ${orderedAt}\n예약번호: ${booking.booking_id}`,
    'frame_order_matched',
    {
      customer_name: rawName,
      arttre_order_no: orderNo,
      ordered_at: orderedAt,
      booking_id: booking.booking_id,
    },
  );

  // 푸시 알림 (실패해도 응답에 영향 없음)
  if (env.ALLOWED_EMAIL) {
    try {
      await sendPushNotification(env, env.ALLOWED_EMAIL, {
        title: '📦 액자발주 완료',
        body: `${rawName} (발주번호: ${orderNo})`,
        tag: `frame-order-${booking.booking_id}`,
      });
    } catch (e) {
      console.error('[frame-order] push 발송 실패:', e);
    }
  }

  return Response.json({
    success: true,
    matched: 1,
    booking_id: booking.booking_id,
    frame_ordered_at: orderedAtSql,
  });
}

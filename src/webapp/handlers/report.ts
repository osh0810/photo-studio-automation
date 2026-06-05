/**
 * 운영 점검 리포트 (Phase 7).
 *
 *   GET /report      — 페이지
 *   GET /api/report  — 9개 쿼리 결과 JSON
 *
 * AI/외부 호출 없이 D1 조회만. 각 쿼리는 독립 try/catch — 한 섹션 실패가
 * 다른 섹션을 깨뜨리지 않는다.
 */

import { requireAuth } from './auth';
import { renderReportPage } from '../ui/report';

interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

export async function handleReportPage(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  return new Response(renderReportPage(auth.userEmail), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

interface Section<T> {
  data: T[];
  error: string | null;
}

async function runQuery<T = Record<string, unknown>>(
  env: Env,
  sql: string,
): Promise<Section<T>> {
  try {
    const res = await env.DB.prepare(sql).all<T>();
    return { data: (res.results || []) as T[], error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[report] query 실패:', msg);
    return { data: [], error: msg };
  }
}

export async function handleGetReport(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const [
    unlinkedBookings,
    noCalendarEvent,
    unmatchedDetails,
    echoIssues,
    emailStats,
    talkStats,
    echoStats,
    calendarStats,
    aiCalls,
  ] = await Promise.all([
    runQuery(
      env,
      `SELECT booking_id, customer_name, reservation_date, created_at
       FROM bookings
       WHERE talk_id IS NULL
         AND cancelled = 0
         AND date(created_at) >= date('now', '-7 days')
       ORDER BY created_at DESC`,
    ),
    runQuery(
      env,
      `SELECT booking_id, customer_name, shoot_date, created_at
       FROM bookings
       WHERE shoot_date IS NOT NULL
         AND calendar_event_id IS NULL
         AND cancelled = 0
       ORDER BY shoot_date ASC`,
    ),
    runQuery(
      env,
      `SELECT bd.id, bd.booking_id, bd.raw_text, b.customer_name
       FROM booking_details bd
       JOIN bookings b ON bd.booking_id = b.booking_id
       WHERE bd.match_status = 'unmatched'
       ORDER BY bd.id DESC
       LIMIT 20`,
    ),
    runQuery(
      env,
      `SELECT id,
              SUBSTR(message, 1, 150) AS preview,
              json_extract(metadata, '$.type') AS type,
              created_at
       FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') IN ('echo_no_booking', 'echo_conflict')
         AND date(created_at) >= date('now', '-7 days')
       ORDER BY id DESC
       LIMIT 20`,
    ),
    runQuery(
      env,
      `SELECT email_type, processing_result, COUNT(*) AS cnt
       FROM processed_emails
       WHERE date(processed_at) = date('now', '-1 day')
       GROUP BY email_type, processing_result`,
    ),
    runQuery(
      env,
      `SELECT processing_status, COUNT(*) AS cnt
       FROM talk_messages
       WHERE date(received_at) = date('now', '-1 day')
       GROUP BY processing_status`,
    ),
    runQuery(
      env,
      `SELECT json_extract(metadata, '$.type') AS type, COUNT(*) AS cnt
       FROM ai_chat_messages
       WHERE date(created_at) = date('now', '-1 day')
         AND json_extract(metadata, '$.type') LIKE 'echo_%'
       GROUP BY type`,
    ),
    runQuery(
      env,
      `SELECT json_extract(metadata, '$.type') AS type, COUNT(*) AS cnt
       FROM ai_chat_messages
       WHERE date(created_at) = date('now', '-1 day')
         AND json_extract(metadata, '$.type') LIKE 'calendar_%'
       GROUP BY type`,
    ),
    runQuery(
      env,
      `SELECT date(created_at) AS day, COUNT(*) AS cnt
       FROM ai_chat_messages
       WHERE date(created_at) >= date('now', '-7 days')
         AND sender = 'ai'
       GROUP BY day
       ORDER BY day DESC`,
    ),
  ]);

  const nowRow = await env.DB.prepare(
    `SELECT datetime('now') AS now`,
  ).first<{ now: string }>();

  const body = {
    generated_at: nowRow?.now ?? '',
    sections: {
      unlinked_bookings: unlinkedBookings,
      no_calendar_event: noCalendarEvent,
      unmatched_details: unmatchedDetails,
      echo_issues: echoIssues,
      stats: {
        email: emailStats,
        talk: talkStats,
        echo: echoStats,
        calendar: calendarStats,
      },
      ai_calls: aiCalls,
    },
  };

  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

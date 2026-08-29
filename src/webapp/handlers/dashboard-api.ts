/**
 * 대시보드 데이터 조회 API.
 */

import { requireAuth } from './auth';
import { createCalendarEventForBooking } from '../lib/calendar-event-builder';
import { createEvent } from '../lib/calendar-client';
import { buildConfirmMessage, type BookingDetailWithProduct } from '../lib/confirm-message-builder';

interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

interface BookingWithCustomer {
  booking_id: string;
  customer_name: string;
  talk_id: string | null;
  product_name: string | null;
  shoot_date: string | null;
  current_stage: string;
  original_sent_at: string | null;
  selection_received_at: string | null;
  retouched_sent_at: string | null;
  revision_requested_at: string | null;
  frame_ordered_at: string | null;
  alert_paused_until: string | null;
  review_status: string | null;
  phone: string | null;
  consultation_channel: string | null;
  memo: string | null;
  updated_at: string;
}

/**
 * GET /api/bookings - 예약 리스트 조회.
 * 쿼리 파라미터:
 *   - search: 고객명 검색
 *   - stage: 단계 필터 (S0~S7, 또는 'all')
 *   - sort: 정렬 (updated_desc, shoot_date_asc 등)
 *   - limit, offset: 페이지네이션
 */
export async function handleGetBookings(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;
  
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() || '';
  const stage = url.searchParams.get('stage') || 'all';
  const sort = url.searchParams.get('sort') || 'updated_desc';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (search) {
    conditions.push(`b.customer_name LIKE ?`);
    params.push(`%${search}%`);
  }
  
  if (stage !== 'all') {
    conditions.push(`b.current_stage LIKE ?`);
    params.push(`${stage}%`);
  }
  
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  
  let orderBy = 'b.updated_at DESC';
  if (sort === 'shoot_date_asc') orderBy = 'b.shoot_date ASC';
  else if (sort === 'shoot_date_desc') orderBy = 'b.shoot_date DESC';
  else if (sort === 'name_asc') orderBy = 'b.customer_name ASC';
  
  const sql = `
    SELECT 
      b.booking_id, b.customer_name, b.talk_id, b.product_name,
      b.shoot_date, b.current_stage, b.original_sent_at,
      b.selection_received_at, b.retouched_sent_at,
      b.revision_requested_at, b.frame_ordered_at,
      b.alert_paused_until, b.review_status, b.updated_at,
      c.phone, c.consultation_channel, c.memo
    FROM bookings b
    LEFT JOIN customers c ON b.talk_id = c.talk_id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  
  params.push(limit, offset);
  
  const result = await env.DB.prepare(sql).bind(...params).all<BookingWithCustomer>();
  
  // 총 개수
  const countSql = `SELECT COUNT(*) as count FROM bookings b ${whereClause}`;
  const countParams = params.slice(0, -2); // limit, offset 제외
  const countResult = await env.DB.prepare(countSql).bind(...countParams).first<{ count: number }>();
  
  return Response.json({
    bookings: result.results,
    total: countResult?.count ?? 0,
    limit,
    offset,
  });
}

/**
 * GET /api/bookings/:id - 단일 예약 상세 조회.
 */
export async function handleGetBookingDetail(
  request: Request,
  env: Env,
  bookingId: string
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;
  
  const sql = `
    SELECT b.*, c.phone, c.consultation_channel, c.memo,
           c.frame_address, c.frame_recipient, c.frame_phone
    FROM bookings b
    LEFT JOIN customers c ON b.talk_id = c.talk_id
    WHERE b.booking_id = ?
  `;
  
  const booking = await env.DB.prepare(sql).bind(bookingId).first();
  
  if (!booking) {
    return Response.json({ error: '예약을 찾을 수 없습니다' }, { status: 404 });
  }
  
  return Response.json({ booking });
}

// ═══════════════════════════════════════════════════════════════
// Dashboard v2 — 새 API
// ═══════════════════════════════════════════════════════════════

interface DashboardBookingRow {
  booking_id: string;
  talk_id: string | null;
  customer_name: string;
  product_name: string | null;
  payment_amount: number | null;
  request_note: string | null;
  reservation_date: string;
  shoot_date: string | null;
  original_sent_at: string | null;
  selection_received_at: string | null;
  selection_cuts: string | null;
  retouched_sent_at: string | null;
  revision_requested_at: string | null;
  revision_content: string | null;
  revision_sent_at: string | null;
  revision_no_more_at: string | null;
  frame_ordered_at: string | null;
  alert_paused_until: string | null;
  urgent_retouch_until: string | null;
  promotion_consent: number;
  current_stage: string;
  cancelled: number;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  calendar_event_id: string | null;
  original_folder_url: string | null;
  retouched_folder_url: string | null;
  created_at: string;
  updated_at: string;
  phone: string | null;
  consultation_channel: string | null;
  memo: string | null;
  frame_address: string | null;
  frame_recipient: string | null;
  frame_phone: string | null;
  has_calendar: number;
  booking_details_raw: string | null;
}

type StageInput = Pick<
  DashboardBookingRow,
  | 'cancelled'
  | 'frame_ordered_at'
  | 'revision_no_more_at'
  | 'revision_sent_at'
  | 'revision_requested_at'
  | 'retouched_sent_at'
  | 'selection_received_at'
  | 'original_sent_at'
  | 'shoot_date'
>;

function computeStage(b: StageInput): string {
  if (b.cancelled) return '취소';
  if (b.frame_ordered_at) return '액자발주완료';
  if (b.revision_no_more_at) return '추가보정없음';
  if (b.revision_requested_at) {
    if (!b.revision_sent_at) return '재보정요청';
    if (b.revision_sent_at >= b.revision_requested_at) return '재보정완료';
    return '재보정요청';
  }
  if (b.retouched_sent_at) return '보정완료';
  if (b.selection_received_at) return '셀렉완료';
  if (b.original_sent_at) return '원본발송완료';
  if (b.shoot_date) return '예약확정';
  return '예약접수';
}

function toSqliteFormat(value: string): string {
  return value.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '');
}

const MILESTONE_FIELDS = new Set([
  'shoot_date',
  'original_sent_at',
  'selection_received_at',
  'selection_cuts',
  'retouched_sent_at',
  'revision_requested_at',
  'revision_sent_at',
  'revision_no_more_at',
  'frame_ordered_at',
  'alert_paused_until',
  'urgent_retouch_until',
]);
const TEXT_FIELDS = new Set(['selection_cuts']);

export async function handleGetDashboardBookings(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() || '';
  const stageFilter = url.searchParams.get('stage') || 'all';
  const sort = url.searchParams.get('sort') || 'updated_at';

  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    conditions.push('b.customer_name LIKE ?');
    params.push(`%${search}%`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy =
    sort === 'shoot_date'
      ? "COALESCE(b.shoot_date, '9999') ASC"
      : 'b.updated_at DESC';

  const sql = `
    SELECT
      b.booking_id, b.talk_id, b.customer_name, b.product_name,
      b.payment_amount, b.request_note, b.reservation_date,
      b.shoot_date, b.original_sent_at, b.selection_received_at,
      b.selection_cuts, b.retouched_sent_at, b.revision_requested_at,
      b.revision_content, b.revision_sent_at, b.revision_no_more_at,
      b.frame_ordered_at, b.alert_paused_until, b.urgent_retouch_until, b.promotion_consent,
      b.current_stage, b.cancelled, b.cancelled_at, b.cancellation_reason,
      b.calendar_event_id, b.original_folder_url, b.retouched_folder_url,
      b.created_at, b.updated_at,
      c.phone, c.consultation_channel, c.memo,
      c.frame_address, c.frame_recipient, c.frame_phone,
      CASE WHEN b.calendar_event_id IS NOT NULL THEN 1 ELSE 0 END AS has_calendar,
      (SELECT GROUP_CONCAT(raw_text, '|||')
       FROM booking_details WHERE booking_id = b.booking_id) AS booking_details_raw
    FROM bookings b
    LEFT JOIN customers c ON b.talk_id = c.talk_id
    ${whereClause}
    ORDER BY ${orderBy}
  `;

  const result = await env.DB.prepare(sql).bind(...params).all<DashboardBookingRow>();

  let bookings = (result.results ?? []).map(row => ({
    ...row,
    has_calendar: Boolean(row.has_calendar),
    booking_details: row.booking_details_raw
      ? row.booking_details_raw.split('|||').filter(Boolean)
      : [],
    computed_stage: computeStage(row),
  }));

  if (stageFilter !== 'all') {
    bookings = bookings.filter(b => b.computed_stage === stageFilter);
  }

  return Response.json({ bookings, total: bookings.length });
}

export async function handlePatchMilestone(
  request: Request,
  env: Env,
  bookingId: string,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { field?: string; value?: string | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '잘못된 JSON 본문' }, { status: 400 });
  }

  const { field, value } = body;

  if (!field || !MILESTONE_FIELDS.has(field)) {
    return Response.json(
      { error: `수정 불가 필드: ${field}. 허용: ${[...MILESTONE_FIELDS].join(', ')}` },
      { status: 400 },
    );
  }

  let sqlValue: string | null = null;
  if (value !== null && value !== undefined && value !== '') {
    sqlValue = TEXT_FIELDS.has(field) ? String(value) : toSqliteFormat(String(value));
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  // field는 화이트리스트로 검증되었으므로 SQL 주입 안전
  await env.DB.prepare(
    `UPDATE bookings SET ${field} = ?1, updated_at = ?2 WHERE booking_id = ?3`,
  ).bind(sqlValue, now, bookingId).run();

  const updated = await env.DB.prepare(
    `SELECT cancelled, frame_ordered_at, revision_no_more_at, revision_sent_at,
            revision_requested_at, retouched_sent_at, selection_received_at,
            original_sent_at, shoot_date
     FROM bookings WHERE booking_id = ?`,
  ).bind(bookingId).first<StageInput>();

  if (!updated) {
    return Response.json({ error: '예약 없음' }, { status: 404 });
  }

  return Response.json({
    success: true,
    field,
    value: sqlValue,
    computed_stage: computeStage(updated),
    updated_at: now,
  });
}

/**
 * GET /api/stats - 대시보드 통계.
 */
export async function handleGetStats(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;
  
  // 단계별 카운트
  const stageStats = await env.DB.prepare(
    `SELECT current_stage, COUNT(*) as count
     FROM bookings
     GROUP BY current_stage`
  ).all<{ current_stage: string; count: number }>();
  
  // 검토 필요
  const reviewNeeded = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings
     WHERE review_status IS NOT NULL AND review_status != ''`
  ).first<{ count: number }>();
  
  // 오늘 촬영
  const todayShoot = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings
     WHERE shoot_date = date('now')`
  ).first<{ count: number }>();
  
  return Response.json({
    stages: stageStats.results,
    reviewNeeded: reviewNeeded?.count ?? 0,
    todayShoot: todayShoot?.count ?? 0,
  });
}

/**
 * GET /api/cost?days=30
 * API 비용 로그 조회 (기간별 집계 + 최근 상세 내역).
 */
export async function handleGetCostLog(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365);

  // 기간별 일일 집계
  const dailyRows = await env.DB.prepare(
    `SELECT
       date(logged_at, '+9 hours') AS day_kst,
       operation,
       COUNT(*) AS call_count,
       SUM(input_tokens)  AS total_input,
       SUM(output_tokens) AS total_output,
       SUM(cost_usd)      AS total_cost_usd
     FROM api_usage_log
     WHERE logged_at >= datetime('now', ?1)
     GROUP BY day_kst, operation
     ORDER BY day_kst DESC, operation`,
  ).bind(`-${days} days`).all<{
    day_kst: string;
    operation: string;
    call_count: number;
    total_input: number;
    total_output: number;
    total_cost_usd: number;
  }>();

  // 요약 (전체 기간)
  const summary = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_calls,
       SUM(input_tokens + output_tokens) AS total_tokens,
       SUM(cost_usd) AS total_cost_usd,
       SUM(CASE WHEN date(logged_at, '+9 hours') = date('now', '+9 hours') THEN cost_usd ELSE 0 END) AS today_cost_usd,
       SUM(CASE WHEN strftime('%Y-%m', logged_at, '+9 hours') = strftime('%Y-%m', 'now', '+9 hours') THEN cost_usd ELSE 0 END) AS month_cost_usd
     FROM api_usage_log
     WHERE logged_at >= datetime('now', ?1)`,
  ).bind(`-${days} days`).first<{
    total_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    today_cost_usd: number;
    month_cost_usd: number;
  }>();

  // 최근 상세 내역 100건
  const recentRows = await env.DB.prepare(
    `SELECT
       id,
       datetime(logged_at, '+9 hours') AS logged_at_kst,
       operation, model,
       input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens,
       cost_usd,
       context_text,
       talk_id
     FROM api_usage_log
     ORDER BY logged_at DESC
     LIMIT 100`,
  ).all<{
    id: number;
    logged_at_kst: string;
    operation: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
    context_text: string | null;
    talk_id: string | null;
  }>();

  return Response.json({
    summary: summary ?? { total_calls: 0, total_tokens: 0, total_cost_usd: 0, today_cost_usd: 0, month_cost_usd: 0 },
    daily: dailyRows.results,
    recent: recentRows.results,
  });
}

/**
 * GET /api/talk-contacts?q=검색어
 * 기존 customers(이름/전화) + talk_messages 전용 고객(대화내용) 통합 검색.
 */
export async function handleTalkContacts(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return Response.json({ customers: [], talkOnly: [] });

  const like = `%${q}%`;

  // 1. customers 테이블에서 이름 또는 전화번호 검색 (실제 talk_id 있는 것만)
  const custResult = await env.DB.prepare(
    `SELECT talk_id, customer_name, phone
     FROM customers
     WHERE talk_id NOT LIKE 'MANUAL_%'
       AND (customer_name LIKE ?1 OR phone LIKE ?1)
     ORDER BY updated_at DESC
     LIMIT 15`,
  ).bind(like).all<{ talk_id: string; customer_name: string; phone: string | null }>();

  // 2. talk_messages에서 대화 내용 검색 (customers에 없는 talk_id만)
  const talkResult = await env.DB.prepare(
    `SELECT
       tm.talk_id,
       tm.message_content AS matched_message,
       tm.message_at      AS matched_at,
       (SELECT message_content FROM talk_messages
        WHERE talk_id = tm.talk_id AND sender_type = 'customer'
        ORDER BY message_at DESC LIMIT 1) AS last_message,
       (SELECT message_at FROM talk_messages
        WHERE talk_id = tm.talk_id
        ORDER BY message_at DESC LIMIT 1) AS last_message_at
     FROM talk_messages tm
     WHERE tm.message_content LIKE ?1
       AND tm.talk_id NOT IN (SELECT talk_id FROM customers WHERE talk_id IS NOT NULL)
     GROUP BY tm.talk_id
     ORDER BY tm.message_at DESC
     LIMIT 10`,
  ).bind(like).all<{
    talk_id: string;
    matched_message: string;
    matched_at: string;
    last_message: string | null;
    last_message_at: string | null;
  }>();

  return Response.json({ customers: custResult.results, talkOnly: talkResult.results });
}

/**
 * POST /api/bookings/manual — 현장결제/수동 예약 생성.
 */
export async function handleManualBooking(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: Record<string, any>;
  try { body = await request.json(); } catch { return Response.json({ error: '잘못된 JSON' }, { status: 400 }); }

  const customer_name = String(body.customer_name || '').trim();
  const shoot_date = String(body.shoot_date || '').trim();
  if (!customer_name) return Response.json({ error: 'customer_name 필수' }, { status: 400 });
  if (!shoot_date) return Response.json({ error: 'shoot_date 필수' }, { status: 400 });

  try {

  const now = Date.now();
  const booking_id = `MANUAL_${now}`;
  // body.talk_id가 있으면 실제 톡톡 ID 사용, 없으면 임시 ID 생성
  const talk_id = body.talk_id ? String(body.talk_id).trim() : `MANUAL_${now}_${customer_name}`;
  const phone = body.phone ? String(body.phone).trim() : null;
  const consultation_channel = body.consultation_channel ? String(body.consultation_channel).trim() : null;
  const payment_method = body.payment_method ? String(body.payment_method).trim() : null;
  const payment_amount = body.payment_amount ? Number(body.payment_amount) : null;
  const payment_deposit = body.payment_deposit ? Number(body.payment_deposit) : null;
  // products 배열: [{product_id?, product_name}] 형식
  const products: Array<{product_id?: string; product_name: string}> =
    Array.isArray(body.products) && body.products.length > 0
      ? body.products
      : body.product_name ? [{ product_id: body.product_id, product_name: body.product_name }] : [];
  const firstProduct = products[0];
  // original_memo: 캘린더 고객 메모 섹션용 (선입금 정보 미포함)
  const original_memo = body.request_note ? String(body.request_note).trim() : null;
  // request_note (DB 저장용): 선입금/잔액 정보 포함
  let request_note = original_memo;
  if (payment_deposit) {
    const balance = (payment_amount ?? 0) - payment_deposit;
    const depositNote = `선입금: ${payment_deposit.toLocaleString()}원 / 잔액: ${balance.toLocaleString()}원`;
    request_note = request_note ? `${request_note}\n${depositNote}` : depositNote;
  }

  // 1. customers INSERT OR IGNORE (bookings FK 참조 전 먼저 생성)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customers (talk_id, customer_name, phone, consultation_channel, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))`,
  ).bind(talk_id, customer_name, phone, consultation_channel).run();

  // 2. bookings INSERT
  await env.DB.prepare(
    `INSERT INTO bookings
       (booking_id, talk_id, customer_name, product_id, product_name, payment_amount,
        shoot_date, request_note, reservation_date, current_stage, cancelled, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, date('now', '+9 hours'), 'S1', 0, datetime('now'), datetime('now'))`,
  ).bind(booking_id, talk_id, customer_name,
    firstProduct?.product_id || null, firstProduct?.product_name || null,
    payment_amount, shoot_date, request_note).run();

  // 3. booking_details INSERT (상품별)
  for (const p of products) {
    const pid = p.product_id ? String(p.product_id).trim() : null;
    const pname = String(p.product_name || '').trim();
    if (!pname) continue;
    await env.DB.prepare(
      `INSERT INTO booking_details (booking_id, product_id, raw_text, match_status, created_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
    ).bind(booking_id, pid, pname, pid ? 'matched' : 'unmatched').run();
  }

  // 4. Google Calendar 이벤트 생성 (수동 예약은 메일 없으므로 직접 빌드)
  let calendarWarning: string | null = null;
  try {
    const calEnv = env as any;
    const startISO = shoot_date.replace(' ', 'T');
    // 1시간 종료
    const endMs = new Date(startISO + 'Z').getTime() + 3600000;
    const endD = new Date(endMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const endISO = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth()+1)}-${pad(endD.getUTCDate())}T${pad(endD.getUTCHours())}:${pad(endD.getUTCMinutes())}:00`;
    const startHour = Number(shoot_date.match(/\s(\d{1,2}):/)?.[1] ?? 0);
    const endHour = (startHour + 1) % 24;
    const labelName = firstProduct?.product_name || '수동예약';
    const summary = `${startHour}~${endHour}/${customer_name}(${labelName})`;
    // 설명 빌드 (기존 buildDescription 패턴 준수)
    const descLines: string[] = [];
    // 잔액 최상단
    if (payment_deposit && payment_amount) {
      const balance = payment_amount - payment_deposit;
      descLines.push(`★잔액 ${balance.toLocaleString('ko-KR')}원★`);
      descLines.push('');
    }
    // 고객 메모 섹션 (기존 buildDescription과 동일한 위치)
    descLines.push('📌 고객 메모');
    descLines.push('');
    if (original_memo) descLines.push(`📌 요청사항: ${original_memo}`);
    descLines.push(`👤 ${customer_name}`);
    if (labelName) descLines.push(`🎫 ${labelName}`);
    descLines.push(`🔖 예약번호: ${booking_id}`);
    if (payment_amount) descLines.push(`💰 결제: ${payment_amount.toLocaleString('ko-KR')}원`);
    if (payment_method) descLines.push(`💳 결제방식: ${payment_method}`);
    const eventResource = {
      summary,
      description: descLines.join('\n'),
      start: { dateTime: startISO, timeZone: calEnv.TIMEZONE || 'Asia/Seoul' },
      end:   { dateTime: endISO,   timeZone: calEnv.TIMEZONE || 'Asia/Seoul' },
      extendedProperties: { private: { bookingId: booking_id } },
    };
    const created = await createEvent(calEnv, eventResource);
    await env.DB.prepare(
      `UPDATE bookings SET calendar_event_id = ?1, updated_at = datetime('now') WHERE booking_id = ?2`,
    ).bind(created.id, booking_id).run();
    console.log(`[manual-booking] calendar created eventId=${created.id}`);
  } catch (e: any) {
    calendarWarning = e?.message || String(e);
    console.warn(`[manual-booking] calendar 생성 실패 (계속 진행): ${calendarWarning}`);
  }

  // 5. 확정문자 생성
  const detailRows = await env.DB.prepare(
    `SELECT bd.match_status, bd.raw_text, bd.product_id,
            p.product_name, p.match_keyword,
            COALESCE(p.retouch_count, 0) AS retouch_count,
            p.retouch_breakdown,
            COALESCE(p.frame_count, 0) AS frame_count,
            p.frame_size, p.extra_note
     FROM booking_details bd
     LEFT JOIN products p ON bd.product_id = p.product_id
     WHERE bd.booking_id = ?1
     ORDER BY bd.id`,
  ).bind(booking_id).all<BookingDetailWithProduct>();
  const details = detailRows.results || [];
  const confirmMessage = buildConfirmMessage(customer_name, booking_id, shoot_date, details);

  // 6. ai_chat_messages system 메시지 INSERT
  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  ).bind(
    confirmMessage,
    JSON.stringify({ type: 'confirm_message', booking_id, source: 'manual', payment_method }),
  ).run();

  return Response.json({
    success: true,
    booking_id,
    confirm_message: confirmMessage,
    ...(calendarWarning ? { calendar_warning: calendarWarning } : {}),
  });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[manual-booking] 오류:', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/proxy-links — 프록시 링크 목록 (만료일 + 고객 정보 포함).
 */
export async function handleGetProxyLinks(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'all'; // all | active | expired

  let whereClause = '';
  if (filter === 'active') whereClause = "WHERE pt.expires_at > datetime('now')";
  else if (filter === 'expired') whereClause = "WHERE pt.expires_at <= datetime('now')";

  const rows = await env.DB.prepare(
    `SELECT
       pt.id,
       pt.token,
       pt.original_url,
       pt.booking_id,
       pt.link_type,
       pt.expires_at,
       pt.created_at,
       pt.access_count,
       pt.last_accessed_at,
       b.customer_name,
       b.shoot_date,
       b.current_stage
     FROM file_proxy_tokens pt
     LEFT JOIN bookings b ON pt.booking_id = b.booking_id
     ${whereClause}
     ORDER BY pt.created_at DESC
     LIMIT 200`,
  ).all<{
    id: number;
    token: string;
    original_url: string;
    booking_id: string | null;
    link_type: string | null;
    expires_at: string;
    created_at: string;
    access_count: number;
    last_accessed_at: string | null;
    customer_name: string | null;
    shoot_date: string | null;
    current_stage: string | null;
  }>();

  return Response.json({ links: rows.results || [] });
}

/**
 * DELETE /api/proxy-links/:token — 프록시 링크 즉시 만료.
 */
export async function handleDeleteProxyLink(request: Request, env: Env, token: string): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const result = await env.DB.prepare(
    `UPDATE file_proxy_tokens SET expires_at = datetime('now', '-1 second') WHERE token = ?1`,
  ).bind(token).run();

  if ((result.meta?.changes ?? 0) === 0) {
    return Response.json({ error: '링크를 찾을 수 없습니다.' }, { status: 404 });
  }
  return Response.json({ success: true });
}

/**
 * GET /api/settings?keys=key1,key2 — 앱 설정 조회.
 */
export async function handleGetSettings(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const keys = new URL(request.url).searchParams.get('keys')?.split(',').filter(Boolean) ?? [];
  if (keys.length === 0) {
    const rows = await env.DB.prepare(`SELECT key, value FROM app_settings`).all<{ key: string; value: string }>();
    const settings: Record<string, string> = {};
    for (const r of rows.results ?? []) settings[r.key] = r.value;
    return Response.json({ settings });
  }

  const placeholders = keys.map((_, i) => `?${i + 1}`).join(',');
  const rows = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`,
  ).bind(...keys).all<{ key: string; value: string }>();

  const settings: Record<string, string> = {};
  for (const r of rows.results ?? []) settings[r.key] = r.value;
  return Response.json({ settings });
}

/**
 * PATCH /api/settings — 앱 설정 저장. body: { key, value }
 */
export async function handlePatchSetting(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const { key, value } = await request.json<{ key: string; value: string }>();
  if (!key || value === undefined) return Response.json({ error: 'key, value 필수' }, { status: 400 });

  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, String(value)).run();

  return Response.json({ success: true });
}

/**
 * GET /api/products/search?q= — 상품명 자동완성.
 */
export async function handleProductSearch(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (!q) return Response.json({ products: [] });

  const rows = await env.DB.prepare(
    `SELECT product_id, product_name, price FROM products
     WHERE product_name LIKE ?1
     LIMIT 10`,
  ).bind(`%${q}%`).all<{ product_id: string; product_name: string; price: number | null }>();

  return Response.json({ products: rows.results || [] });
}
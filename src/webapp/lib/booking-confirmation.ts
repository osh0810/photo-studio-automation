import { buildConfirmMessage, buildAdditionalQuestionMessageFromProducts, type BookingDetailWithProduct } from './confirm-message-builder';
import { sendNaverTalkMessage } from '../../services/talk';

interface Env { DB: D1Database; NAVER_TALK_TOKEN: string; }
interface Booking {
  booking_id: string; customer_name: string; talk_id: string | null;
  shoot_date: string | null; current_stage: string; cancelled: number | null;
}
export class ConfirmationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function validateBookingId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) {
    throw new ConfirmationError('네이버 예약번호 10자리가 필요합니다.');
  }
  return value;
}
export function validateFullName(value: unknown): string {
  if (typeof value !== 'string') throw new ConfirmationError('예약자 전체 이름이 필요합니다.');
  const name = value.trim();
  if (!/^[가-힣A-Za-z][가-힣A-Za-z ]{1,15}$/.test(name)) {
    throw new ConfirmationError('마스킹되지 않은 예약자 전체 이름을 확인해주세요.');
  }
  return name;
}

export async function prepareConfirmation(env: Env, bookingId: string, fullName?: unknown) {
  validateBookingId(bookingId);
  const booking = await env.DB.prepare(
    'SELECT booking_id, customer_name, talk_id, shoot_date, current_stage, cancelled FROM bookings WHERE booking_id = ?1',
  ).bind(bookingId).first<Booking>();
  if (!booking) throw new ConfirmationError('예약번호를 찾을 수 없습니다.', 404);
  if (booking.cancelled) {
    throw new ConfirmationError('취소된 예약입니다.', 409);
  }
  if (!booking.shoot_date) throw new ConfirmationError('촬영일시가 없습니다.', 409);
  const talkId = booking.talk_id && !booking.talk_id.startsWith('MANUAL_') ? booking.talk_id : null;
  // Never infer a talkId from a name (masked names and namesakes are ambiguous).
  let name = fullName === undefined ? booking.customer_name : validateFullName(fullName);
  if (talkId && fullName === undefined) {
    const customer = await env.DB.prepare('SELECT customer_name FROM customers WHERE talk_id = ?1')
      .bind(talkId).first<{ customer_name: string }>();
    if (customer && !customer.customer_name.includes('*')) name = customer.customer_name;
  }
  const route = talkId ? 'api' : 'browser';
  const needsFullName = name.includes('*');
  const details = await env.DB.prepare(`SELECT bd.match_status, bd.raw_text, bd.product_id,
    p.product_name, p.match_keyword, p.retouch_count, p.retouch_breakdown,
    p.frame_count, p.frame_size, p.extra_note, p.additional_question_text FROM booking_details bd
    LEFT JOIN products p ON bd.product_id = p.product_id WHERE bd.booking_id = ?1 ORDER BY bd.id`)
    .bind(bookingId).all<BookingDetailWithProduct>();
  const attempt = await env.DB.prepare('SELECT status FROM booking_confirmation_sends WHERE booking_id = ?1')
    .bind(bookingId).first<{ status: string }>();
  const echoes = await env.DB.prepare(`SELECT message_content FROM talk_messages
    WHERE event_type = 'echo' AND sender_type = 'studio' AND message_content LIKE ?1`)
    .bind(`%${bookingId}%`).all<{ message_content: string }>();
  const alreadySent = echoes.results.some(row => /님\s+아래\s+내용으로\s+예약\s+완료되셨습니다/.test(row.message_content)
    && new RegExp(`예약번호\\s*[:：]\\s*${bookingId}(?!\\d)`).test(row.message_content));
  return { booking_id: bookingId, customer_name: name, route, talk_id: talkId,
    needs_full_name: needsFullName, status: attempt?.status ?? (alreadySent ? 'already_sent' : 'ready'),
    has_unmatched_products: details.results.some(d => d.match_status === 'unmatched' || !d.product_id || !d.product_name) || details.results.length === 0,
    preview_message: buildConfirmMessage(name, bookingId, booking.shoot_date, details.results),
    additional_message: buildAdditionalQuestionMessageFromProducts(details.results),
    message: needsFullName ? null : buildConfirmMessage(validateFullName(name), bookingId, booking.shoot_date, details.results) };
}

/** Claim before any external send. No automatic retries after an ambiguous result. */
export async function startConfirmation(env: Env, bookingId: string, fullName?: unknown) {
  const plan = await prepareConfirmation(env, bookingId, fullName);
  if (plan.status !== 'ready') throw new ConfirmationError('이미 발송했거나 발송 결과 확인이 필요한 예약입니다.', 409);
  if (plan.has_unmatched_products) throw new ConfirmationError('예약 상품 매칭을 먼저 완료해주세요.', 409);
  if (plan.route === 'browser' && fullName === undefined) {
    throw new ConfirmationError('네이버 예약 화면에서 읽은 전체 이름이 필요합니다.', 409);
  }
  if (!plan.message) throw new ConfirmationError('네이버 예약 화면에서 전체 이름을 먼저 읽어주세요.', 409);
  const attemptId = crypto.randomUUID();
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO booking_confirmation_sends
    (booking_id, attempt_id, route, status, message) VALUES (?1, ?2, ?3, 'sending', ?4)`)
    .bind(bookingId, attemptId, plan.route, plan.message).run();
  if (!claim.meta.changes) throw new ConfirmationError('이미 발송했거나 발송 결과 확인이 필요한 예약입니다.', 409);
  if (plan.route === 'browser') return { ...plan, attempt_id: attemptId, status: 'sending' };
  try {
    // Shared send-talk transport. Retries can duplicate a confirmation after a timeout.
    const result = await sendNaverTalkMessage(env as any, plan.talk_id!, plan.message);
    if (!result.success) throw new Error('네이버 톡톡 API가 발송을 거절했습니다.');
    if (plan.additional_message) {
      const second = await sendNaverTalkMessage(env as any, plan.talk_id!, plan.additional_message);
      if (!second.success) throw new Error('예약확정은 발송했지만 추가 질문 발송 결과 확인이 필요합니다.');
    }
    await finishConfirmation(env, bookingId, attemptId, 'sent');
    return { ...plan, attempt_id: attemptId, status: 'sent' };
  } catch (error) {
    await finishConfirmation(env, bookingId, attemptId, 'uncertain').catch(() => {});
    throw new ConfirmationError(`발송 결과 확인 필요: ${error instanceof Error ? error.message : String(error)}`, 502);
  }
}

export async function finishConfirmation(env: Env, bookingId: string, attemptId: string, status: 'sent' | 'uncertain') {
  const result = await env.DB.prepare(`UPDATE booking_confirmation_sends SET status = ?1,
    updated_at = datetime('now') WHERE booking_id = ?2 AND attempt_id = ?3 AND status = 'sending'`)
    .bind(status, bookingId, attemptId).run();
  if (!result.meta.changes) throw new ConfirmationError('유효한 진행 중 발송이 없습니다.', 409);
}

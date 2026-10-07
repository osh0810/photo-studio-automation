import { createEvent, getEvent } from './calendar-client';
import { buildConfirmMessage, buildAdditionalQuestionMessageFromProducts, type BookingDetailWithProduct } from './confirm-message-builder';

interface Env { DB: D1Database; [key: string]: unknown }
interface Product extends BookingDetailWithProduct {
  product_id: number;
  product_code: string;
  calendar_abbr: string | null;
}

const normalize = (value: string) => value.replace(/\([^)]*\)/g, '').replace(/사진/g, '').replace(/\s/g, '').toLowerCase();

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(value)) return false;
  const date = new Date(value.replace(' ', 'T') + 'Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 19).replace('T', ' ') === value;
}

/** Shared by the dashboard and AI. Generates drafts; never sends customer messages. */
export async function createManualBooking(env: Env, input: Record<string, any>): Promise<Record<string, any>> {
  const name = String(input.customer_name || '').trim().replace(/님$/, '').trim();
  let date = String(input.shoot_date || '').trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)) date += ':00';
  if (!name) return { error: '고객 이름을 알려주세요.' };
  if (!validDateTime(date)) return { error: '촬영 날짜와 시간을 알려주세요. 시간은 임의로 정하지 않습니다. 예: 2026-11-24 11:00' };
  const requested: Array<any> = Array.isArray(input.products) ? input.products : input.product_name ? [{ product_id: input.product_id, product_name: input.product_name }] : [];
  if (!requested.length) return { error: '예약 상품을 알려주세요.' };
  const active = (await env.DB.prepare('SELECT * FROM products WHERE is_active = 1').all<Product>()).results;
  const products: Product[] = [];
  for (const item of requested) {
    const identifier = String(typeof item === 'string' ? item : item.product_name || item.product_code || '').trim();
    const id = typeof item === 'object' && item !== null ? item.product_id : undefined;
    let matches = id != null && String(id) !== '' ? active.filter(p => p.product_id === Number(id)) : active.filter(p =>
      p.product_code === identifier || p.product_name === identifier || p.match_keyword === identifier);
    if (!matches.length && id == null && identifier) {
      const keyword = normalize(identifier);
      matches = active.filter(p => normalize(p.product_name || '') === keyword || normalize(p.match_keyword || '') === keyword);
    }
    if (matches.length !== 1) return {
      error: `상품을 정확히 선택해 주세요: ${identifier || id}`,
      candidates: matches.map(p => ({ product_id: p.product_id, product_name: p.product_name, product_code: p.product_code })),
      hint: 'list_products로 실제 상품을 확인하세요. 패키지와 개별 상품을 임의로 바꾸지 마세요.',
    };
    if (products.some(p => p.product_id === matches[0].product_id)) return { error: '같은 상품이 두 번 입력되었습니다. 상품 구성을 확인해 주세요.' };
    products.push(matches[0]);
  }

  const payment = input.payment_amount == null || input.payment_amount === '' ? null : Number(input.payment_amount);
  const deposit = input.payment_deposit == null || input.payment_deposit === '' ? null : Number(input.payment_deposit);
  if ([payment, deposit].some(v => v != null && (!Number.isFinite(v) || v < 0))) return { error: '결제금액과 선입금은 0 이상의 숫자여야 합니다.' };
  if (deposit != null && payment != null && deposit > payment) return { error: '선입금이 결제금액보다 큽니다.' };
  const originalMemo = String(input.request_note || '').trim();
  const note = [originalMemo, deposit != null ? `선입금: ${deposit.toLocaleString('ko-KR')}원${payment != null ? ` / 잔액: ${(payment-deposit).toLocaleString('ko-KR')}원` : ''}` : ''].filter(Boolean).join('\n') || null;
  const phone = String(input.phone || '').trim() || null;
  const channel = String(input.consultation_channel || 'manual').trim();
  const identity = await hash(JSON.stringify([name, date]));
  const existing = await env.DB.prepare('SELECT booking_id, calendar_event_id FROM bookings WHERE customer_name = ?1 AND shoot_date = ?2 AND cancelled = 0 LIMIT 1')
    .bind(name, date).first<{ booking_id: string; calendar_event_id: string | null }>();
  if (existing && !existing.booking_id.startsWith('MANUAL_')) return { error: '같은 고객과 촬영시간의 기존 예약이 있습니다. 새 예약 대신 기존 예약을 확인해 주세요.', booking_id: existing.booking_id };
  const bookingId = existing?.booking_id || `MANUAL_${identity.slice(0, 24)}`;
  if (!existing && await env.DB.prepare('SELECT booking_id FROM bookings WHERE booking_id = ?1').bind(bookingId).first()) {
    return { error: '같은 이름·시간의 취소된 수동 예약이 있습니다. 기존 예약의 재예약 여부를 확인해 주세요.', booking_id: bookingId };
  }
  if (existing) {
    const ids = (await env.DB.prepare('SELECT product_id FROM booking_details WHERE booking_id = ?1 ORDER BY product_id').bind(bookingId).all<{ product_id: number }>()).results.map(p => p.product_id);
    if (JSON.stringify(ids) !== JSON.stringify(products.map(p => p.product_id).sort((a,b) => a-b))) return { error: '같은 고객·시간의 예약에 다른 상품 구성이 등록되어 있습니다. 기존 예약을 확인해 주세요.', booking_id: bookingId };
  }
  const talkId = String(input.talk_id || '').trim() || `MANUAL_${identity.slice(0, 24)}`;
  const details = products.map(p => ({ ...p, raw_text: p.product_name || '', match_status: 'matched' as const }));
  const confirmMessage = buildConfirmMessage(name, bookingId, date, details);
  const questionMessage = buildAdditionalQuestionMessageFromProducts(details);
  const allNames = products.map(p => p.product_name).join(' + ');
  if (!existing) {
    const queries = [
      env.DB.prepare(`INSERT OR IGNORE INTO customers (talk_id, customer_name, phone, consultation_channel, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))`).bind(talkId, name, phone, channel),
      env.DB.prepare(`INSERT OR IGNORE INTO bookings (booking_id, talk_id, customer_name, product_id, product_name, payment_amount, shoot_date, request_note, reservation_date, current_stage, cancelled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, date('now', '+9 hours'), 'S0', 0, datetime('now'), datetime('now'))`).bind(bookingId, talkId, name, String(products[0].product_id), allNames, payment, date, note),
      ...products.map(p => env.DB.prepare(`INSERT INTO booking_details (booking_id, product_id, raw_text, match_status) SELECT ?1, ?2, ?3, 'matched' WHERE NOT EXISTS (SELECT 1 FROM booking_details WHERE booking_id = ?1 AND product_id = ?2)`).bind(bookingId, p.product_id, p.product_name)),
    ];
    for (const [type, message] of [['confirm_message', confirmMessage], ['additional_questions', questionMessage]]) {
      if (!message) continue;
      queries.push(env.DB.prepare(`INSERT INTO ai_chat_messages (sender, message, metadata, created_at) SELECT 'system', ?1, ?2, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM ai_chat_messages WHERE json_extract(metadata, '$.booking_id') = ?3 AND json_extract(metadata, '$.type') = ?4)`)
        .bind(message, JSON.stringify({ type, booking_id: bookingId, source: 'manual', consultation_channel: channel, payment_method: input.payment_method || null }), bookingId, type));
    }
    await env.DB.batch(queries);
  }

  let calendarWarning: string | null = null;
  let calendarEventId = existing?.calendar_event_id || null;
  if (!calendarEventId) {
    const eventId = `manual${await hash(bookingId)}`;
    const startISO = date.replace(' ', 'T');
    const endISO = new Date(new Date(startISO + 'Z').getTime() + 3600000).toISOString().slice(0, 19);
    const labels = products.map(p => p.calendar_abbr || p.product_name).join(',');
    const description = [
      '📌 고객 메모', originalMemo ? `📌 요청사항: ${originalMemo}` : '', `👤 ${name}`, phone ? `☎ ${phone}` : '',
      `🎫 ${allNames}`, `🔖 예약번호: ${bookingId}`, `📞 예약경로: ${channel}`,
      payment != null ? `💰 결제: ${payment.toLocaleString('ko-KR')}원` : '',
      input.payment_method ? `💳 결제방식: ${input.payment_method}` : '',
      deposit != null ? `선입금: ${deposit.toLocaleString('ko-KR')}원${payment != null ? ` / 잔액: ${(payment-deposit).toLocaleString('ko-KR')}원` : ''}` : '',
    ].filter(Boolean).join('\n');
    try {
      let event;
      try {
        event = await createEvent(env as any, {
          id: eventId, summary: `${date.slice(11,16)}~${endISO.slice(11,16)}/${name}(${labels})`, description,
          start: { dateTime: startISO, timeZone: env.TIMEZONE || 'Asia/Seoul' },
          end: { dateTime: endISO, timeZone: env.TIMEZONE || 'Asia/Seoul' },
          extendedProperties: { private: { bookingId } },
        });
      } catch (error) {
        if (!String(error).includes('409')) throw error;
        event = await getEvent(env as any, eventId);
      }
      calendarEventId = event.id;
      await env.DB.prepare("UPDATE bookings SET calendar_event_id = ?1, updated_at = datetime('now') WHERE booking_id = ?2").bind(calendarEventId, bookingId).run();
    } catch (error) {
      calendarWarning = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(`INSERT INTO ai_chat_messages (sender, message, metadata, created_at) VALUES ('system', ?1, ?2, datetime('now'))`)
        .bind(`⚠️ ${name}님 예약은 저장했지만 Google 캘린더 등록에 실패했습니다. 같은 이름·날짜·상품으로 다시 요청하면 중복 예약 없이 재시도합니다.`, JSON.stringify({ type: 'calendar_error', booking_id: bookingId, source: 'manual' })).run();
    }
  }
  return {
    success: true, booking_id: bookingId, customer_name: name, shoot_date: date,
    duplicate: !!existing, calendar_registered: !!calendarEventId, calendar_event_id: calendarEventId,
    confirm_message: confirmMessage, additional_questions: questionMessage,
    ...(calendarWarning ? { calendar_warning: calendarWarning } : {}),
    message: calendarWarning ? '예약과 안내문은 저장됐지만 캘린더 등록은 실패했습니다. 실패 사실을 안내하세요.' : '예약 저장과 캘린더 등록 완료. 고객에게 복사해 보낼 안내문을 채팅에 표시했습니다.',
  };
}

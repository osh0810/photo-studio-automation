import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManualBooking } from '../src/webapp/lib/manual-booking';
import { createEvent, getEvent } from '../src/webapp/lib/calendar-client';
import { handleToolUse, TOOLS } from '../src/webapp/lib/ai-tools';

vi.mock('../src/webapp/lib/calendar-client', () => ({
  createEvent: vi.fn(), getEvent: vi.fn(), patchEvent: vi.fn(), listEventsByBookingId: vi.fn(),
}));

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.prepare(`INSERT INTO products (product_code, product_name, match_keyword, price, retouch_count, retouch_breakdown, frame_count, frame_size, calendar_abbr, additional_question_text)
    VALUES ('BABY_CLASSIC', '클래식 아기사진(아기독사진)', '클래식아기사진', 100000, 2, '아기2장', 1, '8×10', '클아', '아이 이름과 촬영일 기준 개월수를 알려주세요.')`).run();
  await env.DB.prepare(`INSERT INTO products (product_code, product_name, match_keyword, price, retouch_count, frame_count, frame_size, calendar_abbr)
    VALUES ('FAM_CLASSIC', '클래식 가족사진(3인기준)', '클래식 가족사진', 150000, 1, 1, '8×10', '클가')`).run();
});

beforeEach(async () => {
  // Explicit cleanup also supports the Windows non-isolated D1 test runtime.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM booking_details'),
    env.DB.prepare('DELETE FROM bookings'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM ai_chat_messages'),
  ]);
  vi.mocked(createEvent).mockReset();
  vi.mocked(getEvent).mockReset();
  vi.mocked(createEvent).mockImplementation(async (_env, resource) => ({ id: String(resource.id) }));
});

const request = () => ({
  customer_name: '테스트예약님', shoot_date: '2026-11-24 11:30',
  products: ['클래식아기', '클래식가족'], consultation_channel: 'phone',
});

describe('Phone and SMS bookings', () => {
  it('is available to the AI as a booking tool', () => {
    expect(TOOLS.some(tool => tool.name === 'create_manual_booking')).toBe(true);
  });

  it('saves multiple products, creates the calendar event and matching draft cards', async () => {
    const result = await handleToolUse(env as any, 'create_manual_booking', request()) as Record<string, any>;
    expect(result.success).toBe(true);
    expect(result.calendar_registered).toBe(true);
    const booking = await env.DB.prepare('SELECT current_stage, talk_id FROM bookings WHERE booking_id = ?1').bind(result.booking_id).first<{ current_stage: string; talk_id: string }>();
    expect(booking?.current_stage).toBe('S0');
    expect(booking?.talk_id).toMatch(/^MANUAL_/);
    const details = await env.DB.prepare('SELECT product_id FROM booking_details WHERE booking_id = ?1').bind(result.booking_id).all();
    expect(details.results).toHaveLength(2);
    expect(result.confirm_message).toContain('오전 11시 30분');
    expect(result.confirm_message).toContain('보정파일 총 3장');
    expect(result.confirm_message).toContain('8×10 2개');
    expect(result.additional_questions).toContain('개월수');
    const cards = await env.DB.prepare("SELECT json_extract(metadata, '$.type') AS type FROM ai_chat_messages WHERE json_extract(metadata, '$.booking_id') = ?1").bind(result.booking_id).all<{ type: string }>();
    expect(cards.results.map(row => row.type)).toEqual(['confirm_message', 'additional_questions']);
    const resource = vi.mocked(createEvent).mock.calls[0][1] as any;
    expect(resource.start).toEqual({ dateTime: '2026-11-24T11:30:00', timeZone: 'Asia/Seoul' });
    expect(resource.end.dateTime).toBe('2026-11-24T12:30:00');
    expect(resource.summary).toContain('클아,클가');
    expect(resource.description).toContain('예약경로: phone');
    expect(resource.description).not.toContain('partner.booking.naver.com');
  });

  it('asks for missing or impossible times before writing anything', async () => {
    for (const date of ['2026-11-24', '2026-02-30 11:00', '2026-11-24 25:00']) {
      expect((await createManualBooking(env as any, { ...request(), shoot_date: date })).error).toContain('날짜와 시간');
    }
    expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM bookings').first('count')).toBe(0);
  });

  it('rejects ambiguous or nonexistent products before creating a booking', async () => {
    const result = await createManualBooking(env as any, { ...request(), products: ['클래식가족패키지'] });
    expect(result.error).toContain('상품');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM bookings').first('count')).toBe(0);
    expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
  });

  it('does not duplicate a booking, customer, calendar event or draft on a repeat request', async () => {
    const first = await createManualBooking(env as any, request());
    const second = await createManualBooking(env as any, request());
    expect(second.booking_id).toBe(first.booking_id);
    expect(second.duplicate).toBe(true);
    expect(vi.mocked(createEvent)).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM bookings').first('count')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM customers').first('count')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM ai_chat_messages').first('count')).toBe(2);
  });

  it('shows calendar failure honestly and retries without duplicating the saved booking', async () => {
    vi.mocked(createEvent).mockRejectedValueOnce(new Error('Google permission denied'));
    const first = await createManualBooking(env as any, request());
    expect(first.success).toBe(true);
    expect(first.calendar_registered).toBe(false);
    expect(first.calendar_warning).toContain('permission denied');
    const second = await createManualBooking(env as any, request());
    expect(second.booking_id).toBe(first.booking_id);
    expect(second.calendar_registered).toBe(true);
    expect(vi.mocked(createEvent).mock.calls[0][1].id).toBe(vi.mocked(createEvent).mock.calls[1][1].id);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM bookings').first('count')).toBe(1);
  });

  it('recovers an already-created calendar event after a partial failure', async () => {
    vi.mocked(createEvent).mockRejectedValueOnce(new Error('Calendar API createEvent failed: 409 Conflict'));
    vi.mocked(getEvent).mockResolvedValueOnce({ id: 'existing-calendar-event' });
    const result = await createManualBooking(env as any, request());
    expect(result.calendar_registered).toBe(true);
    expect(result.calendar_event_id).toBe('existing-calendar-event');
  });

  it('keeps the correct date when a one-hour booking crosses midnight', async () => {
    await createManualBooking(env as any, { ...request(), shoot_date: '2026-11-24 23:30', consultation_channel: 'sms' });
    const resource = vi.mocked(createEvent).mock.calls[0][1] as any;
    expect(resource.end.dateTime).toBe('2026-11-25T00:30:00');
  });
});

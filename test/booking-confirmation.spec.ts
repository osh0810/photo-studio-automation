import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBookingConfirmation } from '../src/handlers/booking-confirmation';
import { prepareConfirmation, startConfirmation } from '../src/webapp/lib/booking-confirmation';
import { matchEchoToBooking } from '../src/webapp/lib/echo-matcher';
import { sendNaverTalkMessage } from '../src/services/talk';
import { approveConfirmation, claimConfirmationJob, completeConfirmationJob, confirmationState, deferConfirmationForLogin } from '../src/webapp/lib/booking-confirmation-jobs';
import { reportRunnerStatus } from '../src/webapp/lib/booking-runner-status';
import { handleAssistantConfirmation } from '../src/webapp/handlers/booking-confirmation-api';
import { createSession } from '../src/webapp/lib/session';

vi.mock('../src/services/talk', () => ({ sendNaverTalkMessage: vi.fn() }));
vi.mock('../src/webapp/lib/calendar-event-builder', () => ({ renameCustomerInCalendarEvent: vi.fn(async () => undefined) }));
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  vi.mocked(sendNaverTalkMessage).mockReset();
  await env.DB.prepare("UPDATE booking_runner_status SET status = 'unknown' WHERE id = 1").run();
  await env.DB.prepare('DELETE FROM booking_confirmation_jobs').run();
  await env.DB.prepare('DELETE FROM talk_messages').run();
  await env.DB.prepare('DELETE FROM booking_details').run();
  await env.DB.prepare('DELETE FROM booking_confirmation_sends').run();
  await env.DB.prepare('DELETE FROM bookings').run();
  await env.DB.prepare('DELETE FROM customers').run();
  await env.DB.prepare('DELETE FROM products').run();
});
async function booking(id = '1234567890', talkId: string | null = null, cancelled = 0) {
  if (talkId) await env.DB.prepare(`INSERT INTO customers (talk_id, customer_name, created_at, updated_at)
    VALUES (?1, '홍길동', datetime('now'), datetime('now'))`).bind(talkId).run();
  await env.DB.prepare(`INSERT INTO bookings (booking_id, customer_name, talk_id, reservation_date,
    shoot_date, created_at, updated_at, cancelled) VALUES (?1, '홍*동', ?2, '2026-10-05',
    '2026-11-01 10:00:00', datetime('now'), datetime('now'), ?3)`).bind(id, talkId, cancelled).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO products (product_code, product_name, match_keyword, price, additional_question_text)
    VALUES ('BABY_TEST', '클래식 아기사진', '클래식아기사진', 120000, '아이 이름/성별/촬영일 기준 개월수를 알려주세요.')`).run();
  await env.DB.prepare(`INSERT INTO booking_details (booking_id, product_id, quantity, match_status, raw_text)
    SELECT ?1, product_id, 1, 'matched', '클래식아기사진' FROM products WHERE product_code = 'BABY_TEST'`).bind(id).run();
}
const runtime = () => ({ ...env, ADMIN_TOKEN: 'test-admin', NAVER_TALK_TOKEN: 'test-talk' });
describe('Reservation confirmation', () => {
  it('uses reservation number and requires a browser full name for first contact', async () => {
    await booking();
    const plan = await prepareConfirmation(runtime(), '1234567890');
    expect(plan.route).toBe('browser');
    expect(plan.message).toBeNull();
    await expect(startConfirmation(runtime(), '1234567890')).rejects.toThrow('전체 이름');
    await expect(startConfirmation(runtime(), '1234567890', '홍*동')).rejects.toThrow('전체 이름');
    const attempt = await startConfirmation(runtime(), '1234567890', '홍길동');
    expect(attempt.message).toContain('홍길동님 아래 내용으로 예약 완료되셨습니다');
    expect(attempt.message).toContain('예약번호 : 1234567890');
    expect(vi.mocked(sendNaverTalkMessage)).not.toHaveBeenCalled();
    const match = await matchEchoToBooking(runtime(), 'real-talk-id', attempt.message!);
    expect(match.status).toBe('matched_new');
    const saved = await prepareConfirmation(runtime(), '1234567890');
    expect(saved.route).toBe('api');
    expect(saved.customer_name).toBe('홍길동');
  });
  it('sends saved talkId through the existing API transport once', async () => {
    vi.mocked(sendNaverTalkMessage).mockReset();
    vi.mocked(sendNaverTalkMessage).mockResolvedValue({ success: true, raw: { resultCode: '00' }, durationMs: 1 });
    await booking('1234567891', 'saved-id');
    const result = await startConfirmation(runtime(), '1234567891');
    expect(result.status).toBe('sent');
    expect(vi.mocked(sendNaverTalkMessage).mock.calls[0][1]).toBe('saved-id');
    expect(vi.mocked(sendNaverTalkMessage).mock.calls[0][2]).toContain('홍길동님');
    await expect(startConfirmation(runtime(), '1234567891')).rejects.toThrow('이미 발송');
    expect(vi.mocked(sendNaverTalkMessage)).toHaveBeenCalledTimes(2);
  });
  it('locks uncertain API failures and does not retry automatically', async () => {
    vi.mocked(sendNaverTalkMessage).mockReset();
    vi.mocked(sendNaverTalkMessage).mockRejectedValue(new Error('timeout'));
    await booking('1234567892', 'saved-id');
    await expect(startConfirmation(runtime(), '1234567892')).rejects.toThrow('결과 확인');
    expect((await prepareConfirmation(runtime(), '1234567892')).status).toBe('uncertain');
    await expect(startConfirmation(runtime(), '1234567892')).rejects.toThrow('이미 발송');
    expect(vi.mocked(sendNaverTalkMessage)).toHaveBeenCalledTimes(1);
  });
  it('prevents simultaneous claims', async () => {
    await booking();
    const results = await Promise.allSettled([
      startConfirmation(runtime(), '1234567890', '홍길동'), startConfirmation(runtime(), '1234567890', '홍길동'),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects cancelled and missing reservations', async () => {
    await booking('1234567893', null, 1);
    await expect(startConfirmation(runtime(), '1234567893', '홍길동')).rejects.toThrow('취소');
    await expect(prepareConfirmation(runtime(), '1234567894')).rejects.toThrow('찾을 수');
  });
  it('preserves existing talkId on conflicting echoes', async () => {
    await booking('1234567895', 'existing-id');
    const plan = await prepareConfirmation(runtime(), '1234567895');
    expect((await matchEchoToBooking(runtime(), 'other-id', plan.message!)).status).toBe('conflict');
    expect((await prepareConfirmation(runtime(), '1234567895')).talk_id).toBe('existing-id');
  });
  it('authenticates and validates the endpoint before any send', async () => {
    expect((await handleBookingConfirmation(new Request('https://studio.test/admin/booking-confirmation'), runtime())).status).toBe(401);
    const malformed = new Request('https://studio.test/admin/booking-confirmation', {
      method: 'POST', headers: { authorization: 'test-admin' }, body: '{',
    });
    expect((await handleBookingConfirmation(malformed, runtime())).status).toBe(400);
  });
  it('queues first contact only after approval and atomically claims it once', async () => {
    await booking();
    expect(await claimConfirmationJob(runtime())).toBeNull();
    expect((await approveConfirmation(runtime(), '1234567890', 'owner@test')).status).toBe('queued');
    await expect(approveConfirmation(runtime(), '1234567890', 'owner@test')).rejects.toThrow('이미');
    const claims = await Promise.all([claimConfirmationJob(runtime()), claimConfirmationJob(runtime())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(Boolean)!;
    await expect(completeConfirmationJob(runtime(), claim.booking_id, 'wrong', 'sent')).rejects.toThrow('유효');
    await completeConfirmationJob(runtime(), claim.booking_id, claim.claim_id, 'uncertain', '중단');
    expect((await confirmationState(runtime(), claim.booking_id)).status).toBe('uncertain');
    expect(await claimConfirmationJob(runtime())).toBeNull();
    expect(sendNaverTalkMessage).not.toHaveBeenCalled();
  });
  it('approval sends both messages with saved talkId and blocks a second approval', async () => {
    await booking('1234567891', 'saved-id');
    vi.mocked(sendNaverTalkMessage).mockResolvedValue({ success: true, raw: {}, durationMs: 1 });
    expect((await approveConfirmation(runtime(), '1234567891', 'owner@test')).status).toBe('sent');
    expect(vi.mocked(sendNaverTalkMessage).mock.calls.map(call => call[2])).toEqual([
      expect.stringContaining('예약번호 : 1234567891'), '아이 이름/성별/촬영일 기준 개월수를 알려주세요.',
    ]);
    await expect(approveConfirmation(runtime(), '1234567891', 'owner@test')).rejects.toThrow('이미');
    expect(sendNaverTalkMessage).toHaveBeenCalledTimes(2);
  });
  it('does not resend confirmation after the additional question fails', async () => {
    await booking('1234567891', 'saved-id');
    vi.mocked(sendNaverTalkMessage).mockResolvedValueOnce({ success: true, raw: {}, durationMs: 1 })
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(approveConfirmation(runtime(), '1234567891', 'owner@test')).rejects.toThrow('확인');
    expect((await confirmationState(runtime(), '1234567891')).status).toBe('uncertain');
    await expect(approveConfirmation(runtime(), '1234567891', 'owner@test')).rejects.toThrow('이미');
    expect(sendNaverTalkMessage).toHaveBeenCalledTimes(2);
  });
  it('detects earlier manual confirmations from actual echo history', async () => {
    await booking('1234567891', 'saved-id');
    const plan = await prepareConfirmation(runtime(), '1234567891');
    await env.DB.prepare(`INSERT INTO talk_messages (talk_id, sender_type, message_content, message_at, event_type, raw_payload)
      VALUES ('saved-id', 'studio', ?1, datetime('now'), 'echo', '{}')`).bind(plan.message).run();
    expect((await confirmationState(runtime(), '1234567891')).status).toBe('already_sent');
    await expect(approveConfirmation(runtime(), '1234567891', 'owner@test')).rejects.toThrow('이미');
    expect(sendNaverTalkMessage).not.toHaveBeenCalled();
  });
  it('rejects unverified product matches and cancelled approvals', async () => {
    await booking();
    await env.DB.prepare("UPDATE booking_details SET match_status = 'unmatched' WHERE booking_id = '1234567890'").run();
    await expect(approveConfirmation(runtime(), '1234567890', 'owner@test')).rejects.toThrow('매칭');
    await env.DB.prepare("UPDATE bookings SET cancelled = 1 WHERE booking_id = '1234567890'").run();
    await expect(approveConfirmation(runtime(), '1234567890', 'owner@test')).rejects.toThrow('취소');
  });
  it('requires a session and same-origin POST for assistant approval', async () => {
    await booking();
    const url = 'https://studio.test/api/bookings/1234567890/confirmation';
    expect((await handleAssistantConfirmation(new Request(url), runtime(), '1234567890')).status).toBe(401);
    const session = await createSession(env.DB, 'owner@test');
    const headers = { cookie: `session_id=${session.sessionId}` };
    expect((await handleAssistantConfirmation(new Request(url, { method: 'POST', headers }), runtime(), '1234567890')).status).toBe(403);
    const response = await handleAssistantConfirmation(new Request(url, { method: 'POST', headers: { ...headers, origin: 'https://studio.test' } }), runtime(), '1234567890');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'queued' });
  });
  it('notifies login expiration once and emits a recovery notice after login', async () => {
    const first = await reportRunnerStatus(runtime(), 'login_required');
    expect(first.notified).toBe(true);
    expect(first.login_url).toBe('http://127.0.0.1:18766/');
    expect((await reportRunnerStatus(runtime(), 'login_required')).notified).toBe(false);
    const notice = await env.DB.prepare("SELECT message, metadata FROM ai_chat_messages WHERE json_extract(metadata, '$.type') = 'runner_login_required' ORDER BY id DESC LIMIT 1")
      .first<{ message: string; metadata: string }>();
    expect(notice?.message).toContain('전용 Edge');
    expect(JSON.parse(notice!.metadata).login_url).toBe(first.login_url);
    expect((await reportRunnerStatus(runtime(), 'ready')).notified).toBe(true);
    expect((await reportRunnerStatus(runtime(), 'ready')).notified).toBe(false);
    await expect(reportRunnerStatus(runtime(), 'invalid')).rejects.toThrow('상태');
  });
  it('requeues a proven login failure before any send but never requeues a claimed send', async () => {
    await booking();
    await approveConfirmation(runtime(), '1234567890', 'owner@test');
    const first = (await claimConfirmationJob(runtime()))!;
    await deferConfirmationForLogin(runtime(), first.booking_id, first.claim_id);
    expect((await confirmationState(runtime(), first.booking_id)).status).toBe('queued');
    const second = (await claimConfirmationJob(runtime()))!;
    await startConfirmation(runtime(), second.booking_id, '홍길동');
    await expect(deferConfirmationForLogin(runtime(), second.booking_id, second.claim_id)).rejects.toThrow('재발송');
    expect((await confirmationState(runtime(), second.booking_id)).status).toBe('sending');
  });
});

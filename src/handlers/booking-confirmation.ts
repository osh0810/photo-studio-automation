import type { Env } from '../types';
import { claimConfirmationJob, completeConfirmationJob, deferConfirmationForLogin } from '../webapp/lib/booking-confirmation-jobs';
import { reportRunnerStatus } from '../webapp/lib/booking-runner-status';
import { ConfirmationError, validateBookingId, prepareConfirmation, startConfirmation, finishConfirmation } from '../webapp/lib/booking-confirmation';

export async function handleBookingConfirmation(request: Request, env: Env): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  if (!env.ADMIN_TOKEN || request.headers.get('authorization') !== env.ADMIN_TOKEN) return json({ error: '인증 실패' }, 401);
  try {
    if (request.method === 'GET') {
      return json(await prepareConfirmation(env, validateBookingId(new URL(request.url).searchParams.get('booking_id'))));
    }
    if (request.method !== 'POST') return json({ error: 'GET 또는 POST만 허용됩니다.' }, 405);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { throw new ConfirmationError('올바른 JSON이 필요합니다.'); }
    if (!body || typeof body !== 'object') throw new ConfirmationError('JSON 객체가 필요합니다.');
    if (body.action === 'runner_status') return json(await reportRunnerStatus(env, body.status));
    if (body.action === 'claim_job') return json({ job: await claimConfirmationJob(env) });
    const bookingId = validateBookingId(body.booking_id);
    if (body.action === 'defer_login') {
      if (typeof body.claim_id !== 'string') throw new ConfirmationError('claim_id가 필요합니다.');
      await deferConfirmationForLogin(env, bookingId, body.claim_id);
      return json({ success: true, status: 'queued' });
    }
    if (body.action === 'complete_job') {
      if (typeof body.claim_id !== 'string') throw new ConfirmationError('claim_id가 필요합니다.');
      await completeConfirmationJob(env, bookingId, body.claim_id, String(body.status), typeof body.error === 'string' ? body.error : undefined);
      return json({ success: true });
    }
    if (body.action === 'complete') {
      if (typeof body.attempt_id !== 'string' || !['sent', 'uncertain'].includes(String(body.status))) {
        throw new ConfirmationError('attempt_id와 sent/uncertain 상태가 필요합니다.');
      }
      await finishConfirmation(env, bookingId, body.attempt_id, body.status as 'sent' | 'uncertain');
      return json({ success: true, status: body.status });
    }
    if (body.action !== 'start') throw new ConfirmationError('action은 start 또는 complete여야 합니다.');
    return json(await startConfirmation(env, bookingId, body.full_name));
  } catch (error) {
    if (error instanceof ConfirmationError) return json({ error: error.message }, error.status);
    console.error('[booking-confirmation]', error);
    return json({ error: '예약확정 처리 실패' }, 500);
  }
}

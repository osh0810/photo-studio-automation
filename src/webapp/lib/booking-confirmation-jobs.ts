import { ConfirmationError, prepareConfirmation, startConfirmation } from './booking-confirmation';

interface Env { DB: D1Database; NAVER_TALK_TOKEN: string; }
export async function confirmationState(env: Env, bookingId: string) {
  const plan = await prepareConfirmation(env, bookingId);
  const job = await env.DB.prepare('SELECT status, error, updated_at FROM booking_confirmation_jobs WHERE booking_id = ?1')
    .bind(bookingId).first<{ status: string; error: string | null; updated_at: string }>();
  const runner = await env.DB.prepare('SELECT status FROM booking_runner_status WHERE id = 1').first<{ status: string }>();
  return { ...plan, job, runner_login_required: runner?.status === 'login_required', status: plan.status !== 'ready' ? plan.status : job?.status ?? 'ready' };
}

export async function approveConfirmation(env: Env, bookingId: string, userEmail: string) {
  const plan = await confirmationState(env, bookingId);
  if (plan.status !== 'ready') throw new ConfirmationError('이미 승인했거나 발송한 예약입니다. 상태를 확인해주세요.', 409);
  if (plan.has_unmatched_products) throw new ConfirmationError('예약 상품 매칭을 먼저 완료해주세요.', 409);
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO booking_confirmation_jobs
    (booking_id, approved_by, status) VALUES (?1, ?2, ?3)`)
    .bind(bookingId, userEmail, plan.route === 'api' ? 'running' : 'queued').run();
  if (!inserted.meta.changes) throw new ConfirmationError('이미 승인한 예약입니다.', 409);
  if (plan.route === 'browser') return { status: 'queued', route: 'browser' };
  try {
    const result = await startConfirmation(env, bookingId);
    await env.DB.prepare("UPDATE booking_confirmation_jobs SET status = 'sent', updated_at = datetime('now') WHERE booking_id = ?1")
      .bind(bookingId).run();
    return result;
  } catch (error) {
    await env.DB.prepare("UPDATE booking_confirmation_jobs SET status = 'uncertain', error = ?2, updated_at = datetime('now') WHERE booking_id = ?1")
      .bind(bookingId, error instanceof Error ? error.message : '발송 결과 확인 필요').run();
    throw error;
  }
}

export async function claimConfirmationJob(env: Env) {
  // Atomic UPDATE RETURNING prevents two PC runners taking the same approval.
  return env.DB.prepare(`UPDATE booking_confirmation_jobs SET status = 'running', claim_id = ?1,
    updated_at = datetime('now') WHERE booking_id = (
      SELECT booking_id FROM booking_confirmation_jobs WHERE status = 'queued' ORDER BY created_at, booking_id LIMIT 1
    ) AND status = 'queued' RETURNING booking_id, claim_id`)
    .bind(crypto.randomUUID()).first<{ booking_id: string; claim_id: string }>();
}

export async function completeConfirmationJob(env: Env, bookingId: string, claimId: string, status: string, error?: string) {
  if (!['sent', 'already_sent', 'uncertain'].includes(status)) throw new ConfirmationError('완료 상태가 올바르지 않습니다.');
  const result = await env.DB.prepare(`UPDATE booking_confirmation_jobs SET status = ?3,
    error = ?4, updated_at = datetime('now') WHERE booking_id = ?1 AND claim_id = ?2 AND status = 'running'`)
    .bind(bookingId, claimId, status, error?.slice(0, 300) ?? null).run();
  if (!result.meta.changes) throw new ConfirmationError('유효한 실행 중 예약이 없습니다.', 409);
}

/** Only a proven login failure BEFORE a send claim may return to the approval queue. */
export async function deferConfirmationForLogin(env: Env, bookingId: string, claimId: string) {
  const result = await env.DB.prepare(`UPDATE booking_confirmation_jobs SET status = 'queued', claim_id = NULL,
    error = '네이버 재로그인 대기', updated_at = datetime('now') WHERE booking_id = ?1 AND claim_id = ?2
    AND status = 'running' AND NOT EXISTS (SELECT 1 FROM booking_confirmation_sends WHERE booking_id = ?1)`)
    .bind(bookingId, claimId).run();
  if (!result.meta.changes) throw new ConfirmationError('발송 시도가 있거나 유효한 로그인 대기 건이 아닙니다. 재발송하지 않습니다.', 409);
}

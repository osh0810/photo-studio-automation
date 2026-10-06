import { ConfirmationError } from './booking-confirmation';
import { sendPushNotification } from './push-sender';
export const RUNNER_LOGIN_URL = 'http://127.0.0.1:18766/';
interface Env { DB: D1Database; ALLOWED_EMAIL?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; }
export async function reportRunnerStatus(env: Env, status: unknown) {
  if (status !== 'ready' && status !== 'login_required') throw new ConfirmationError('실행기 로그인 상태가 올바르지 않습니다.');
  const required = status === 'login_required';
  const metadata = JSON.stringify({ type: required ? 'runner_login_required' : 'runner_login_restored', source: 'booking_runner', login_url: RUNNER_LOGIN_URL });
  const message = required
    ? '🔑 네이버 로그인 또는 보안 확인이 필요합니다. 최초 고객의 발송은 대기 중입니다.\n예약 실행기가 설치된 PC에서 아래 실행기 연결 버튼을 눌러 안내를 확인해주세요. 일반 Edge 확장을 사용 중이면 평소 사용하는 Edge에서 로그인 후 확장의 자동 처리를 다시 켜주세요. 휴대폰이나 다른 PC에서는 실행기를 연결할 수 없습니다.'
    : '✅ 예약 실행기의 네이버 로그인 연결이 복구되었습니다. 승인된 대기 예약을 이어서 처리합니다.';
  // One atomic transaction: repeated reports cannot generate repeated alerts.
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO ai_chat_messages(sender, message, metadata, created_at)
      SELECT 'system', ?1, ?2, datetime('now') FROM booking_runner_status
      WHERE id = 1 AND ${required ? "status != 'login_required'" : "status = 'login_required'"}`)
      .bind(message, metadata),
    env.DB.prepare("UPDATE booking_runner_status SET status = ?1, updated_at = datetime('now') WHERE id = 1").bind(status),
  ]);
  const notified = !!results[0].meta.changes;
  if (required && notified && env.ALLOWED_EMAIL) {
    await sendPushNotification({ ...env }, env.ALLOWED_EMAIL, {
      title: '네이버 재로그인 필요', body: '예약 실행기 PC에서 비서를 열고 네이버 로그인 버튼을 눌러주세요.',
      tag: 'booking-runner-login', data: { url: '/chat', type: 'runner_login_required' },
    }).catch(() => {});
  }
  return { success: true, status, notified, login_url: RUNNER_LOGIN_URL };
}

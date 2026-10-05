import { requireAuth } from './auth';
import { ConfirmationError, validateBookingId } from '../lib/booking-confirmation';
import { approveConfirmation, confirmationState } from '../lib/booking-confirmation-jobs';

interface Env { DB: D1Database; NAVER_TALK_TOKEN: string; [key: string]: unknown; }
export async function handleAssistantConfirmation(request: Request, env: Env, id: string) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return json({ error: '로그인이 필요합니다.' }, 401);
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin)
    return json({ error: '올바른 비서 화면에서 확인해주세요.' }, 403);
  try {
    const bookingId = validateBookingId(id);
    if (request.method === 'GET') return json(await confirmationState(env, bookingId));
    if (request.method === 'POST') return json(await approveConfirmation(env, bookingId, auth.userEmail));
    return json({ error: 'GET 또는 POST만 허용됩니다.' }, 405);
  } catch (error) {
    if (error instanceof ConfirmationError) return json({ error: error.message }, error.status);
    console.error('[assistant-confirmation]', error);
    return json({ error: '예약 발송 상태를 확인하지 못했습니다.' }, 500);
  }
}

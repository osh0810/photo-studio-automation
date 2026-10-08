import {ConfirmationError} from './booking-confirmation';
interface Env {DB:D1Database}
export async function retrySlotClosure(env:Env,bookingId:string) {
 const saved=await env.DB.prepare(`UPDATE booking_slot_closures SET status='queued',attempts=0,claim_id=NULL,error=NULL,updated_at=datetime('now')
 WHERE booking_id=?1 AND status IN ('failed','login_required') AND EXISTS (SELECT 1 FROM bookings b WHERE b.booking_id=?1 AND b.cancelled=0 AND b.shoot_date=booking_slot_closures.shoot_date AND julianday(b.shoot_date)>julianday('now','+9 hours'))`).bind(bookingId).run();
 if(!saved.meta.changes)throw new ConfirmationError('마감을 재시도할 예약이 없습니다.',409);
 return {status:'queued'};
}
export function slotClosureInsert(env:Env, bookingId:string) {
 return env.DB.prepare(`INSERT OR IGNORE INTO booking_slot_closures (booking_id,shoot_date)
 SELECT booking_id,shoot_date FROM bookings WHERE booking_id=?1 AND cancelled=0 AND shoot_date IS NOT NULL`).bind(bookingId);
}
export async function claimSlotClosure(env:Env) {
 await env.DB.prepare(`UPDATE booking_slot_closures SET status='failed',attempts=3,error='취소·시간 변경 또는 지난 예약의 마감 요청입니다.',updated_at=datetime('now')
 WHERE status='queued' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.booking_id=booking_slot_closures.booking_id AND b.cancelled=0 AND b.shoot_date=booking_slot_closures.shoot_date AND julianday(b.shoot_date)>julianday('now','+9 hours'))`).run();
 // Closing is idempotent: interrupted jobs can be checked again, without sending messages.
 return env.DB.prepare(`UPDATE booking_slot_closures SET status='running',claim_id=?1,attempts=attempts+1,updated_at=datetime('now')
 WHERE booking_id=(SELECT s.booking_id FROM booking_slot_closures s JOIN bookings b ON b.booking_id=s.booking_id
 WHERE b.cancelled=0 AND b.shoot_date=s.shoot_date AND julianday(s.shoot_date)>julianday('now','+9 hours')
 AND (s.status='queued' OR (s.status IN ('failed','login_required') AND s.attempts<3 AND s.updated_at<datetime('now','-1 minute')) OR (s.status='running' AND s.updated_at<datetime('now','-10 minutes')))
 ORDER BY s.updated_at LIMIT 1) RETURNING booking_id,shoot_date,claim_id`).bind(crypto.randomUUID()).first<{booking_id:string;shoot_date:string;claim_id:string}>();
}
export async function finishSlotClosure(env:Env, bookingId:string,claimId:string,status:unknown,result:unknown) {
 if(!['closed','failed','login_required'].includes(String(status)))throw new ConfirmationError('예약 마감 상태가 올바르지 않습니다.');
 const summary=status==='closed' && result && typeof result==='object' ? result as Record<string,unknown> : null;
 if(status==='closed' && (!summary || summary.verified!==true || !Number.isInteger(summary.total) || Number(summary.total)<1))throw new ConfirmationError('마감 검증 결과가 필요합니다.');
 const saved=await env.DB.prepare(`UPDATE booking_slot_closures SET status=?3,result=?4,error=?5,updated_at=datetime('now') WHERE booking_id=?1 AND claim_id=?2 AND status='running'`)
 .bind(bookingId,claimId,String(status),summary?JSON.stringify({verified:true,total:summary.total}):null,status==='closed'?null:status==='login_required'?'네이버 재로그인 대기':'네이버 예약 마감 확인 필요').run();
 if(!saved.meta.changes)throw new ConfirmationError('유효한 마감 작업이 없습니다.',409);
}

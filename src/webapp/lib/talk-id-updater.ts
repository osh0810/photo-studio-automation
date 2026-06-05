/**
 * booking 1건의 talk_id를 안전하게 교체.
 *
 * FK 순서 불변식 (echo-matcher Case A와 동일):
 *   1) INSERT OR IGNORE customers(newTalkId)  — FK 참조 대상 먼저 확보
 *   2) UPDATE bookings.talk_id               — FK 만족 상태에서 변경
 *   3) DELETE customers(oldTalkId) MANUAL_ 만 — 실제 talk_id 행은 건드리지 않음
 * D1 batch로 묶어 부분 실패 시 자동 롤백.
 */

interface Env {
	DB: D1Database;
}

export interface UpdateTalkIdResult {
	status: 'ok' | 'no_booking' | 'no_change';
	bookingId: string;
	oldTalkId: string | null;
	newTalkId: string;
	dryRun: boolean;
}

function nowSqlite(): string {
	return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

export async function updateBookingTalkId(
	env: Env,
	bookingId: string,
	newTalkId: string,
	options: { dryRun?: boolean } = {},
): Promise<UpdateTalkIdResult> {
	const dryRun = options.dryRun === true;

	const booking = await env.DB.prepare(
		'SELECT booking_id, talk_id, customer_name FROM bookings WHERE booking_id = ?1',
	)
		.bind(bookingId)
		.first<{ booking_id: string; talk_id: string | null; customer_name: string }>();

	if (!booking) {
		return { status: 'no_booking', bookingId, oldTalkId: null, newTalkId, dryRun };
	}

	const oldTalkId = booking.talk_id;

	if (oldTalkId === newTalkId) {
		return { status: 'no_change', bookingId, oldTalkId, newTalkId, dryRun };
	}

	if (!dryRun) {
		const now = nowSqlite();
		const stmts = [
			// 1) 새 talk_id로 customers 행 확보 (이미 있으면 IGNORE)
			env.DB.prepare(
				`INSERT OR IGNORE INTO customers (talk_id, customer_name, created_at, updated_at)
				 VALUES (?1, ?2, ?3, ?3)`,
			).bind(newTalkId, booking.customer_name, now),
			// 2) bookings.talk_id 교체 — customers 행이 보장된 뒤에 실행
			env.DB.prepare(
				`UPDATE bookings SET talk_id = ?1, updated_at = ?2 WHERE booking_id = ?3`,
			).bind(newTalkId, now, bookingId),
		];

		// 3) 구 talk_id가 MANUAL_ 임시값인 경우에만 삭제
		if (oldTalkId?.startsWith('MANUAL_')) {
			stmts.push(
				env.DB.prepare(`DELETE FROM customers WHERE talk_id = ?1`).bind(oldTalkId),
			);
		}

		await env.DB.batch(stmts);
	}

	return { status: 'ok', bookingId, oldTalkId, newTalkId, dryRun };
}

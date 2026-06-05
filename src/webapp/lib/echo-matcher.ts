/**
 * Phase 4.5 Step 2: 톡톡 echo 확정문자 → bookings/customers 자동 매칭.
 *
 * webhook handleEchoEvent에서 동기 호출.
 * 무한 발송 루프 방지 불변식 준수: classifier 호출 X, Discord PROCESSED X,
 * 톡톡 자동 발신 X, processMessage 진입 X.
 */

import { parseEchoConfirmMessage, type EchoParseResult } from './echo-parser';
import { sendPushNotification } from './push-sender';
import { renameCustomerInCalendarEvent } from './calendar-event-builder';

interface Env {
	DB: D1Database;
	ALLOWED_EMAIL?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	[key: string]: unknown;
}

export type EchoMatchStatus =
	| 'not_confirm'
	| 'no_booking'
	| 'matched_new'
	| 'matched_existing'
	| 'conflict';

export interface EchoMatchResult {
	status: EchoMatchStatus;
	bookingId?: string;
	customerName?: string;
	oldName?: string;
	newName?: string;
	nameUpdated?: boolean;
	calendarPatched?: boolean;
	talkIdUpdated?: boolean;
	conflictingTalkId?: string;
	newTalkId?: string;
	parseResult?: EchoParseResult;
}

function nowSqlite(): string {
	return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

interface BookingRow {
	booking_id: string;
	talk_id: string | null;
	customer_name: string;
}

/**
 * echo 메시지를 booking과 매칭. dryRun=true면 UPDATE 없이 status 판정만.
 */
export async function matchEchoToBooking(
	env: Env,
	talkId: string,
	message: string,
	options: { dryRun?: boolean } = {},
): Promise<EchoMatchResult> {
	const dryRun = options.dryRun === true;
	const parsed = parseEchoConfirmMessage(message);

	if (!parsed.isConfirmEcho || !parsed.bookingId) {
		return { status: 'not_confirm', parseResult: parsed };
	}

	const bookingId = parsed.bookingId;
	const parsedName = parsed.customerName ?? '';
	const isMasked = parsed.isMasked === true;

	const booking = await env.DB.prepare(
		'SELECT booking_id, talk_id, customer_name FROM bookings WHERE booking_id = ?1',
	)
		.bind(bookingId)
		.first<BookingRow>();

	if (!booking) {
		return { status: 'no_booking', bookingId, parseResult: parsed };
	}

	// 이름 처리 분기 (E1): 마스킹이면 안 바꿈, 풀네임이고 값이 다르면 갱신
	const shouldUpdateName =
		!isMasked && parsedName !== '' && booking.customer_name !== parsedName;
	const now = nowSqlite();

	// Case C: 다른 talk_id와 충돌 (MANUAL_ 임시 talk_id는 충돌 아님 — Case A로 처리)
	const isManualTalkId = booking.talk_id?.startsWith('MANUAL_') ?? false;
	if (booking.talk_id && booking.talk_id !== talkId && !isManualTalkId) {
		return {
			status: 'conflict',
			bookingId,
			customerName: booking.customer_name,
			conflictingTalkId: booking.talk_id,
			newTalkId: talkId,
			parseResult: parsed,
		};
	}

	// Case A: talk_id IS NULL 또는 MANUAL_ 임시값 → 실제 talk_id로 자동 보완.
	// FK: bookings.talk_id → customers.talk_id. customers 보장 → bookings UPDATE 순서 필수.
	// 원자성: D1 batch로 묶어 부분 실패 시 자동 롤백.
	if (booking.talk_id === null || isManualTalkId) {
		if (!dryRun) {
			const customerName = shouldUpdateName ? parsedName : booking.customer_name;

			const oldManualTalkId = isManualTalkId ? booking.talk_id : null;
			const stmts = [
				// 1) customers 보장 (이미 있으면 IGNORE)
				env.DB.prepare(
					`INSERT OR IGNORE INTO customers
					   (talk_id, customer_name, created_at, updated_at)
					 VALUES (?1, ?2, ?3, ?3)`,
				).bind(talkId, customerName, now),
				// 2) bookings.talk_id 보완 (+ 풀네임 시 customer_name 동시 갱신)
				shouldUpdateName
					? env.DB.prepare(
							`UPDATE bookings
							 SET talk_id = ?1, customer_name = ?2, updated_at = ?3
							 WHERE booking_id = ?4`,
						).bind(talkId, parsedName, now, bookingId)
					: env.DB.prepare(
							`UPDATE bookings
							 SET talk_id = ?1, updated_at = ?2
							 WHERE booking_id = ?3`,
						).bind(talkId, now, bookingId),
			];
			// 3) MANUAL_ 임시 customer 행 삭제 (실제 talk_id로 교체됐으므로)
			if (oldManualTalkId) {
				stmts.push(
					env.DB.prepare(
						`DELETE FROM customers WHERE talk_id = ?1`,
					).bind(oldManualTalkId),
				);
			}

			// 3) 기존 customers 행이 이미 있던 경우 대비 — 풀네임 보완 시에만 추가
			if (shouldUpdateName) {
				stmts.push(
					env.DB.prepare(
						`UPDATE customers
						 SET customer_name = ?1, updated_at = ?2
						 WHERE talk_id = ?3`,
					).bind(parsedName, now, talkId),
				);
			}

			await env.DB.batch(stmts);

			if (shouldUpdateName) {
				await renameCustomerInCalendarEvent(
					{ env: env as any, db: env.DB },
					bookingId,
					parsedName,
				).catch((err) =>
					console.error('[echo-matcher] 캘린더 이름 갱신 실패 (Case A):', err),
				);
			}
		}

		return {
			status: 'matched_new',
			bookingId,
			customerName: shouldUpdateName ? parsedName : booking.customer_name,
			oldName: shouldUpdateName ? booking.customer_name : undefined,
			newName: shouldUpdateName ? parsedName : undefined,
			talkIdUpdated: true,
			nameUpdated: shouldUpdateName,
			calendarPatched: shouldUpdateName && !dryRun,
			newTalkId: talkId,
			parseResult: parsed,
		};
	}

	// Case B: 같은 talk_id — 이름만 보완
	if (!dryRun && shouldUpdateName) {
		await env.DB.prepare(
			`UPDATE bookings
			 SET customer_name = ?1, updated_at = ?2
			 WHERE booking_id = ?3`,
		)
			.bind(parsedName, now, bookingId)
			.run();
		await env.DB.prepare(
			`UPDATE customers
			 SET customer_name = ?1, updated_at = ?2
			 WHERE talk_id = ?3`,
		)
			.bind(parsedName, now, talkId)
			.run();
		await renameCustomerInCalendarEvent(
			{ env: env as any, db: env.DB },
			bookingId,
			parsedName,
		).catch((err) =>
			console.error('[echo-matcher] 캘린더 이름 갱신 실패 (Case B):', err),
		);
	}

	return {
		status: 'matched_existing',
		bookingId,
		customerName: shouldUpdateName ? parsedName : booking.customer_name,
		oldName: shouldUpdateName ? booking.customer_name : undefined,
		newName: shouldUpdateName ? parsedName : undefined,
		talkIdUpdated: false,
		nameUpdated: shouldUpdateName,
		calendarPatched: shouldUpdateName && !dryRun,
		parseResult: parsed,
	};
}

// ─── 알림 ──────────────────────────────────────────────────────────────

async function insertSystemMessage(
	env: Env,
	body: string,
	metadata: Record<string, unknown>,
): Promise<number | null> {
	const createdAt = nowSqlite();
	const result = await env.DB.prepare(
		`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
		 VALUES ('system', ?1, ?2, ?3)
		 RETURNING id`,
	)
		.bind(body, JSON.stringify(metadata), createdAt)
		.first<{ id: number }>();
	return result?.id ?? null;
}

function maskTalkId(t: string | undefined | null): string {
	if (!t) return '-';
	return t.length <= 8 ? t : `${t.slice(0, 8)}...`;
}

/**
 * 매칭 결과를 ai_chat_messages + 푸시로 알림.
 * - not_confirm / matched_existing(이름 변경 없음): 아무것도 안 함
 * - matched_new / matched_existing(이름 변경 있음): system 메시지만, 푸시 X
 * - no_booking / conflict: system 메시지 + 푸시 1건
 */
export async function notifyEchoMatchResult(
	env: Env,
	result: EchoMatchResult,
): Promise<void> {
	if (result.status === 'not_confirm') return;

	if (result.status === 'matched_new') {
		let body = `✅ Echo 자동 보완: ${result.bookingId} → talk_id 연결 완료`;
		if (result.nameUpdated) {
			body += `\n이름 보완: ${result.oldName} → ${result.newName}`;
			if (result.calendarPatched) body += ' (캘린더 제목 갱신)';
		}
		await insertSystemMessage(env, body, {
			source: 'echo_match',
			type: 'echo_match_new',
			booking_id: result.bookingId,
			talk_id: result.newTalkId,
			name_updated: !!result.nameUpdated,
			calendar_patched: !!result.calendarPatched,
		});
		return;
	}

	if (result.status === 'matched_existing') {
		if (!result.nameUpdated) return;
		let body = `✅ Echo 이름 보완: ${result.bookingId} → ${result.oldName} → ${result.newName}`;
		if (result.calendarPatched) body += ' (캘린더 제목 갱신)';
		await insertSystemMessage(env, body, {
			source: 'echo_match',
			type: 'echo_name_updated',
			booking_id: result.bookingId,
			old_name: result.oldName,
			new_name: result.newName,
			calendar_patched: !!result.calendarPatched,
		});
		return;
	}

	if (result.status === 'no_booking') {
		const body =
			`⚠️ Echo 매칭 실패 — 예약번호 ${result.bookingId} 미발견\n` +
			`파싱은 성공했으나 해당 booking이 DB에 없습니다.`;
		await insertSystemMessage(env, body, {
			source: 'echo_match',
			type: 'echo_no_booking',
			booking_id: result.bookingId,
		});
		if (env.ALLOWED_EMAIL) {
			await sendPushNotification(env, env.ALLOWED_EMAIL, {
				title: '⚠️ Echo 매칭 실패',
				body: `예약번호 ${result.bookingId} 미발견`,
				tag: `echo_no_booking_${result.bookingId}`,
				data: {
					source: 'echo_match',
					type: 'echo_no_booking',
					booking_id: result.bookingId,
				},
			}).catch((err) =>
				console.error('[echo-matcher] no_booking 푸시 실패:', err),
			);
		}
		return;
	}

	if (result.status === 'conflict') {
		const existing = maskTalkId(result.conflictingTalkId);
		const echoTid = maskTalkId(result.newTalkId);
		const body =
			`⚠️ Echo 매칭 충돌 — ${result.customerName ?? '(이름 없음)'} (${result.bookingId})\n` +
			`기존 talk_id: ${existing}\n` +
			`echo talk_id: ${echoTid}\n` +
			`자동 보완 건너뜀. 채팅창에서 수동 확인 필요.`;
		await insertSystemMessage(env, body, {
			source: 'echo_match',
			type: 'echo_conflict',
			booking_id: result.bookingId,
			existing_talk_id: result.conflictingTalkId,
			echo_talk_id: result.newTalkId,
		});
		if (env.ALLOWED_EMAIL) {
			await sendPushNotification(env, env.ALLOWED_EMAIL, {
				title: '⚠️ Echo 매칭 충돌',
				body: `${result.customerName ?? ''} (${result.bookingId}) — 수동 확인 필요`,
				tag: `echo_conflict_${result.bookingId}`,
				data: {
					source: 'echo_match',
					type: 'echo_conflict',
					booking_id: result.bookingId,
				},
			}).catch((err) =>
				console.error('[echo-matcher] conflict 푸시 실패:', err),
			);
		}
		return;
	}
}

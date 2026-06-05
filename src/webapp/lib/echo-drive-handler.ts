/**
 * Phase 6-B Step 5: 톡톡 echo에서 Drive 링크 감지 → milestone 자동 업데이트.
 *
 * 작가님이 톡톡으로 발송한 echo 메시지에 Drive 폴더 링크가 있고
 * "원본사진 링크" 또는 "보정본" 키워드가 포함되면 bookings의
 * original_sent_at / retouched_sent_at / revision_sent_at 컬럼을 자동으로 채움.
 *
 * 호출 위치: webhook.ts handleEchoEvent (확정문자 echo 처리 이후).
 * 호출 조건: 확정문자 echo가 아닌 경우(matchEchoToBooking → not_confirm)에만.
 */

import { sendPushNotification } from './push-sender';

interface Env {
	DB: D1Database;
	ALLOWED_EMAIL?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	[key: string]: unknown;
}

export type EchoDriveStatus =
	| 'skipped_no_drive'
	| 'skipped_no_keyword'
	| 'skipped_no_booking'
	| 'skipped_already_set'
	| 'updated_original'
	| 'updated_retouched'
	| 'updated_revision';

export interface EchoDriveResult {
	status: EchoDriveStatus;
	bookingId?: string;
	customerName?: string;
}

interface BookingRow {
	booking_id: string;
	customer_name: string;
	original_sent_at: string | null;
	retouched_sent_at: string | null;
	revision_sent_at: string | null;
}

async function insertSystemMessage(
	env: Env,
	body: string,
	metadata: Record<string, unknown>,
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
		 VALUES ('system', ?1, ?2, datetime('now'))`,
	)
		.bind(body, JSON.stringify(metadata))
		.run();
}

export async function handleEchoDriveLink(
	env: Env,
	talkId: string,
	message: string,
): Promise<EchoDriveResult> {
	if (!message || !message.includes('drive.google.com')) {
		return { status: 'skipped_no_drive' };
	}

	const isOriginal = message.includes('원본사진 링크');
	const isReupload = message.includes('재업로드');
	const isRetouched = message.includes('보정본');
	if (!isOriginal && !isRetouched && !isReupload) {
		return { status: 'skipped_no_keyword' };
	}

	const booking = await env.DB.prepare(
		`SELECT booking_id, customer_name,
		        original_sent_at, retouched_sent_at, revision_sent_at
		 FROM bookings
		 WHERE talk_id = ?1
		   AND cancelled = 0
		 ORDER BY created_at DESC
		 LIMIT 1`,
	)
		.bind(talkId)
		.first<BookingRow>();

	if (!booking) {
		return { status: 'skipped_no_booking' };
	}

	const now = new Date()
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d{3}Z$/, '');

	try {
		if (isOriginal) {
			if (booking.original_sent_at) {
				return {
					status: 'skipped_already_set',
					bookingId: booking.booking_id,
					customerName: booking.customer_name,
				};
			}
			await env.DB.prepare(
				`UPDATE bookings
				 SET original_sent_at = ?1, updated_at = ?1
				 WHERE booking_id = ?2`,
			)
				.bind(now, booking.booking_id)
				.run();
			await insertSystemMessage(
				env,
				`📤 원본 발송 확인\n${booking.customer_name}님 원본 발송일이 오늘로 기록되었습니다.\n예약번호: ${booking.booking_id}`,
				{
					type: 'drive_original_sent',
					booking_id: booking.booking_id,
					sent_at: now,
				},
			);
			return {
				status: 'updated_original',
				bookingId: booking.booking_id,
				customerName: booking.customer_name,
			};
		}

		// "재업로드" 키워드는 항상 추가보정(revision_sent_at) 업데이트
		if (isReupload) {
			await env.DB.prepare(
				`UPDATE bookings
				 SET revision_sent_at = ?1, updated_at = ?1
				 WHERE booking_id = ?2`,
			)
				.bind(now, booking.booking_id)
				.run();
			await insertSystemMessage(
				env,
				`📤 추가보정 발송 확인\n${booking.customer_name}님 추가보정 발송일이 오늘로 기록되었습니다.\n예약번호: ${booking.booking_id}`,
				{
					type: 'drive_revision_sent',
					booking_id: booking.booking_id,
					sent_at: now,
				},
			);
			return {
				status: 'updated_revision',
				bookingId: booking.booking_id,
				customerName: booking.customer_name,
			};
		}

		// 보정본: retouched_sent_at NULL이면 첫 보정본, 있으면 추가보정(revision_sent_at)
		if (!booking.retouched_sent_at) {
			await env.DB.prepare(
				`UPDATE bookings
				 SET retouched_sent_at = ?1, updated_at = ?1
				 WHERE booking_id = ?2`,
			)
				.bind(now, booking.booking_id)
				.run();
			await insertSystemMessage(
				env,
				`📤 보정본 발송 확인\n${booking.customer_name}님 보정본 발송일이 오늘로 기록되었습니다.\n예약번호: ${booking.booking_id}`,
				{
					type: 'drive_retouched_sent',
					booking_id: booking.booking_id,
					sent_at: now,
				},
			);
			return {
				status: 'updated_retouched',
				bookingId: booking.booking_id,
				customerName: booking.customer_name,
			};
		}

		// 추가보정
		await env.DB.prepare(
			`UPDATE bookings
			 SET revision_sent_at = ?1, updated_at = ?1
			 WHERE booking_id = ?2`,
		)
			.bind(now, booking.booking_id)
			.run();
		await insertSystemMessage(
			env,
			`📤 추가보정 발송 확인\n${booking.customer_name}님 추가보정 발송일이 오늘로 기록되었습니다.\n예약번호: ${booking.booking_id}`,
			{
				type: 'drive_revision_sent',
				booking_id: booking.booking_id,
				sent_at: now,
			},
		);
		return {
			status: 'updated_revision',
			bookingId: booking.booking_id,
			customerName: booking.customer_name,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[echo-drive] milestone 업데이트 실패:', msg);
		if (env.ALLOWED_EMAIL) {
			await sendPushNotification(env, env.ALLOWED_EMAIL, {
				title: '🚨 Drive 발송 milestone 업데이트 실패',
				body: `예약 ${booking.booking_id} (${booking.customer_name}) — ${msg}`,
				tag: `echo_drive_error_${booking.booking_id}`,
				data: {
					source: 'echo_drive_error',
					booking_id: booking.booking_id,
				},
			}).catch((e) => console.error('[echo-drive] push 실패:', e));
		}
		throw err;
	}
}

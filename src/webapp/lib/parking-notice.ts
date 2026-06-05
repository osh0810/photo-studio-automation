/**
 * 촬영일 당일 KST 08:00 (UTC 전날 23:00) 만차안내 자동 발송.
 *
 * - shoot_date는 KST로 저장된 예외 컬럼 → '+9 hours' 없이 date('now', '+9 hours')와 직접 비교
 * - 중복 방지: message_send_history.send_type = 'parking_notice' + 오늘 KST 날짜
 * - talk_id 없는 경우 푸시 + 채팅창 알림으로 fallback
 */

import { sendNaverTalkMessage } from '../../services/talk';
import { sendPushNotification } from './push-sender';

interface Env {
	DB: D1Database;
	NAVER_TALK_TOKEN: string;
	ALLOWED_EMAIL?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	[k: string]: unknown;
}

const PARKING_NOTICE_TEXT =
	'안녕하세요! 마음껏스튜디오 입니다\n' +
	'당일 지하주차장이 혼잡할 수 있으니 10분 일찍 도착하시는걸 추천드립니다\n' +
	'또는 만차시 건너편 이마트 흥덕점 유료주차 가능하시니 참고해주세요\n' +
	'(던킨 커피 1잔 구매시 2시간 무료 or 이마트 구매금액 1만원 당 1시간 무료)\n' +
	'(스튜디오 오시는 길은 이마트 2층 출구가 빠릅니다!)';

interface BookingRow {
	booking_id: string;
	customer_name: string;
	talk_id: string | null;
	shoot_date: string;
}

export interface DryRunResult {
	targets: Array<{
		booking_id: string;
		customer_name: string;
		talk_id: string | null;
		would_send: boolean;
		skip_reason?: string;
	}>;
	message: string;
}

export async function runParkingNotice(env: Env, dryRun = false): Promise<DryRunResult | void> {
	// 1. 오늘 KST 촬영 예약 조회 (shoot_date는 KST 저장 → '+9 hours' 변환 없이 비교)
	const { results: bookings } = await env.DB.prepare(
		`SELECT booking_id, customer_name, talk_id, shoot_date
		 FROM bookings
		 WHERE cancelled = 0
		   AND shoot_date IS NOT NULL
		   AND date(shoot_date) = date('now', '+9 hours')`,
	).all<BookingRow>();

	// dryRun: 실제 발송 없이 대상 목록만 반환
	if (dryRun) {
		const targets: DryRunResult['targets'] = [];
		for (const { booking_id, customer_name, talk_id } of bookings) {
			const already = await env.DB.prepare(
				`SELECT id FROM message_send_history
				 WHERE booking_id = ?1
				   AND send_type = 'parking_notice'
				   AND date(created_at, '+9 hours') = date('now', '+9 hours')
				 LIMIT 1`,
			).bind(booking_id).first<{ id: number }>();

			if (already) {
				targets.push({ booking_id, customer_name, talk_id, would_send: false, skip_reason: '오늘 이미 발송됨' });
			} else if (!talk_id) {
				targets.push({ booking_id, customer_name, talk_id, would_send: false, skip_reason: 'talk_id 없음' });
			} else {
				targets.push({ booking_id, customer_name, talk_id, would_send: true });
			}
		}
		return { targets, message: PARKING_NOTICE_TEXT };
	}

	let sent = 0;
	let skipped = 0;
	let failed = 0;

	for (const booking of bookings) {
		const { booking_id, customer_name, talk_id, shoot_date } = booking;

		// 2. 중복 발송 체크
		const already = await env.DB.prepare(
			`SELECT id FROM message_send_history
			 WHERE booking_id = ?1
			   AND send_type = 'parking_notice'
			   AND date(created_at, '+9 hours') = date('now', '+9 hours')
			 LIMIT 1`,
		).bind(booking_id).first<{ id: number }>();

		if (already) {
			skipped++;
			continue;
		}

		// 3. 발송 처리
		if (!talk_id) {
			// talk_id 없으면 푸시 + 채팅창 알림
			if (env.ALLOWED_EMAIL) {
				await sendPushNotification(env, env.ALLOWED_EMAIL, {
					title: `⚠️ ${customer_name} 만차안내 톡톡 미발송 (talk_id 없음)`,
					body: `예약번호: ${booking_id} / 촬영일: ${shoot_date}`,
					tag: `parking_notice_${booking_id}`,
					data: { source: 'parking_notice', booking_id },
				}).catch((e) => console.error(`[parking-notice] 푸시 실패 ${booking_id}:`, e));
			}

			await env.DB.prepare(
				`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
				 VALUES ('system', ?1, ?2, datetime('now'))`,
			).bind(
				`⚠️ [${customer_name}] talk_id 미연결 — 만차안내 수동 발송 필요\n예약번호: ${booking_id} / 촬영일: ${shoot_date}`,
				JSON.stringify({ type: 'parking_notice_manual', booking_id }),
			).run();

			failed++;
			continue;
		}

		// 4. 톡톡 발송
		try {
			const result = await sendNaverTalkMessage(env as any, talk_id, PARKING_NOTICE_TEXT);

			if (result.success) {
				await env.DB.prepare(
					`INSERT INTO message_send_history
					   (booking_id, talk_id, send_type, message_content, send_method, result, created_at)
					 VALUES (?1, ?2, 'parking_notice', ?3, 'auto', 'success', datetime('now'))`,
				).bind(booking_id, talk_id, PARKING_NOTICE_TEXT).run();
				sent++;
			} else {
				throw new Error(`resultCode=${result.resultCode}`);
			}
		} catch (e: any) {
			const errMsg = e?.message || String(e);
			console.error(`[parking-notice] 톡톡 발송 실패 booking_id=${booking_id}: ${errMsg}`);

			await env.DB.prepare(
				`INSERT INTO message_send_history
				   (booking_id, talk_id, send_type, message_content, send_method, result, error_message, created_at)
				 VALUES (?1, ?2, 'parking_notice', ?3, 'auto', 'failed', ?4, datetime('now'))`,
			).bind(booking_id, talk_id, PARKING_NOTICE_TEXT, errMsg).run();

			// 실패 시 푸시 + 채팅창 fallback
			if (env.ALLOWED_EMAIL) {
				await sendPushNotification(env, env.ALLOWED_EMAIL, {
					title: `⚠️ ${customer_name} 만차안내 발송 실패`,
					body: errMsg.slice(0, 100),
					tag: `parking_notice_fail_${booking_id}`,
					data: { source: 'parking_notice', booking_id },
				}).catch((pe) => console.error(`[parking-notice] 푸시 실패:`, pe));
			}

			await env.DB.prepare(
				`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
				 VALUES ('system', ?1, ?2, datetime('now'))`,
			).bind(
				`⚠️ [${customer_name}] 만차안내 톡톡 발송 실패 — 수동 발송 필요\n오류: ${errMsg}`,
				JSON.stringify({ type: 'parking_notice_failed', booking_id }),
			).run();

			failed++;
		}
	}

	console.log(
		`[parking-notice] 완료 — ${sent}건 발송, ${skipped}건 스킵, ${failed}건 실패`,
	);
}

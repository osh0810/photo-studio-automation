/**
 * Phase 4 Step 5: 5분 주기 메일 폴링 cron.
 *
 * processed_emails.raw_received_at MAX 이후 도착한 네이버 예약 메일을
 * Gmail API로 가져와 processEmail()로 일괄 처리.
 */

import { getValidAccessToken } from './google-tokens';
import { listMessages, getMessage } from './gmail-client';
import { processEmail, retryOrphanCancels } from './email-processor';
import { sendPushNotification } from './push-sender';

interface Env {
	DB: D1Database;
	GOOGLE_OAUTH_CLIENT_ID: string;
	GOOGLE_OAUTH_CLIENT_SECRET: string;
	ALLOWED_EMAIL?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	[key: string]: unknown;
}

export async function handleScheduledEmail(env: Env): Promise<void> {
	console.log('[cron-email] 시작');

	try {
		// 1. 마지막 처리된 메일 수신 시각 조회
		const lastRow = await env.DB.prepare(
			`SELECT MAX(raw_received_at) AS last_received
			 FROM processed_emails
			 WHERE raw_received_at IS NOT NULL`,
		).first<{ last_received: string | null }>();

		let afterTimestamp: number;
		if (lastRow?.last_received) {
			// raw_received_at은 RFC 2822 (Gmail Date 헤더). Date 파서가 RFC 2822 지원.
			const parsed = new Date(lastRow.last_received).getTime();
			if (isNaN(parsed)) {
				console.warn(
					`[cron-email] last_received 파싱 실패: "${lastRow.last_received}" — 24h fallback`,
				);
				afterTimestamp = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
			} else {
				afterTimestamp = Math.floor(parsed / 1000);
			}
		} else {
			// 첫 실행: 24시간 이전부터
			afterTimestamp = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
		}

		console.log(
			`[cron-email] after timestamp: ${afterTimestamp} (${new Date(afterTimestamp * 1000).toISOString()})`,
		);

		// 2. Access token
		const accessToken = await getValidAccessToken(env);
		if (!accessToken) {
			console.error(
				'[cron-email] Access token 없음 — /auth/google?reauth=1 필요',
			);
			return;
		}

		// 3. Gmail 검색
		const query = `from:naverbooking_noreply@navercorp.com after:${afterTimestamp}`;
		const listResult = await listMessages(accessToken, query, 50);

		const messageIds = (listResult.messages || []).map((m) => m.id);
		console.log(`[cron-email] 발견된 메일 수: ${messageIds.length}`);

		if (messageIds.length === 0) {
			console.log('[cron-email] 처리할 새 메일 없음');
			return;
		}

		// 4. 각 메시지 처리
		const results = {
			success: 0,
			duplicate: 0,
			parse_failed: 0,
			orphan_cancel: 0,
			error: 0,
		};
		const orphanCancels: Array<{ messageId: string; bookingId: string }> = [];

		for (const messageId of messageIds) {
			try {
				const message = await getMessage(accessToken, messageId);
				const result = await processEmail(env, message);
				const key = result.result as keyof typeof results;
				if (key in results) {
					results[key]++;
				} else {
					results.error++;
				}
				if (result.result === 'orphan_cancel' && result.booking_id) {
					orphanCancels.push({ messageId, bookingId: result.booking_id });
				}
				console.log(
					`[cron-email] ${messageId}: ${result.result} (${result.booking_id || 'N/A'})`,
				);
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				console.error(`[cron-email] ${messageId} 처리 실패: ${errMsg}`);
				results.error++;
			}
		}

		// orphan_cancel 재시도 — 배치 내 확정 메일이 먼저 도착한 취소 메일을 처리
		if (orphanCancels.length > 0) {
			console.log(`[cron-email] orphan_cancel 재시도: ${orphanCancels.length}건`);
			await retryOrphanCancels(env, orphanCancels);
		}

		console.log(`[cron-email] 완료 — ${JSON.stringify(results)}`);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(`[cron-email] 에러: ${errMsg}`);
	}

	// Phase 6-B Step 6: 1시간 미발송 알림 — 메일 처리와 별도 try/catch
	try {
		await checkUnsentDriveSendMessages(env);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(`[cron-email] 미발송 알림 에러: ${errMsg}`);
	}

	// 원본발송 15일 초과 + 셀렉 미수신 → alert_paused_until 자동 정지
	try {
		await checkAlertAutoPause(env);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(`[cron-email] 알림 자동 정지 체크 에러: ${errMsg}`);
	}

}

interface UnsentRow {
	booking_id: string;
	customer_name: string;
	message_created_at: string;
}

async function checkUnsentDriveSendMessages(env: Env): Promise<void> {
	// 원본 미발송: drive_send_message(original) 생성 후 1~2시간 사이 + original_sent_at NULL + 알림 안 보냄
	// (2시간 윈도우 — 기존 누적분 + 이미 1회 지난 케이스 자동 제외)
	const originalRows = await env.DB.prepare(
		`SELECT b.booking_id, b.customer_name, m.created_at AS message_created_at
		 FROM ai_chat_messages m
		 JOIN bookings b ON json_extract(m.metadata, '$.booking_id') = b.booking_id
		 WHERE json_extract(m.metadata, '$.type') = 'drive_send_message'
		   AND json_extract(m.metadata, '$.send_type') = 'original'
		   AND b.original_sent_at IS NULL
		   AND b.cancelled = 0
		   AND m.created_at <= datetime('now', '-1 hour')
		   AND m.created_at >= datetime('now', '-2 hour')
		   AND NOT EXISTS (
		     SELECT 1 FROM ai_chat_messages m2
		     WHERE json_extract(m2.metadata, '$.type') = 'drive_original_sent_alert_sent'
		       AND json_extract(m2.metadata, '$.booking_id') = b.booking_id
		   )`,
	).all<UnsentRow>();

	for (const r of originalRows.results || []) {
		await sendUnsentAlert(env, 'original', r);
	}

	// 보정본 미발송 — 동일 1~2시간 윈도우
	const retouchedRows = await env.DB.prepare(
		`SELECT b.booking_id, b.customer_name, m.created_at AS message_created_at
		 FROM ai_chat_messages m
		 JOIN bookings b ON json_extract(m.metadata, '$.booking_id') = b.booking_id
		 WHERE json_extract(m.metadata, '$.type') = 'drive_send_message'
		   AND json_extract(m.metadata, '$.send_type') = 'retouched'
		   AND b.retouched_sent_at IS NULL
		   AND b.cancelled = 0
		   AND m.created_at <= datetime('now', '-1 hour')
		   AND m.created_at >= datetime('now', '-2 hour')
		   AND NOT EXISTS (
		     SELECT 1 FROM ai_chat_messages m2
		     WHERE json_extract(m2.metadata, '$.type') = 'drive_retouched_sent_alert_sent'
		       AND json_extract(m2.metadata, '$.booking_id') = b.booking_id
		   )`,
	).all<UnsentRow>();

	for (const r of retouchedRows.results || []) {
		await sendUnsentAlert(env, 'retouched', r);
	}

	if (
		(originalRows.results?.length ?? 0) > 0 ||
		(retouchedRows.results?.length ?? 0) > 0
	) {
		console.log(
			`[cron-email] 미발송 알림 — original=${originalRows.results?.length ?? 0} retouched=${retouchedRows.results?.length ?? 0}`,
		);
	}
}

interface AlertAutoPauseRow {
	booking_id: string;
	customer_name: string;
	original_sent_at: string;
}

async function checkAlertAutoPause(env: Env): Promise<void> {
	const rows = await env.DB.prepare(
		`SELECT booking_id, customer_name, original_sent_at
		 FROM bookings
		 WHERE cancelled = 0
		   AND original_sent_at IS NOT NULL
		   AND selection_received_at IS NULL
		   AND (alert_paused_until IS NULL
		        OR alert_paused_until != '2099-12-31')
		   AND julianday(date('now', '+9 hours'))
		       - julianday(date(original_sent_at)) > 15`,
	).all<AlertAutoPauseRow>();

	const targets = rows.results || [];
	if (targets.length === 0) return;

	console.log(`[cron-email] 알림 자동 정지 대상: ${targets.length}건`);

	for (const r of targets) {
		// 중복 방지: 이미 alert_auto_paused 메시지가 있으면 스킵
		const existing = await env.DB.prepare(
			`SELECT id FROM ai_chat_messages
			 WHERE json_extract(metadata, '$.type') = 'alert_auto_paused'
			   AND json_extract(metadata, '$.booking_id') = ?1`,
		).bind(r.booking_id).first<{ id: number }>();

		if (existing) continue;

		await env.DB.prepare(
			`UPDATE bookings
			 SET alert_paused_until = '2099-12-31', updated_at = datetime('now')
			 WHERE booking_id = ?1`,
		).bind(r.booking_id).run();

		const body =
			`⏸️ 알림 자동 정지: ${r.customer_name}님 원본발송 후 15일 초과\n` +
			`예약번호: ${r.booking_id} / 원본발송일: ${r.original_sent_at}\n` +
			`셀렉 수신 시 자동 해제됩니다.`;

		await env.DB.prepare(
			`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
			 VALUES ('system', ?1, ?2, datetime('now'))`,
		).bind(
			body,
			JSON.stringify({
				type: 'alert_auto_paused',
				booking_id: r.booking_id,
				customer_name: r.customer_name,
				reason: 'original_sent_15days',
			}),
		).run();

		console.log(`[cron-email] 알림 자동 정지: ${r.booking_id} (${r.customer_name})`);
	}
}

async function sendUnsentAlert(
	env: Env,
	sendType: 'original' | 'retouched',
	row: UnsentRow,
): Promise<void> {
	const typeKor = sendType === 'original' ? '원본' : '보정본';
	const alertType =
		sendType === 'original'
			? 'drive_original_sent_alert_sent'
			: 'drive_retouched_sent_alert_sent';

	// 푸시 발송
	if (env.ALLOWED_EMAIL) {
		await sendPushNotification(env, env.ALLOWED_EMAIL, {
			title: `📤 ${typeKor} 미발송 알림`,
			body: `${row.customer_name}님 ${typeKor} 발송 문구 생성 후 1시간이 지났습니다. 톡톡 발송 여부를 확인해주세요.`,
			tag: `${alertType}_${row.booking_id}`,
			data: {
				source: alertType,
				booking_id: row.booking_id,
			},
		}).catch((e) =>
			console.error(`[cron-email] 미발송 푸시 실패 ${row.booking_id}:`, e),
		);
	}

	// 중복 방지용 system 메시지 INSERT — 푸시와 동일 내용
	const body =
		`📤 ${typeKor} 미발송 알림\n` +
		`${row.customer_name}님 ${typeKor} 발송 문구 생성 후 1시간이 지났습니다.\n` +
		`톡톡 발송 여부를 확인해주세요.\n` +
		`예약번호: ${row.booking_id}`;
	await env.DB.prepare(
		`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
		 VALUES ('system', ?1, ?2, datetime('now'))`,
	)
		.bind(
			body,
			JSON.stringify({
				type: alertType,
				booking_id: row.booking_id,
				customer_name: row.customer_name,
			}),
		)
		.run();
}

/**
 * Phase 7 Step 1: 매일 KST 09:00 D1 기반 아침 점검 리포트.
 *
 * 섹션 순서:
 *   1. 📅 오늘 촬영
 *   2. 📦 액자발주대기
 *   3. 🖼️ 보정대기
 *   4. 📋 셀렉대기
 */

import { sendPushNotification } from './push-sender';
import { sendKakaoMessageLong } from './kakao-client';

interface Env {
	DB: D1Database;
	ALLOWED_EMAIL?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	[key: string]: unknown;
}

interface TodayShootRow {
	booking_id: string;
	customer_name: string;
	shoot_date: string;
	product_name: string | null;
}

interface OriginalWaitRow {
	booking_id: string;
	customer_name: string;
	days_since: number;
	urgent_retouch_until: string | null;
}

interface FrameOrderWaitRow {
	booking_id: string;
	customer_name: string;
	frame_address: string | null;
	days_since: number;
	urgent_retouch_until: string | null;
}

interface RetouchWaitRow {
	booking_id: string;
	customer_name: string;
	revision_requested_at: string | null;
	days_since: number;
	color_priority: number;
	urgent_retouch_until: string | null;
}

interface SelectionWaitRow {
	booking_id: string;
	customer_name: string;
	days_since: number;
	urgent_retouch_until: string | null;
}


function fmtHHmm(sqlite: string): string {
	const m = sqlite.match(/\s(\d{2}):(\d{2})/);
	return m ? `${m[1]}:${m[2]}` : sqlite;
}

function buildReportText(args: {
	dateLabel: string;
	todayShoots: TodayShootRow[];
	originalWait: OriginalWaitRow[];
	frameOrderWait: FrameOrderWaitRow[];
	retouchWait: RetouchWaitRow[];
	selectionWait: SelectionWaitRow[];
}): string {
	const lines: string[] = [];
	lines.push('📋 마음껏스튜디오 아침 점검 리포트');
	lines.push(`${args.dateLabel} KST`);
	lines.push('');

	// 1. 오늘 촬영
	lines.push('📅 오늘 촬영');
	if (args.todayShoots.length === 0) {
		lines.push('오늘 촬영 없음');
	} else {
		for (const s of args.todayShoots) {
			lines.push(
				`- ${fmtHHmm(s.shoot_date)} ${s.customer_name}${s.product_name ? ` (${s.product_name})` : ''}`,
			);
		}
	}
	lines.push('');

	// 2. 원본발송대기
	lines.push(`📤 원본발송대기 (${args.originalWait.length}건)`);
	for (const r of args.originalWait) {
		const urgentPrefix = r.urgent_retouch_until ? '🔴 ' : '';
		lines.push(`- ${urgentPrefix}${r.customer_name} (${r.days_since}일)`);
	}
	lines.push('');

	// 3. 액자발주대기
	lines.push(`📦 액자발주대기 (${args.frameOrderWait.length}건)`);
	for (const r of args.frameOrderWait) {
		let urgentPrefix = '';
		let suffix = '';
		if (r.urgent_retouch_until) {
			urgentPrefix = '🔴 ';
			suffix = ' / 긴급';
		} else if (!r.frame_address || r.frame_address === '') {
			suffix = ' / ⚠️ 주소 미수신';
		}
		lines.push(`- ${urgentPrefix}${r.customer_name} (${r.days_since}일)${suffix}`);
	}
	lines.push('');

	// 4. 보정대기
	lines.push(`🖼️ 보정대기 (${args.retouchWait.length}건)`);
	for (const r of args.retouchWait) {
		const emoji = r.color_priority <= 1 ? '🔴' : r.color_priority === 2 ? '🟡' : '⚪';
		const prefix = r.revision_requested_at ? '[추가] ' : '';
		const suffix = r.urgent_retouch_until ? ' / 긴급' : '';
		lines.push(`- ${emoji} ${prefix}${r.customer_name} (${r.days_since}일)${suffix}`);
	}
	lines.push('');

	// 5. 셀렉대기
	lines.push(`📋 셀렉대기 (${args.selectionWait.length}건)`);
	for (const r of args.selectionWait) {
		const urgentPrefix = r.urgent_retouch_until ? '🔴 ' : '';
		lines.push(`- ${urgentPrefix}${r.customer_name} (${r.days_since}일)`);
	}
	lines.push('');

	const allClear =
		args.frameOrderWait.length === 0 &&
		args.retouchWait.length === 0 &&
		args.selectionWait.length === 0;

	if (allClear) {
		lines.push('✅ 오늘은 모든 것이 정상입니다!');
	}

	return lines.join('\n');
}

export async function runMorningReport(env: Env, force = false): Promise<void> {
	// 중복 방지 (force=true 시 스킵)
	const dateRow = await env.DB.prepare(
		`SELECT date('now', '+9 hours') AS today`,
	).first<{ today: string }>();
	const dateLabel = dateRow?.today ?? '';

	if (!force) {
		const dup = await env.DB.prepare(
			`SELECT id FROM ai_chat_messages
			 WHERE json_extract(metadata, '$.type') = 'morning_report'
			   AND json_extract(metadata, '$.date') = ?1
			 LIMIT 1`,
		)
			.bind(dateLabel)
			.first();
		if (dup) {
			console.log(`[morning-report] 이미 발송됨 (date=${dateLabel}) — skip`);
			return;
		}
	}

	// A. 오늘 촬영
	const todayShootsRes = await env.DB.prepare(
		`SELECT booking_id, customer_name, shoot_date, product_name
		 FROM bookings
		 WHERE date(shoot_date) = date('now', '+9 hours')
		   AND cancelled = 0
		 ORDER BY shoot_date ASC`,
	).all<TodayShootRow>();

	// B. 원본발송대기
	const originalWaitRes = await env.DB.prepare(
		`SELECT b.booking_id, b.customer_name, b.urgent_retouch_until,
		        CAST(julianday(date('now', '+9 hours')) - julianday(date(b.shoot_date)) AS INTEGER) AS days_since
		 FROM bookings b
		 WHERE b.cancelled = 0
		   AND b.shoot_date IS NOT NULL
		   AND b.original_sent_at IS NULL
		   AND date(b.shoot_date) <= date('now', '+9 hours')
		 ORDER BY (b.urgent_retouch_until IS NOT NULL) DESC, days_since DESC`,
	).all<OriginalWaitRow>();

	// C. 액자발주대기
	const frameOrderWaitRes = await env.DB.prepare(
		`SELECT b.booking_id, b.customer_name, c.frame_address, b.urgent_retouch_until,
		        CAST(julianday(date('now', '+9 hours'))
		          - julianday(date(
		              COALESCE(b.revision_no_more_at, b.revision_sent_at, b.retouched_sent_at)
		            )) AS INTEGER) AS days_since
		 FROM bookings b
		 LEFT JOIN customers c ON b.talk_id = c.talk_id
		 WHERE b.cancelled = 0
		   AND b.frame_ordered_at IS NULL
		   AND (b.alert_paused_until IS NULL
		        OR date(b.alert_paused_until) < date('now', '+9 hours'))
		   AND NOT (
		     b.revision_requested_at IS NOT NULL
		     AND (b.revision_sent_at IS NULL OR b.revision_requested_at > b.revision_sent_at)
		   )
		   AND (
		     (b.retouched_sent_at IS NOT NULL
		      AND julianday(date('now', '+9 hours')) - julianday(date(b.retouched_sent_at)) >= 1)
		     OR (b.revision_sent_at IS NOT NULL
		      AND julianday(date('now', '+9 hours')) - julianday(date(b.revision_sent_at)) >= 1)
		     OR (b.revision_no_more_at IS NOT NULL
		      AND julianday(date('now', '+9 hours')) - julianday(date(b.revision_no_more_at)) >= 1)
		   )
		 ORDER BY (b.urgent_retouch_until IS NOT NULL) DESC, days_since DESC`,
	).all<FrameOrderWaitRow>();

	// D. 보정대기
	const retouchWaitRes = await env.DB.prepare(
		`SELECT b.booking_id, b.customer_name,
		        b.revision_requested_at, b.urgent_retouch_until,
		        CASE
		          WHEN b.urgent_retouch_until IS NOT NULL THEN 0
		          WHEN b.revision_requested_at IS NOT NULL THEN
		            CASE
		              WHEN CAST(julianday(date('now', '+9 hours'))
		                   - julianday(date(b.revision_requested_at)) AS INTEGER) >= 2 THEN 1
		              WHEN CAST(julianday(date('now', '+9 hours'))
		                   - julianday(date(b.revision_requested_at)) AS INTEGER) >= 1 THEN 2
		              ELSE 3
		            END
		          ELSE
		            CASE
		              WHEN CAST(julianday(date('now', '+9 hours'))
		                   - julianday(date(b.selection_received_at)) AS INTEGER) >= 7 THEN 1
		              WHEN CAST(julianday(date('now', '+9 hours'))
		                   - julianday(date(b.selection_received_at)) AS INTEGER) >= 5 THEN 2
		              ELSE 3
		            END
		        END AS color_priority,
		        CASE
		          WHEN b.revision_requested_at IS NOT NULL THEN
		            CAST(julianday(date('now', '+9 hours'))
		                 - julianday(date(b.revision_requested_at)) AS INTEGER)
		          ELSE
		            CAST(julianday(date('now', '+9 hours'))
		                 - julianday(date(b.selection_received_at)) AS INTEGER)
		        END AS days_since
		 FROM bookings b
		 WHERE b.cancelled = 0
		   AND b.frame_ordered_at IS NULL
		   AND (b.alert_paused_until IS NULL
		        OR date(b.alert_paused_until) < date('now', '+9 hours'))
		   AND (
		     (b.selection_received_at IS NOT NULL AND b.retouched_sent_at IS NULL)
		     OR
		     (b.revision_requested_at IS NOT NULL
		      AND (b.revision_sent_at IS NULL OR b.revision_requested_at > b.revision_sent_at))
		   )
		 ORDER BY color_priority ASC, days_since DESC`,
	).all<RetouchWaitRow>();

	// E. 셀렉대기
	const selectionWaitRes = await env.DB.prepare(
		`SELECT b.booking_id, b.customer_name, b.urgent_retouch_until,
		        CAST(julianday(date('now', '+9 hours'))
		          - julianday(date(b.original_sent_at))
		          AS INTEGER) AS days_since
		 FROM bookings b
		 WHERE b.cancelled = 0
		   AND b.original_sent_at IS NOT NULL
		   AND b.selection_received_at IS NULL
		   AND (b.alert_paused_until IS NULL
		        OR date(b.alert_paused_until) < date('now', '+9 hours'))
		 ORDER BY (b.urgent_retouch_until IS NOT NULL) DESC, days_since DESC`,
	).all<SelectionWaitRow>();

	const todayShoots = todayShootsRes.results || [];
	const originalWait = originalWaitRes.results || [];
	const frameOrderWait = frameOrderWaitRes.results || [];
	const retouchWait = retouchWaitRes.results || [];
	const selectionWait = selectionWaitRes.results || [];

	const reportText = buildReportText({
		dateLabel,
		todayShoots,
		originalWait,
		frameOrderWait,
		retouchWait,
		selectionWait,
	});

	// 🔴 건수: 보정대기 color_priority≤1 + 액자발주/셀렉대기 urgent 설정 항목
	const urgentCount =
		retouchWait.filter((r) => r.color_priority <= 1).length +
		frameOrderWait.filter((r) => r.urgent_retouch_until !== null).length +
		selectionWait.filter((r) => r.urgent_retouch_until !== null).length;

	const bizId = String((env as any).NAVER_BIZ_ID || '745146');
	const bookingBase = 'https://partner.booking.naver.com/bizes/' + bizId + '/booking-list-view/bookings';
	const seenBookingIds = new Set<string>();
	const reportCustomers: Array<{ name: string; url: string; booking_id: string; section: string }> = [];
	const addToReport = (name: string, id: string, section: string) => {
		if (!id || !name || seenBookingIds.has(id)) return;
		seenBookingIds.add(id);
		reportCustomers.push({ name, url: bookingBase + '/' + id, booking_id: id, section });
	};
	todayShoots.forEach(r => addToReport(r.customer_name, r.booking_id, 'today'));
	originalWait.forEach(r => addToReport(r.customer_name, r.booking_id, 'original'));
	frameOrderWait.forEach(r => addToReport(r.customer_name, r.booking_id, 'frame'));
	retouchWait.forEach(r => addToReport(r.customer_name, r.booking_id, 'retouch'));
	selectionWait.forEach(r => addToReport(r.customer_name, r.booking_id, 'selection'));

	await env.DB.prepare(
		`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
		 VALUES ('system', ?1, ?2, datetime('now'))`,
	)
		.bind(
			reportText,
			JSON.stringify({
				type: 'morning_report',
				date: dateLabel,
				urgent_count: urgentCount,
				today_shoot_count: todayShoots.length,
				customers: reportCustomers,
			}),
		)
		.run();

	// 푸시
	if (env.ALLOWED_EMAIL) {
		let title = '✅ 오늘 이상 없음';
		let body = `${dateLabel} 아침 점검`;
		if (urgentCount > 0) {
			title = `🔴 긴급 ${urgentCount}건 + 오늘 촬영 ${todayShoots.length}건`;
			body = `${dateLabel} 아침 점검 — 채팅창에서 확인`;
		} else if (todayShoots.length > 0) {
			title = `📅 오늘 ${todayShoots.length}건 촬영`;
			body = `${dateLabel} 아침 점검`;
		}
		await sendPushNotification(env, env.ALLOWED_EMAIL, {
			title,
			body,
			tag: `morning_report_${dateLabel}`,
			data: { source: 'morning_report', date: dateLabel },
		}).catch((e) => console.error('[morning-report] push 실패:', e));
	}

	// 카카오톡 발송 (아침 자동 실행 시에만 — force=true 수동 조회는 스킵)
	if (!force) {
		try {
			await sendKakaoMessageLong(env as any, reportText);
			console.log('[morning-report] 카카오톡 발송 완료');
		} catch (e) {
			console.error('[morning-report] 카카오톡 발송 실패 (무시):', e);
		}
	}

	console.log(
		`[morning-report] 발송 완료 date=${dateLabel} urgent=${urgentCount} frameOrderWait=${frameOrderWait.length} retouchWait=${retouchWait.length} selectionWait=${selectionWait.length} shoot=${todayShoots.length}`,
	);
}

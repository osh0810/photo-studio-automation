/**
 * 네이버 예약 메일 처리 모듈 (Phase 4 Step 4-A).
 *
 * - 파싱된 메일 데이터를 D1 DB에 반영 (bookings INSERT / UPDATE)
 * - ai_chat_messages에 system 메시지 INSERT
 * - 확정 메일은 푸시 발송, 취소는 채팅창만
 * - 중복은 processed_emails.message_id + bookings.booking_id 둘 다로 방어
 *
 * talk_id=NULL로 INSERT — Phase 4.5에서 echo 매칭으로 자동 보완 예정.
 */

import type { GmailMessage } from './gmail-client';
import { extractPlainBody, getHeader } from './gmail-client';
import {
	detectEmailType,
	parseConfirmEmail,
	parseCancelEmail,
} from './email-parser';
import { sendPushNotification } from './push-sender';
import {
	buildConfirmMessage,
	matchAdditionalQuestions,
	buildAdditionalQuestionMessage,
	type BookingDetailWithProduct,
	type AdditionalQuestion,
} from './confirm-message-builder';
import {
	createCalendarEventForBooking,
	markCalendarEventCancelled,
} from './calendar-event-builder';

interface Env {
	DB: D1Database;
	ALLOWED_EMAIL?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	[key: string]: unknown;
}

export interface ProcessResult {
	message_id: string;
	email_type: 'confirm' | 'cancel' | 'unknown';
	result: 'success' | 'duplicate' | 'parse_failed' | 'orphan_cancel' | 'error';
	booking_id?: string;
	error?: string;
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────

function nowSqlite(): string {
	return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * shoot_date "2026-05-19 15:00:00" → "5월 19일(월) 오후 3시"
 */
function formatShootDate(sqliteDate: string): string {
	const d = new Date(sqliteDate.replace(' ', 'T') + 'Z');
	if (isNaN(d.getTime())) return sqliteDate;
	const month = d.getUTCMonth() + 1;
	const day = d.getUTCDate();
	const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
	const dayLabel = dayLabels[d.getUTCDay()];
	let hour = d.getUTCHours();
	const minute = d.getUTCMinutes();
	const ampm = hour < 12 ? '오전' : '오후';
	if (hour > 12) hour -= 12;
	if (hour === 0) hour = 12;
	const minuteStr = minute > 0 ? ` ${minute}분` : '';
	return `${month}월 ${day}일(${dayLabel}) ${ampm} ${hour}시${minuteStr}`;
}

async function recordProcessed(
	env: Env,
	messageId: string,
	emailType: 'confirm' | 'cancel' | 'unknown',
	bookingId: string | null,
	result: string,
	errorMessage: string | null,
	parsedData: unknown,
	subject: string,
	rawReceivedAt: string,
): Promise<void> {
	await env.DB.prepare(
		`INSERT OR IGNORE INTO processed_emails
		   (message_id, email_type, booking_id, processing_result, error_message,
		    parsed_data, raw_subject, raw_received_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	)
		.bind(
			messageId,
			emailType,
			bookingId,
			result,
			errorMessage,
			parsedData ? JSON.stringify(parsedData) : null,
			subject,
			rawReceivedAt,
		)
		.run();
}

// ─── booking_details 자동 분리 + 매칭 ─────────────────────────────────

interface SplitMatchResult {
	id: number;
	raw_text: string;
	match_status: 'matched' | 'unmatched';
	product_id?: number;
	product_name?: string;
}

/**
 * service_details (cleaned) → ' + ' split → 각 항목 매칭 → booking_details INSERT.
 * 옵션 C 매칭: 가격 부분 제거 후 match_keyword와 정확 일치.
 */
async function splitAndMatchBookingDetails(
	env: Env,
	bookingId: string,
	menuCleaned: string,
): Promise<SplitMatchResult[]> {
	if (!menuCleaned || !menuCleaned.trim()) return [];

	// 1. ' + ' (양쪽 공백)으로 split — 상품명 안 '+' 보존
	const items = menuCleaned
		.split(/\s\+\s/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);

	const results: SplitMatchResult[] = [];

	for (const rawText of items) {
		// 2. 가격 부분 제거 → 키워드만
		const keyword = rawText.replace(/\s*[\d,]+\s*원\s*$/, '').trim();
		if (!keyword) {
			console.warn(`[email-processor] 빈 키워드, raw=${rawText} skip`);
			continue;
		}

		// 3. products.match_keyword 정확 일치 (공백 무시, active만)
		const product = await env.DB.prepare(
			`SELECT product_id, product_name
			 FROM products
			 WHERE REPLACE(match_keyword, ' ', '') = REPLACE(?1, ' ', '')
			   AND is_active = 1
			 LIMIT 1`,
		)
			.bind(keyword)
			.first<{ product_id: number; product_name: string }>();

		if (product) {
			const ins = await env.DB.prepare(
				`INSERT INTO booking_details (booking_id, product_id, quantity, match_status, raw_text)
				 VALUES (?1, ?2, 1, 'matched', ?3)
				 RETURNING id`,
			)
				.bind(bookingId, product.product_id, rawText)
				.first<{ id: number }>();
			console.log(
				`[email-processor] booking_detail matched booking_id=${bookingId} product=${product.product_name} (id=${ins?.id})`,
			);
			results.push({
				id: ins?.id ?? 0,
				raw_text: rawText,
				match_status: 'matched',
				product_id: product.product_id,
				product_name: product.product_name,
			});
		} else {
			const ins = await env.DB.prepare(
				`INSERT INTO booking_details (booking_id, product_id, quantity, match_status, raw_text)
				 VALUES (?1, NULL, 1, 'unmatched', ?2)
				 RETURNING id`,
			)
				.bind(bookingId, rawText)
				.first<{ id: number }>();
			console.warn(
				`[email-processor] booking_detail unmatched booking_id=${bookingId} keyword="${keyword}" (id=${ins?.id})`,
			);
			results.push({
				id: ins?.id ?? 0,
				raw_text: rawText,
				match_status: 'unmatched',
			});
		}
	}

	return results;
}

async function insertSystemMessage(
	env: Env,
	args: { title: string; body: string; metadata: Record<string, unknown> },
): Promise<number | null> {
	const message = args.title ? `${args.title}\n\n${args.body}` : args.body;
	const createdAt = nowSqlite();
	const result = await env.DB.prepare(
		`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
		 VALUES ('system', ?1, ?2, ?3)
		 RETURNING id`,
	)
		.bind(message, JSON.stringify(args.metadata), createdAt)
		.first<{ id: number }>();
	return result?.id ?? null;
}

// ─── 메인 ──────────────────────────────────────────────────────────────

export async function processEmail(
	env: Env,
	message: GmailMessage,
): Promise<ProcessResult> {
	const messageId = message.id;
	const subject = getHeader(message, 'Subject') || '';
	const dateHeader = getHeader(message, 'Date') || '';

	try {
		// 1. 중복 확인
		const existing = await env.DB.prepare(
			'SELECT message_id FROM processed_emails WHERE message_id = ?1',
		)
			.bind(messageId)
			.first();

		if (existing) {
			console.log(`[email-processor] 중복 message_id=${messageId} — skip`);
			return { message_id: messageId, email_type: 'unknown', result: 'duplicate' };
		}

		// 2. 분류
		const emailType = detectEmailType(subject);

		// 3. 본문 추출
		const body = extractPlainBody(message);
		if (!body) {
			console.warn(`[email-processor] 본문 추출 실패 message_id=${messageId}`);
			await recordProcessed(
				env,
				messageId,
				emailType,
				null,
				'parse_failed',
				'본문 추출 실패',
				null,
				subject,
				dateHeader,
			);
			return {
				message_id: messageId,
				email_type: emailType,
				result: 'parse_failed',
				error: '본문 추출 실패',
			};
		}

		// 4. 분기
		if (emailType === 'confirm') {
			return await processConfirmEmail(env, messageId, subject, dateHeader, body);
		}
		if (emailType === 'cancel') {
			return await processCancelEmail(env, messageId, subject, dateHeader, body);
		}

		console.log(
			`[email-processor] 알 수 없는 메일 유형 message_id=${messageId} subject=${subject.slice(0, 50)}`,
		);
		await recordProcessed(
			env,
			messageId,
			'unknown',
			null,
			'success',
			null,
			null,
			subject,
			dateHeader,
		);
		return { message_id: messageId, email_type: 'unknown', result: 'success' };
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(
			`[email-processor] 처리 중 에러 message_id=${messageId}:`,
			errMsg,
		);
		await recordProcessed(
			env,
			messageId,
			'unknown',
			null,
			'error',
			errMsg,
			null,
			subject,
			dateHeader,
		).catch(() => {});
		return {
			message_id: messageId,
			email_type: 'unknown',
			result: 'error',
			error: errMsg,
		};
	}
}

// ─── 확정 메일 ────────────────────────────────────────────────────────

async function processConfirmEmail(
	env: Env,
	messageId: string,
	subject: string,
	dateHeader: string,
	body: string,
): Promise<ProcessResult> {
	const parsed = parseConfirmEmail(body);

	if (!parsed) {
		await recordProcessed(
			env,
			messageId,
			'confirm',
			null,
			'parse_failed',
			'확정 메일 파싱 실패',
			null,
			subject,
			dateHeader,
		);
		await insertSystemMessage(env, {
			title: '⚠️ 메일 파싱 실패 (확정)',
			body: `Gmail message_id: ${messageId}\n수동 확인이 필요합니다.`,
			metadata: {
				source: 'naver_email',
				type: 'parse_failed',
				message_id: messageId,
				subject,
			},
		});
		return { message_id: messageId, email_type: 'confirm', result: 'parse_failed' };
	}

	const now = nowSqlite();
	const insertResult = await env.DB.prepare(
		`INSERT OR IGNORE INTO bookings (
			booking_id, talk_id, customer_name, product_name, service_details,
			payment_amount, request_note,
			reservation_date, shoot_date, current_stage,
			created_at, updated_at
		) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'S0', ?9, ?9)`,
	)
		.bind(
			parsed.booking_id,
			parsed.customer_name,
			parsed.product_name,
			parsed.menu_cleaned,
			parsed.payment_amount,
			parsed.request_note,
			parsed.reservation_date,
			parsed.shoot_date,
			now,
		)
		.run();

	const wasInserted = (insertResult.meta?.changes ?? 0) > 0;
	console.log(
		`[email-processor] 확정 booking_id=${parsed.booking_id} ${wasInserted ? 'INSERT' : '이미 존재 (IGNORE)'}`,
	);

	// booking_details 자동 분리 + 매칭
	const detailResults = await splitAndMatchBookingDetails(
		env,
		parsed.booking_id,
		parsed.menu_cleaned,
	);
	const unmatchedItems = detailResults.filter(
		(r) => r.match_status === 'unmatched',
	);
	const matchInfo = {
		total_items: detailResults.length,
		matched: detailResults.filter((r) => r.match_status === 'matched').length,
		unmatched: unmatchedItems.length,
		unmatched_texts: unmatchedItems.map((u) => u.raw_text),
	};

	await recordProcessed(
		env,
		messageId,
		'confirm',
		parsed.booking_id,
		'success',
		null,
		parsed,
		subject,
		dateHeader,
	);

	const shootDateLabel = formatShootDate(parsed.shoot_date);

	// === Step 4-C: 확정문자 생성 ===

	// 1. booking_details + products JOIN
	const detailRows = await env.DB.prepare(
		`SELECT
		   bd.match_status, bd.raw_text,
		   bd.product_id,
		   p.product_name, p.match_keyword,
		   COALESCE(p.retouch_count, 0) AS retouch_count,
		   p.retouch_breakdown,
		   COALESCE(p.frame_count, 0) AS frame_count,
		   p.frame_size, p.extra_note
		 FROM booking_details bd
		 LEFT JOIN products p ON bd.product_id = p.product_id
		 WHERE bd.booking_id = ?1
		 ORDER BY bd.id`,
	)
		.bind(parsed.booking_id)
		.all<BookingDetailWithProduct>();
	const details = (detailRows.results || []) as BookingDetailWithProduct[];

	// 2. 확정문자 메시지 생성 + system 메시지 INSERT
	const confirmMessage = buildConfirmMessage(
		parsed.customer_name,
		parsed.booking_id,
		parsed.shoot_date,
		details,
	);
	const confirmMsgId = await insertSystemMessage(env, {
		title: '',
		body: confirmMessage,
		metadata: {
			source: 'naver_email',
			type: 'confirm_message',
			message_id: messageId,
			booking_id: parsed.booking_id,
			parsed,
			match_info: matchInfo,
		},
	});
	console.log(
		`[email-processor] 확정문자 생성 booking_id=${parsed.booking_id} details=${details.length}`,
	);

	// 3. 추가질문 매칭 + system 메시지 INSERT (있으면)
	const questionsResult = await env.DB.prepare(
		`SELECT question_id, question_code, trigger_keyword, question_text
		 FROM additional_questions
		 WHERE is_active = 1`,
	).all<AdditionalQuestion>();
	const matchedQuestions = matchAdditionalQuestions(
		details,
		(questionsResult.results || []) as AdditionalQuestion[],
	);
	if (matchedQuestions.length > 0) {
		const questionMessage = buildAdditionalQuestionMessage(matchedQuestions);
		if (questionMessage) {
			await insertSystemMessage(env, {
				title: '',
				body: questionMessage,
				metadata: {
					source: 'naver_email',
					type: 'additional_questions',
					booking_id: parsed.booking_id,
					matched_codes: matchedQuestions.map((q) => q.question_code),
				},
			});
		}
		console.log(
			`[email-processor] 추가질문 매칭 booking_id=${parsed.booking_id} questions=${matchedQuestions.length} (codes: ${matchedQuestions.map((q) => q.question_code).join(',')})`,
		);
	}

	// 4. 매칭 실패 항목 있으면 별도 알림 system 메시지
	if (unmatchedItems.length > 0) {
		const listText = unmatchedItems
			.map(
				(u, i) =>
					`${i + 1}. ${u.raw_text} (booking_detail_id=${u.id})`,
			)
			.join('\n');
		await insertSystemMessage(env, {
			title: `⚠️ 상품 매칭 실패: ${parsed.customer_name}`,
			body:
				`예약번호 ${parsed.booking_id}에 매칭 안 된 항목 ${unmatchedItems.length}개:\n${listText}\n\n` +
				`AI에게 "booking_detail_id=N을 PRODUCT_CODE로 매칭해줘" 요청하시면 수동 매칭 가능합니다.`,
			metadata: {
				source: 'naver_email',
				type: 'unmatched_products',
				booking_id: parsed.booking_id,
				unmatched: unmatchedItems,
			},
		});
	}

	// 5. 푸시 발송 (옵션 A)
	if (env.ALLOWED_EMAIL) {
		await sendPushNotification(env as any, env.ALLOWED_EMAIL, {
			title: `📧 새 예약: ${parsed.customer_name}`,
			body: `${shootDateLabel} ${parsed.product_name}`,
			tag: `email_${parsed.booking_id}`,
			data: {
				source: 'naver_email',
				booking_id: parsed.booking_id,
				chat_message_id: confirmMsgId,
				type: 'confirm_message',
			},
		}).catch((err) =>
			console.error('[email-processor] push 발송 실패:', err),
		);
	}

	// === Phase 5 Step 3-B: 캘린더 자동 등록 ===
	// 성공/스킵은 조용히 통과, 실패만 강조 메시지 + 푸시. throw 안 함 — 메일 처리 흐름 유지.
	try {
		await createCalendarEventForBooking(
			{ env: env as any, db: env.DB },
			parsed.booking_id,
			{ dryRun: false },
		);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error(
			'[Phase5] Calendar registration failed:',
			parsed.booking_id,
			errorMessage,
		);

		// bookings.customer_name 우선 (echo 매칭 후 풀네임 갱신됨)
		const bookingRow = await env.DB.prepare(
			`SELECT customer_name FROM bookings WHERE booking_id = ?1`,
		)
			.bind(parsed.booking_id)
			.first<{ customer_name: string }>();
		const customerName =
			bookingRow?.customer_name && bookingRow.customer_name.trim()
				? bookingRow.customer_name
				: parsed.customer_name || '(이름 없음)';

		const alertMessage =
			`🚨🚨🚨 캘린더 등록 실패 🚨🚨🚨\n` +
			`\n` +
			`📌 예약번호: ${parsed.booking_id}\n` +
			`📌 고객: ${customerName}\n` +
			`📌 사유: ${errorMessage}\n` +
			`\n` +
			`⚠️ 수동 등록 필요:\n` +
			`curl -H "Authorization: $ADMIN" "https://studio-task-safeguard.koreakyw0822.workers.dev/test/calendar-create?bookingId=${parsed.booking_id}"`;

		await env.DB.prepare(
			`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
			 VALUES ('system', ?1, ?2, datetime('now'))`,
		)
			.bind(
				alertMessage,
				JSON.stringify({
					type: 'calendar_error',
					booking_id: parsed.booking_id,
					customer_name: customerName,
					error: errorMessage,
				}),
			)
			.run();

		if (env.ALLOWED_EMAIL) {
			await sendPushNotification(env as any, env.ALLOWED_EMAIL, {
				title: '🚨 캘린더 등록 실패',
				body: `${customerName} (${parsed.booking_id}) — 채팅창 확인 필요`,
				tag: `calendar_error_${parsed.booking_id}`,
				data: {
					source: 'calendar_error',
					booking_id: parsed.booking_id,
				},
			}).catch((e) => console.error('[Phase5] push failed:', e));
		}
	}
	// === Phase 5 끝 ===

	return {
		message_id: messageId,
		email_type: 'confirm',
		result: 'success',
		booking_id: parsed.booking_id,
	};
}

// ─── 취소 메일 ────────────────────────────────────────────────────────

async function processCancelEmail(
	env: Env,
	messageId: string,
	subject: string,
	dateHeader: string,
	body: string,
): Promise<ProcessResult> {
	const parsed = parseCancelEmail(body);

	if (!parsed) {
		await recordProcessed(
			env,
			messageId,
			'cancel',
			null,
			'parse_failed',
			'취소 메일 파싱 실패',
			null,
			subject,
			dateHeader,
		);
		await insertSystemMessage(env, {
			title: '⚠️ 메일 파싱 실패 (취소)',
			body: `Gmail message_id: ${messageId}\n수동 확인이 필요합니다.`,
			metadata: {
				source: 'naver_email',
				type: 'parse_failed',
				message_id: messageId,
				subject,
			},
		});
		return { message_id: messageId, email_type: 'cancel', result: 'parse_failed' };
	}

	const existing = await env.DB.prepare(
		'SELECT booking_id, customer_name FROM bookings WHERE booking_id = ?1',
	)
		.bind(parsed.booking_id)
		.first<{ booking_id: string; customer_name: string }>();

	if (!existing) {
		console.warn(
			`[email-processor] 고아 취소 메일 booking_id=${parsed.booking_id}`,
		);
		await recordProcessed(
			env,
			messageId,
			'cancel',
			parsed.booking_id,
			'orphan_cancel',
			'확정 booking 없음',
			parsed,
			subject,
			dateHeader,
		);
		await insertSystemMessage(env, {
			title: '⚠️ 고아 취소 메일',
			body:
				`예약번호 ${parsed.booking_id}의 확정 메일이 없는데 취소 메일이 도착했어요.\n` +
				`고객명: ${parsed.customer_name}\n수동 확인 필요합니다.`,
			metadata: {
				source: 'naver_email',
				type: 'orphan_cancel',
				message_id: messageId,
				parsed,
			},
		});
		return {
			message_id: messageId,
			email_type: 'cancel',
			result: 'orphan_cancel',
			booking_id: parsed.booking_id,
		};
	}

	const now = nowSqlite();
	await env.DB.prepare(
		`UPDATE bookings
		 SET cancelled = 1, cancelled_at = ?2, cancellation_reason = ?3,
		     refund_amount = ?4, updated_at = ?5
		 WHERE booking_id = ?1`,
	)
		.bind(
			parsed.booking_id,
			parsed.cancelled_at,
			parsed.cancellation_reason,
			parsed.refund_amount,
			now,
		)
		.run();

	console.log(`[email-processor] 취소 booking_id=${parsed.booking_id} UPDATE`);

	await recordProcessed(
		env,
		messageId,
		'cancel',
		parsed.booking_id,
		'success',
		null,
		parsed,
		subject,
		dateHeader,
	);

	await insertSystemMessage(env, {
		title: `❌ 예약 취소: ${parsed.customer_name}`,
		body:
			`예약번호: ${parsed.booking_id}\n` +
			`환불금액: ${parsed.refund_amount.toLocaleString()}원\n` +
			`사유: ${parsed.cancellation_reason || '미기재'}`,
		metadata: {
			source: 'naver_email',
			type: 'cancel',
			message_id: messageId,
			booking_id: parsed.booking_id,
			parsed,
		},
	});

	// === Phase 5 Step 4-A: 캘린더 취소 표기 ===
	// throw 안 함 — 메일 처리 흐름 유지. marked/already_marked는 조용히 통과,
	// no_event_id/not_found/예외만 강조 메시지 + 푸시.
	{
		let calendarStatus: string | null = null;
		let calendarMessage: string | null = null;
		let calendarError: string | null = null;

		try {
			const result = await markCalendarEventCancelled(
				{ env: env as any, db: env.DB },
				parsed.booking_id,
			);
			calendarStatus = result.status;
			calendarMessage = result.message ?? null;
			console.log(
				'[Phase5] Calendar cancellation:',
				parsed.booking_id,
				result.status,
			);
		} catch (err) {
			calendarError = err instanceof Error ? err.message : String(err);
			console.error(
				'[Phase5] Calendar cancellation throw:',
				parsed.booking_id,
				calendarError,
			);
		}

		const needsAlert =
			calendarError !== null ||
			calendarStatus === 'no_event_id' ||
			calendarStatus === 'not_found';

		if (needsAlert) {
			const bookingRow = await env.DB.prepare(
				`SELECT customer_name FROM bookings WHERE booking_id = ?1`,
			)
				.bind(parsed.booking_id)
				.first<{ customer_name: string }>();
			const customerName =
				bookingRow?.customer_name && bookingRow.customer_name.trim()
					? bookingRow.customer_name
					: parsed.customer_name || '(이름 없음)';

			let reasonText: string;
			if (calendarError) {
				reasonText = `에러: ${calendarError}`;
			} else if (calendarStatus === 'no_event_id') {
				reasonText = '캘린더에 등록된 적이 없는 예약입니다';
			} else if (calendarStatus === 'not_found') {
				reasonText =
					'캘린더에서 이벤트를 찾을 수 없습니다 (수동 삭제됐을 수 있음)';
			} else {
				reasonText = `상태: ${calendarStatus}`;
			}

			const alertMessage =
				`🚨🚨🚨 캘린더 취소 표기 누락 🚨🚨🚨\n` +
				`\n` +
				`📌 예약번호: ${parsed.booking_id}\n` +
				`📌 고객: ${customerName}\n` +
				`📌 사유: ${reasonText}\n` +
				`\n` +
				`⚠️ 해당 일정이 캘린더에 남아 있다면 직접 취소 표기 부탁드립니다.`;

			await env.DB.prepare(
				`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
				 VALUES ('system', ?1, ?2, datetime('now'))`,
			)
				.bind(
					alertMessage,
					JSON.stringify({
						type: 'calendar_cancel_alert',
						booking_id: parsed.booking_id,
						customer_name: customerName,
						status: calendarStatus,
						message: calendarMessage,
						error: calendarError,
					}),
				)
				.run();

			if (env.ALLOWED_EMAIL) {
				await sendPushNotification(env as any, env.ALLOWED_EMAIL, {
					title: '🚨 캘린더 취소 표기 누락',
					body: `${customerName} (${parsed.booking_id}) — 채팅창 확인 필요`,
					tag: `calendar_cancel_alert_${parsed.booking_id}`,
					data: {
						source: 'calendar_cancel_alert',
						booking_id: parsed.booking_id,
					},
				}).catch((e) =>
					console.error('[Phase5] push failed:', e),
				);
			}
		}
	}
	// === Phase 5 끝 ===

	return {
		message_id: messageId,
		email_type: 'cancel',
		result: 'success',
		booking_id: parsed.booking_id,
	};
}

/**
 * Phase 5 Step 2-B/3-A: Calendar event resource 빌더 + 생성 헬퍼.
 *
 * buildEventResource는 순수 함수 (DB 접근 X). 시간 처리는 환경 타임존을 타지 않도록 문자열 파싱만 사용.
 * gatherEventInputForBooking, createCalendarEventForBooking은 DB/Calendar API에 의존.
 */

import {
	createEvent,
	getEvent,
	listEventsByBookingId,
	patchEvent,
} from './calendar-client';

export interface BuildEventInput {
	bookingId: string;
	customerName: string;
	shootDateTime: string; // "2026-05-30 11:00:00" SQLite 형식 (KST 의도)
	productName: string;
	reservationDate: string; // "2026-05-12 18:23:45" 등
	paymentAmount: number;
	menuCleaned: string;
	requestNote: string | null;
	abbreviations: string[]; // calendar_abbr 배열 (NOT NULL만)
	gmailMessageId: string;
	bizId: string;
	timezone: string; // "Asia/Seoul"
}

export interface CalendarEventResource {
	summary: string;
	description: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	extendedProperties: { private: { bookingId: string } };
}

/**
 * "2026-05-30 11:00:00" → "2026-05-30T11:00:00" (Z 없음, timezone은 별도 필드).
 */
function sqliteToISO(sqliteDate: string): string {
	return sqliteDate.replace(' ', 'T');
}

/**
 * SQLite datetime 문자열에 1시간을 더해 같은 형식으로 반환.
 * 날짜 경계 처리는 Date 객체로 안전하게 (UTC 기준 — 시각 문자열만 보존).
 */
function addOneHour(sqliteDate: string): string {
	const iso = sqliteToISO(sqliteDate) + 'Z'; // UTC 취급해서 +1h 계산
	const t = new Date(iso).getTime() + 60 * 60 * 1000;
	const d = new Date(t);
	const pad = (n: number) => String(n).padStart(2, '0');
	return (
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
		`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
	);
}

/**
 * "2026-05-30 11:00:00" → 11 (시 정수). 문자열 파싱만 — 환경 타임존 무관.
 */
function extractHour(sqliteDate: string): number {
	const m = sqliteDate.match(/\s(\d{1,2}):/);
	if (!m) return 0;
	return Number(m[1]);
}

function buildDescription(input: BuildEventInput): string {
	const lines: string[] = [];
	lines.push('📌 고객 메모');
	lines.push('');

	const note = input.requestNote;
	const hasNote = note && note.trim() !== '' && note.trim() !== '-';
	if (hasNote) {
		lines.push(`📌 요청사항: ${note}`);
	}

	lines.push(`👤 ${input.customerName}`);
	lines.push(`🎫 ${input.productName}`);
	lines.push(`📅 예약신청: ${input.reservationDate}`);
	lines.push(`🔖 예약번호: ${input.bookingId}`);
	lines.push(`💰 결제: ${input.paymentAmount.toLocaleString('ko-KR')}원`);
	lines.push(`📋 선택메뉴: ${input.menuCleaned}`);
	{
		const bookingUrl = `https://partner.booking.naver.com/bizes/${input.bizId}/booking-list-view/bookings/${input.bookingId}`;
		const mailUrl = `https://mail.google.com/mail/u/0/#inbox/${input.gmailMessageId}`;
		lines.push(`🔗 자세히 보기: <a href="${bookingUrl}">${bookingUrl}</a>`);
		lines.push(`📧 원본 메일: <a href="${mailUrl}">${mailUrl}</a>`);
	}

	return lines.join('\n');
}

export function buildEventResource(
	input: BuildEventInput,
): CalendarEventResource {
	const startISO = sqliteToISO(input.shootDateTime);
	const endSqlite = addOneHour(input.shootDateTime);
	const endISO = sqliteToISO(endSqlite);

	const startHour = extractHour(input.shootDateTime);
	const endHour = (startHour + 1) % 24;

	const label =
		input.abbreviations.length > 0
			? input.abbreviations.join(',')
			: input.productName;

	const summary = `${startHour}~${endHour}/${input.customerName}(${label})`;
	const description = buildDescription(input);

	return {
		summary,
		description,
		start: { dateTime: startISO, timeZone: input.timezone },
		end: { dateTime: endISO, timeZone: input.timezone },
		extendedProperties: { private: { bookingId: input.bookingId } },
	};
}

// ─── Phase 5 Step 3-A: DB → eventResource 생성 헬퍼 ──────────────────────

interface Env {
	DB: D1Database;
	GOOGLE_OAUTH_CLIENT_ID: string;
	GOOGLE_OAUTH_CLIENT_SECRET: string;
	CALENDAR_ID: string;
	NAVER_BIZ_ID: string;
	TIMEZONE: string;
	[key: string]: unknown;
}

interface BookingRow {
	booking_id: string;
	customer_name: string;
	shoot_date: string | null;
	calendar_event_id: string | null;
	cancelled: number;
}

export type GatherEventInputResult =
	| { ok: true; input: BuildEventInput; gmailMessageId: string }
	| { ok: false; reason: 'no_email' };

/**
 * bookings + processed_emails + booking_details(약어) 조합 후 BuildEventInput 생성.
 * cancelled/shoot_date_missing/booking_not_found는 호출자가 책임 (이 함수 진입 전에 검증).
 *
 * 고객명 우선순위: bookings.customer_name (echo 매칭 후 풀네임 갱신됨) → parsed_data.customer_name fallback.
 */
export async function gatherEventInputForBooking(
	db: D1Database,
	bookingId: string,
	customerName: string,
	shootDate: string,
	bizId: string,
	timezone: string,
): Promise<GatherEventInputResult> {
	const email = await db
		.prepare(
			`SELECT message_id, parsed_data
			 FROM processed_emails
			 WHERE booking_id = ?1
			   AND email_type = 'confirm'
			   AND processing_result = 'success'
			 ORDER BY processed_at DESC
			 LIMIT 1`,
		)
		.bind(bookingId)
		.first<{ message_id: string; parsed_data: string | null }>();

	if (!email) return { ok: false, reason: 'no_email' };

	let parsed: Record<string, unknown> = {};
	if (email.parsed_data) {
		try {
			parsed = JSON.parse(email.parsed_data);
		} catch {
			parsed = {};
		}
	}

	const abbrRows = await db
		.prepare(
			`SELECT p.calendar_abbr AS abbr
			 FROM booking_details bd
			 JOIN products p ON bd.product_id = p.product_id
			 WHERE bd.booking_id = ?1
			   AND p.calendar_abbr IS NOT NULL
			 ORDER BY bd.id`,
		)
		.bind(bookingId)
		.all<{ abbr: string }>();
	const abbreviations = (abbrRows.results || [])
		.map((r) => r.abbr)
		.filter((a): a is string => !!a);

	const resolvedName =
		customerName && customerName.trim()
			? customerName
			: (parsed.customer_name as string | undefined) ?? '';

	return {
		ok: true,
		gmailMessageId: email.message_id,
		input: {
			bookingId,
			customerName: resolvedName,
			shootDateTime: shootDate,
			productName: (parsed.product_name as string | undefined) ?? '',
			reservationDate:
				(parsed.reservation_date as string | undefined) ?? '',
			paymentAmount:
				typeof parsed.payment_amount === 'number' ? parsed.payment_amount : 0,
			menuCleaned: (parsed.menu_cleaned as string | undefined) ?? '',
			requestNote: (parsed.request_note as string | null | undefined) ?? null,
			abbreviations,
			gmailMessageId: email.message_id,
			bizId,
			timezone,
		},
	};
}

export interface CreateOrSkipResult {
	status:
		| 'created'
		| 'already_exists'
		| 'already_exists_in_calendar'
		| 'skipped_no_shoot_date'
		| 'skipped_no_email'
		| 'skipped_cancelled';
	eventId?: string;
	summary?: string;
	eventResource?: CalendarEventResource;
	reason?: string;
}

/**
 * booking → 캘린더 이벤트 생성 (멱등성 보장).
 *
 * 멱등성 2단계:
 *   1차: bookings.calendar_event_id 확인 → getEvent로 실존 검증 (404면 NULL로 리셋)
 *   2차: listEventsByBookingId로 extendedProperties.private.bookingId 검색
 *
 * dryRun=true면 createEvent와 UPDATE를 모두 스킵. eventResource만 반환.
 *
 * booking_not_found는 throw — 호출자가 404 매핑.
 */
export async function createCalendarEventForBooking(
	deps: { env: Env; db: D1Database },
	bookingId: string,
	options: { dryRun?: boolean } = {},
): Promise<CreateOrSkipResult> {
	const dryRun = options.dryRun === true;
	const { env, db } = deps;

	const booking = await db
		.prepare(
			`SELECT booking_id, customer_name, shoot_date, calendar_event_id, cancelled
			 FROM bookings WHERE booking_id = ?1`,
		)
		.bind(bookingId)
		.first<BookingRow>();

	if (!booking) {
		throw new Error('booking_not_found');
	}

	if (booking.cancelled === 1) {
		return { status: 'skipped_cancelled' };
	}

	if (!booking.shoot_date || !booking.shoot_date.trim()) {
		return { status: 'skipped_no_shoot_date' };
	}

	// 멱등성 1차: 저장된 event_id가 실존하는지 확인
	if (booking.calendar_event_id) {
		try {
			const existing = await getEvent(env, booking.calendar_event_id);
			return {
				status: 'already_exists',
				eventId: existing.id,
				summary: existing.summary,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('404')) {
				// 캘린더에서 삭제된 이벤트 — bookings의 stale id를 비우고 계속
				await db
					.prepare(
						`UPDATE bookings
						 SET calendar_event_id = NULL, updated_at = datetime('now')
						 WHERE booking_id = ?1`,
					)
					.bind(bookingId)
					.run();
			} else {
				throw err;
			}
		}
	}

	// 멱등성 2차: bookingId로 캘린더 검색 (다른 경로로 생성된 이벤트 잡기)
	const found = await listEventsByBookingId(env, bookingId);
	const foundItems = found.items ?? [];
	if (foundItems.length > 0) {
		const ev = foundItems[0];
		if (!dryRun) {
			await db
				.prepare(
					`UPDATE bookings
					 SET calendar_event_id = ?1, updated_at = datetime('now')
					 WHERE booking_id = ?2`,
				)
				.bind(ev.id, bookingId)
				.run();
		}
		return {
			status: 'already_exists_in_calendar',
			eventId: ev.id,
			summary: ev.summary,
		};
	}

	// 데이터 수집 → eventResource 빌드
	const gathered = await gatherEventInputForBooking(
		db,
		booking.booking_id,
		booking.customer_name,
		booking.shoot_date,
		env.NAVER_BIZ_ID,
		env.TIMEZONE,
	);
	if (!gathered.ok) {
		return { status: 'skipped_no_email' };
	}

	const eventResource = buildEventResource(gathered.input);

	if (dryRun) {
		return {
			status: 'created',
			eventId: '(dry-run)',
			summary: eventResource.summary,
			eventResource,
		};
	}

	const created = await createEvent(env, eventResource as unknown as Record<string, unknown>);
	await db
		.prepare(
			`UPDATE bookings
			 SET calendar_event_id = ?1, updated_at = datetime('now')
			 WHERE booking_id = ?2`,
		)
		.bind(created.id, bookingId)
		.run();

	return {
		status: 'created',
		eventId: created.id,
		summary: created.summary,
		eventResource,
	};
}

// ─── Phase 5 Step 4-A: 취소 표기 ──────────────────────────────────────

export interface MarkCancelledResult {
	status: 'marked' | 'no_event_id' | 'not_found' | 'already_marked';
	eventId?: string;
	message?: string;
}

/**
 * 취소 메일 도착 시 캘린더 이벤트에 취소 표기 (summary prefix + description 라인 + 빨강 색상).
 * 멱등성: summary가 이미 ❌취소요청- 시작이고 description에 [취소 알림 도착: 포함이면 스킵.
 */
export async function markCalendarEventCancelled(
	deps: { env: Env; db: D1Database },
	bookingId: string,
): Promise<MarkCancelledResult> {
	const { env, db } = deps;

	const row = await db
		.prepare(
			`SELECT calendar_event_id FROM bookings WHERE booking_id = ?1`,
		)
		.bind(bookingId)
		.first<{ calendar_event_id: string | null }>();

	const eventId = row?.calendar_event_id;
	if (!eventId) {
		return { status: 'no_event_id', message: '캘린더 등록 기록 없음' };
	}

	let existing;
	try {
		existing = await getEvent(env, eventId);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('404')) {
			await db
				.prepare(
					`UPDATE bookings
					 SET calendar_event_id = NULL, updated_at = datetime('now')
					 WHERE booking_id = ?1`,
				)
				.bind(bookingId)
				.run();
			return {
				status: 'not_found',
				message: '캘린더에서 이벤트를 찾을 수 없음',
			};
		}
		throw err;
	}

	const existingSummary = existing.summary ?? '';
	const existingDescription = existing.description ?? '';

	const alreadyHasPrefix = existingSummary.startsWith('❌취소요청-');
	const alreadyHasCancelLine = existingDescription.includes('[취소 알림 도착:');
	if (alreadyHasPrefix && alreadyHasCancelLine) {
		return {
			status: 'already_marked',
			eventId,
			message: '이미 취소 표기됨',
		};
	}

	const newSummary = alreadyHasPrefix
		? existingSummary
		: `❌취소요청-${existingSummary}`;

	const cancelLine = `[취소 알림 도착: ${new Date().toISOString()}]`;
	const newDescription = alreadyHasCancelLine
		? existingDescription
		: `${cancelLine}\n${existingDescription}`;

	await patchEvent(env, eventId, {
		summary: newSummary,
		description: newDescription,
		colorId: '11',
	});

	return { status: 'marked', eventId };
}

// ─── Phase 5: echo 이름 갱신 시 캘린더 제목 동기화 ──────────────────────────

export interface RenameCustomerResult {
	status: 'patched' | 'no_event_id' | 'not_found' | 'no_change';
	eventId?: string;
	newSummary?: string;
}

/**
 * bookings.customer_name이 풀네임으로 갱신될 때 캘린더 이벤트 summary/description도 동기화.
 *
 * summary 형식: "11~12/홍길동(가족(클))" — 이름 부분만 교체.
 * description: "👤 이름" 줄도 함께 갱신.
 * 이벤트가 없거나(no_event_id) 이미 같은 이름(no_change)이면 조용히 종료.
 */
export async function renameCustomerInCalendarEvent(
	deps: { env: Env; db: D1Database },
	bookingId: string,
	newName: string,
): Promise<RenameCustomerResult> {
	const { env, db } = deps;

	const row = await db
		.prepare(
			`SELECT calendar_event_id FROM bookings WHERE booking_id = ?1`,
		)
		.bind(bookingId)
		.first<{ calendar_event_id: string | null }>();

	if (!row?.calendar_event_id) {
		return { status: 'no_event_id' };
	}
	const eventId = row.calendar_event_id;

	let existing;
	try {
		existing = await getEvent(env, eventId);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('404')) return { status: 'not_found' };
		throw err;
	}

	const oldSummary = existing.summary ?? '';
	// "11~12/홍길동(가족(클))" → prefix + newName + suffix
	const newSummary = oldSummary.replace(
		/^(\d+~\d+\/)([^(]+)(\(.+\))$/,
		(_, prefix, __, suffix) => `${prefix}${newName}${suffix}`,
	);

	const oldDescription = existing.description ?? '';
	const newDescription = oldDescription.replace(
		/^(👤 ).+$/m,
		`$1${newName}`,
	);

	if (newSummary === oldSummary && newDescription === oldDescription) {
		return { status: 'no_change', eventId };
	}

	await patchEvent(env, eventId, { summary: newSummary, description: newDescription });

	return { status: 'patched', eventId, newSummary };
}

// ─── Phase 5 Step 4-B: shoot_date 변경 시 reschedule ─────────────────────

function normalizeToSqliteFormat(dateStr: string): string {
	if (!dateStr) return dateStr;
	if (dateStr.includes('T')) {
		return dateStr
			.replace('T', ' ')
			.replace(/\.\d{3}Z?$/, '')
			.replace(/Z$/, '');
	}
	return dateStr;
}

function getKstDayName(year: string, month: string, day: string): string {
	const utc = new Date(`${year}-${month}-${day}T00:00:00Z`).getTime();
	const kstNoon = new Date(utc + 12 * 3600 * 1000);
	const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
	return dayNames[kstNoon.getUTCDay()];
}

function formatScheduleDateTime(sqliteDateTime: string): string {
	if (!sqliteDateTime) return '';

	const normalized = sqliteDateTime.replace('T', ' ').trim();

	const fullMatch = normalized.match(
		/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):/,
	);
	if (fullMatch) {
		const [, year, month, day, hour] = fullMatch;
		const dayName = getKstDayName(year, month, day);
		return `${parseInt(month)}/${parseInt(day)}(${dayName}) ${parseInt(hour)}시`;
	}

	const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnlyMatch) {
		const [, year, month, day] = dateOnlyMatch;
		const dayName = getKstDayName(year, month, day);
		return `${parseInt(month)}/${parseInt(day)}(${dayName})`;
	}

	return sqliteDateTime;
}

export interface RescheduleResult {
	status:
		| 'rescheduled'
		| 're_created'
		| 'no_event_id'
		| 'no_change'
		| 'invalid_input';
	eventId?: string;
	message?: string;
}

/**
 * shoot_date 변경 시 캘린더 이벤트의 시간 + summary + description 갱신.
 *
 * - description에 "일정변경: M/D(요일) HH시 → ..." 라인 누적 (1회차는 🎫 직전 삽입, 2회차+는 끝에 화살표 추가)
 * - 캘린더 이벤트 404 → bookings.calendar_event_id NULL 리셋 후 createCalendarEventForBooking 재등록
 *
 * bookings.shoot_date는 호출 전에 이미 신규 값으로 UPDATE되어 있어야 한다 (record_milestone 흐름).
 */
export async function rescheduleCalendarEvent(
	deps: { env: Env; db: D1Database },
	bookingId: string,
	oldShootDateRaw: string | null,
	newShootDateRaw: string | null,
): Promise<RescheduleResult> {
	const oldDate = oldShootDateRaw
		? normalizeToSqliteFormat(oldShootDateRaw)
		: null;
	const newDate = newShootDateRaw
		? normalizeToSqliteFormat(newShootDateRaw)
		: null;

	if (!newDate) {
		return { status: 'invalid_input', message: '새 shoot_date 없음' };
	}
	if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(newDate)) {
		return {
			status: 'invalid_input',
			message: `새 shoot_date 형식 오류: ${newDate}`,
		};
	}
	if (!oldDate || oldDate === newDate) {
		return { status: 'no_change' };
	}

	const { env, db } = deps;

	const row = await db
		.prepare(
			`SELECT customer_name, calendar_event_id FROM bookings WHERE booking_id = ?1`,
		)
		.bind(bookingId)
		.first<{ customer_name: string; calendar_event_id: string | null }>();

	if (!row?.calendar_event_id) {
		return { status: 'no_event_id' };
	}

	let existingEvent;
	try {
		existingEvent = await getEvent(env, row.calendar_event_id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('404')) {
			await db
				.prepare(
					`UPDATE bookings
					 SET calendar_event_id = NULL, updated_at = datetime('now')
					 WHERE booking_id = ?1`,
				)
				.bind(bookingId)
				.run();
			const created = await createCalendarEventForBooking(
				deps,
				bookingId,
				{ dryRun: false },
			);
			return {
				status: 're_created',
				eventId: created.eventId,
				message: '캘린더에 이벤트가 없어 새로 등록함',
			};
		}
		throw err;
	}

	// 새 시간으로 eventResource 재빌드
	const gathered = await gatherEventInputForBooking(
		db,
		bookingId,
		row.customer_name,
		newDate,
		env.NAVER_BIZ_ID,
		env.TIMEZONE,
	);
	if (!gathered.ok) {
		return {
			status: 'invalid_input',
			message: '재빌드용 메일 데이터가 없습니다',
		};
	}
	const newEventResource = buildEventResource(gathered.input);

	// description 변경 이력 누적
	const existingDescription = existingEvent.description ?? '';
	const oldFormatted = formatScheduleDateTime(oldDate);
	const newFormatted = formatScheduleDateTime(newDate);

	const historyMatch = existingDescription.match(/^일정변경: .*$/m);

	let newDescription: string;
	if (historyMatch) {
		const oldLine = historyMatch[0];
		const newLine = `${oldLine} → ${newFormatted}`;
		newDescription = existingDescription.replace(oldLine, newLine);
	} else {
		const eventMarker = '🎫';
		const historyLine = `일정변경: ${oldFormatted} → ${newFormatted}\n`;
		const idx = existingDescription.indexOf(eventMarker);
		if (idx >= 0) {
			newDescription =
				existingDescription.slice(0, idx) +
				historyLine +
				existingDescription.slice(idx);
		} else {
			newDescription =
				existingDescription.trimEnd() + '\n\n' + historyLine.trimEnd();
		}
	}

	await patchEvent(env, row.calendar_event_id, {
		summary: newEventResource.summary,
		description: newDescription,
		start: newEventResource.start,
		end: newEventResource.end,
	});

	return { status: 'rescheduled', eventId: row.calendar_event_id };
}


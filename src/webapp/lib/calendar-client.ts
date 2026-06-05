/**
 * Phase 5 Step 2: Google Calendar API 래퍼.
 *
 * - 인증: getValidAccessToken(env) 재사용
 * - 외부 검색 식별자: extendedProperties.private.bookingId
 *   (calendar_event_id를 잃어도 booking_id로 역추적 가능)
 */

import { getValidAccessToken } from './google-tokens';

interface Env {
	DB: D1Database;
	GOOGLE_OAUTH_CLIENT_ID: string;
	GOOGLE_OAUTH_CLIENT_SECRET: string;
	CALENDAR_ID: string;
	[key: string]: unknown;
}

export interface CalendarEvent {
	id: string;
	summary?: string;
	description?: string;
	location?: string;
	status?: string;
	start?: { dateTime?: string; date?: string; timeZone?: string };
	end?: { dateTime?: string; date?: string; timeZone?: string };
	extendedProperties?: {
		private?: Record<string, string>;
		shared?: Record<string, string>;
	};
	[key: string]: unknown;
}

export interface ListEventsResponse {
	items?: CalendarEvent[];
	nextPageToken?: string;
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

function calendarBase(env: Env): string {
	return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(env.CALENDAR_ID)}`;
}

async function authedFetch(
	env: Env,
	url: string,
	init: RequestInit = {},
): Promise<Response> {
	const token = await getValidAccessToken(env);
	if (!token) {
		throw new Error(
			'Google access token 없음 — /auth/google?reauth=1 필요',
		);
	}
	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bearer ${token}`);
	if (init.body !== undefined && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	return fetch(url, { ...init, headers });
}

async function readError(res: Response, op: string): Promise<Error> {
	const text = await res.text().catch(() => '');
	return new Error(
		`Calendar API ${op} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
	);
}

/**
 * bookingId(extendedProperties.private.bookingId)로 이벤트 검색.
 */
export async function listEventsByBookingId(
	env: Env,
	bookingId: string,
): Promise<ListEventsResponse> {
	const params = new URLSearchParams({
		privateExtendedProperty: `bookingId=${bookingId}`,
		singleEvents: 'true',
		maxResults: '10',
	});
	const res = await authedFetch(env, `${calendarBase(env)}/events?${params}`);
	if (!res.ok) throw await readError(res, 'listEventsByBookingId');
	return (await res.json()) as ListEventsResponse;
}

/**
 * 다양한 필터(timeMin, orderBy 등)를 지원하는 일반 이벤트 목록 조회.
 */
export async function listEvents(
	env: Env,
	params: Record<string, string>,
): Promise<ListEventsResponse> {
	const qs = new URLSearchParams(params);
	const res = await authedFetch(env, `${calendarBase(env)}/events?${qs}`);
	if (!res.ok) throw await readError(res, 'listEvents');
	return (await res.json()) as ListEventsResponse;
}

export async function createEvent(
	env: Env,
	eventResource: Record<string, unknown>,
): Promise<CalendarEvent> {
	const res = await authedFetch(env, `${calendarBase(env)}/events`, {
		method: 'POST',
		body: JSON.stringify(eventResource),
	});
	if (!res.ok) throw await readError(res, 'createEvent');
	return (await res.json()) as CalendarEvent;
}

export async function patchEvent(
	env: Env,
	eventId: string,
	partial: Record<string, unknown>,
): Promise<CalendarEvent> {
	const res = await authedFetch(
		env,
		`${calendarBase(env)}/events/${encodeURIComponent(eventId)}`,
		{
			method: 'PATCH',
			body: JSON.stringify(partial),
		},
	);
	if (!res.ok) throw await readError(res, 'patchEvent');
	return (await res.json()) as CalendarEvent;
}

export async function getEvent(
	env: Env,
	eventId: string,
): Promise<CalendarEvent> {
	const res = await authedFetch(
		env,
		`${calendarBase(env)}/events/${encodeURIComponent(eventId)}`,
	);
	if (!res.ok) throw await readError(res, 'getEvent');
	return (await res.json()) as CalendarEvent;
}

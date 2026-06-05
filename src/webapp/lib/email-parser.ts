/**
 * 네이버 예약 메일 파서 (Phase 4 Step 3).
 *
 * - 발신자: naverbooking_noreply@navercorp.com
 * - 제목 2가지: 확정 / 취소
 * - 정규식 파싱 (AI 안 씀)
 * - 모든 datetime은 SQLite 형식 'YYYY-MM-DD HH:MM:SS' (Phase 3 교훈)
 */

export type EmailType = 'confirm' | 'cancel' | 'unknown';

export interface ParsedConfirmEmail {
	booking_id: string;
	customer_name: string;
	reservation_date: string;
	shoot_date: string;
	product_name: string;
	menu_cleaned: string;
	payment_amount: number;
	payment_method: string | null;
	request_note: string | null;
}

export interface ParsedCancelEmail {
	booking_id: string;
	customer_name: string;
	cancelled_at: string;
	refund_amount: number;
	cancellation_reason: string | null;
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 라벨로 라인/멀티라인 추출.
 * (a) 같은 라인:  "라벨   값"  또는 "라벨: 값"
 * (b) 다음 라인:  "라벨\n값"
 *
 * 두 패턴 OR로 매칭. (a)가 우선 — 같은 라인 매칭 결과가 비면 (b) 시도.
 * 메타문자 escape로 라벨에 . [ ] 등이 있어도 안전.
 */
function extractField(body: string, label: string): string | null {
	const escaped = escapeRegex(label);

	// (a) 같은 라인: 라벨 + (선택적 :) + 공백 + 값(같은 라인 끝까지)
	const sameLineRe = new RegExp(`${escaped}[\\s:]+(.+?)\\s*$`, 'm');
	const m1 = body.match(sameLineRe);
	if (m1) {
		const v = m1[1].trim();
		if (v.length > 0) return v;
	}

	// (b) 다음 라인: 라벨이 라인 끝, 값이 다음 라인
	const nextLineRe = new RegExp(`${escaped}\\s*\\n\\s*(.+?)\\s*$`, 'm');
	const m2 = body.match(nextLineRe);
	if (m2) {
		const v = m2[1].trim();
		if (v.length > 0) return v;
	}

	return null;
}

// ─── 공개 API ─────────────────────────────────────────────────────────

/**
 * 제목으로 메일 종류 분류.
 */
export function detectEmailType(subject: string): EmailType {
	if (subject.includes('새로운 예약이 확정')) return 'confirm';
	if (subject.includes('예약을 취소')) return 'cancel';
	return 'unknown';
}

/**
 * "2026.05.21.(목) 오전 10:00" → "2026-05-21 10:00:00"
 * "2026.04.29. 12:11:16" (HH:MM:SS) → "2026-04-29 12:11:16"
 * 파싱 실패 시 null.
 */
export function parseShootDateTime(s: string): string | null {
	// 형식 1: "2026.05.21.(목) 오전 10:00"
	const m1 = s.match(
		/(\d{4})\.(\d{1,2})\.(\d{1,2})\.\([^)]+\)\s+(오전|오후)\s+(\d{1,2}):(\d{1,2})/,
	);
	if (m1) {
		const [, y, mo, d, ampm, h, mi] = m1;
		let hour = parseInt(h, 10);
		if (ampm === '오후' && hour < 12) hour += 12;
		else if (ampm === '오전' && hour === 12) hour = 0;
		return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${String(hour).padStart(2, '0')}:${mi.padStart(2, '0')}:00`;
	}

	// 형식 2: "2026.04.29. 12:11:16"
	const m2 = s.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\.\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
	if (m2) {
		const [, y, mo, d, h, mi, se] = m2;
		return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${se.padStart(2, '0')}`;
	}

	return null;
}

/**
 * 선택메뉴 라인의 합계 금액 추출.
 * "= 150,000원" → 150000
 */
export function parseAmount(menu: string): number | null {
	const m = menu.match(/=\s*([\d,]+)\s*원/);
	if (!m) return null;
	const n = parseInt(m[1].replace(/,/g, ''), 10);
	return Number.isNaN(n) ? null : n;
}

/**
 * 선택메뉴에서 0원 항목과 마지막 총액(= N원)을 제거.
 *
 * 입력 예: "1인작가로 운영됩니다 0원 + 해당 시간은 단독 이용... 0원
 *          + 클래식가족+클래식아기 패키지 250,000원 + 인원추가(클래식아기) 120,000원
 *          = 370,000원"
 * 출력 예: "클래식가족+클래식아기 패키지 250,000원 + 인원추가(클래식아기) 120,000원"
 *
 * 핵심: 상품명 안에 '+' (공백 없음)가 있을 수 있어 ' + ' (양쪽 공백)로만 split.
 */
export function cleanMenu(menu: string): string {
	if (!menu) return '';

	// 1. 마지막 총액 (= N원) 제거
	let cleaned = menu.trim().replace(/\s*=\s*[\d,]+\s*원\s*$/, '');

	// 2. ' + ' (양쪽 공백 + 기호) 로 split — 상품명 안 '+' 보존
	const items = cleaned.split(/\s\+\s/);

	// 3. 각 항목 trim 후 0원으로 끝나는 항목 제거
	const filtered = items
		.map((item) => item.trim())
		.filter((item) => item.length > 0 && !/\s0\s*원$/.test(item));

	return filtered.join(' + ');
}

/**
 * 단순 환불금액/결제금액 라인 파싱.
 * "환불금액 320,000원" 또는 "= 150,000원"
 */
function parseAmountLine(text: string): number | null {
	const m = text.match(/([\d,]+)\s*원/);
	if (!m) return null;
	const n = parseInt(m[1].replace(/,/g, ''), 10);
	return Number.isNaN(n) ? null : n;
}

/**
 * 확정 메일 본문 파싱.
 */
export function parseConfirmEmail(body: string): ParsedConfirmEmail | null {
	const customerNameRaw = extractField(body, '예약자명');
	const customerName = customerNameRaw?.replace(/님$/, '') ?? null;
	const bookingId = extractField(body, '예약번호');
	const productName = extractField(body, '예약상품');
	const reservationRaw = extractField(body, '예약신청 일시');
	const shootRaw = extractField(body, '이용일시');
	const paymentMethod = extractField(body, '결제수단');
	const menuLine = extractField(body, '선택메뉴');
	const requestNoteRaw = extractField(body, '요청사항');

	if (!bookingId || !customerName || !reservationRaw || !shootRaw || !productName || !menuLine) {
		console.warn('[email-parser] 확정 메일 필수 필드 누락');
		return null;
	}

	const reservationDate = parseShootDateTime(reservationRaw);
	const shootDate = parseShootDateTime(shootRaw);
	const paymentAmount = parseAmount(menuLine);

	if (!reservationDate || !shootDate || paymentAmount === null) {
		console.warn('[email-parser] 확정 메일 파싱 실패 (datetime 또는 amount)');
		return null;
	}

	const requestNote =
		requestNoteRaw && requestNoteRaw !== '-' ? requestNoteRaw : null;

	const menuCleaned = cleanMenu(menuLine);

	return {
		booking_id: bookingId,
		customer_name: customerName,
		reservation_date: reservationDate,
		shoot_date: shootDate,
		product_name: productName,
		menu_cleaned: menuCleaned,
		payment_amount: paymentAmount,
		payment_method: paymentMethod || null,
		request_note: requestNote,
	};
}

/**
 * 취소 메일 본문 파싱.
 */
export function parseCancelEmail(body: string): ParsedCancelEmail | null {
	const customerNameRaw = extractField(body, '예약자명');
	const customerName = customerNameRaw?.replace(/님$/, '') ?? null;
	const bookingId = extractField(body, '예약번호');
	const cancelledRaw = extractField(body, '예약취소 일시');
	const refundLine = extractField(body, '환불금액');
	const reason = extractField(body, '취소사유');

	if (!bookingId || !customerName || !cancelledRaw || !refundLine) {
		console.warn('[email-parser] 취소 메일 필수 필드 누락');
		return null;
	}

	const cancelledAt = parseShootDateTime(cancelledRaw);
	const refundAmount = parseAmountLine(refundLine);

	if (!cancelledAt || refundAmount === null) {
		console.warn('[email-parser] 취소 메일 파싱 실패 (datetime 또는 amount)');
		return null;
	}

	return {
		booking_id: bookingId,
		customer_name: customerName,
		cancelled_at: cancelledAt,
		refund_amount: refundAmount,
		cancellation_reason: reason || null,
	};
}

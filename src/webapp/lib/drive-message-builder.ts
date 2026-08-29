/**
 * Phase 6-B Step 4: 원본/보정본 발송 문구 자동 생성.
 *
 * Drive 링크 처리 후 booking_details + products로 발송 문구를 만들어
 * ai_chat_messages에 system으로 INSERT.
 *
 * 데이터 누락 시 변수 부분만 플레이스홀더({고객명} 등)로 표시하고
 * has_placeholders=true로 metadata에 표시 → UI에서 노란 경고 표시.
 */

import { createProxyToken } from './proxy-link';

async function getProxySettings(db: D1Database): Promise<{ enabled: boolean; expiryDays: number }> {
	const rows = await db.prepare(
		`SELECT key, value FROM app_settings WHERE key IN ('proxy_link_enabled', 'proxy_link_expires_days')`,
	).all<{ key: string; value: string }>();
	const map: Record<string, string> = {};
	for (const r of rows.results ?? []) map[r.key] = r.value;
	return {
		enabled: map['proxy_link_enabled'] !== 'false',
		expiryDays: parseInt(map['proxy_link_expires_days'] ?? '60', 10) || 60,
	};
}

interface BookingRow {
	booking_id: string;
	customer_name: string | null;
	shoot_date: string | null;
	payment_amount: number | null;
	talk_id: string | null;
}

interface DetailRow {
	product_code: string;
	product_name: string;
	retouch_count: number;
	retouch_breakdown: string | null;
	frame_count: number;
	frame_size: string | null;
}

interface BuildContext {
	customer_name: string;
	total_retouch: number;
	total_frame: number;
	frame_size: string;
	has_placeholders: boolean;
	famCount: number;
	babyCount: number;
}

/**
 * 각 detail의 retouch_breakdown을 가족/아기 카테고리로 누적.
 * - breakdown 있으면: "가족1장,아기2장" 등 콤마 분리 후 분류
 * - breakdown 없으면: product_name으로 분류 ("가족" / "아기" 포함)
 * - 둘 다 매칭 안 되는 것은 기타 — breakdown 표시에서 제외
 */
function classifyRetouch(details: DetailRow[]): {
	famCount: number;
	babyCount: number;
} {
	let famCount = 0;
	let babyCount = 0;

	for (const d of details) {
		const count = d.retouch_count || 0;
		if (count <= 0) continue;

		const breakdown = d.retouch_breakdown?.trim();
		if (breakdown) {
			// "가족1장,아기2장" → 토큰 단위 분류
			const tokens = breakdown.split(',').map((t) => t.trim());
			for (const tok of tokens) {
				const m = tok.match(/(\d+)\s*장/);
				if (!m) continue;
				const n = parseInt(m[1], 10);
				if (tok.includes('가족')) famCount += n;
				else if (tok.includes('아기')) babyCount += n;
				// 그 외는 기타 — 누적 안 함
			}
			continue;
		}

		// breakdown 없으면 product_name 기반 분류 — 명확히 한 카테고리에만 속할 때만 누적
		const name = d.product_name || '';
		const hasFamily = name.includes('가족');
		const hasBaby = name.includes('아기');
		if (hasFamily && !hasBaby) {
			famCount += count;
		} else if (hasBaby && !hasFamily) {
			babyCount += count;
		}
		// 둘 다 포함(예: '가족+아기 패키지') 또는 둘 다 없음(만삭/대가족 등) → 기타로 처리하여 breakdown 표시 생략
	}

	return { famCount, babyCount };
}

async function gatherContext(
	db: D1Database,
	bookingId: string,
): Promise<BuildContext> {
	const booking = await db
		.prepare(
			`SELECT booking_id, customer_name, shoot_date, payment_amount, talk_id
			 FROM bookings WHERE booking_id = ?1`,
		)
		.bind(bookingId)
		.first<BookingRow>();

	const detailRows = await db
		.prepare(
			`SELECT p.product_code, p.product_name,
			        COALESCE(p.retouch_count, 0) AS retouch_count,
			        p.retouch_breakdown,
			        COALESCE(p.frame_count, 0) AS frame_count,
			        p.frame_size
			 FROM booking_details bd
			 JOIN products p ON bd.product_id = p.product_id
			 WHERE bd.booking_id = ?1
			 ORDER BY bd.id`,
		)
		.bind(bookingId)
		.all<DetailRow>();
	const details = detailRows.results || [];

	const totalRetouch = details.reduce((s, d) => s + (d.retouch_count || 0), 0);
	const totalFrame = details.reduce((s, d) => s + (d.frame_count || 0), 0);

	// frame_size: 후보들 중 문자열 정렬 내림차순 최댓값 (8x10 > 5x7)
	const frameSizes = details
		.map((d) => d.frame_size)
		.filter((s): s is string => s != null && s !== '');
	const frameSizeMax = frameSizes.sort().reverse()[0] || null;

	const customerName =
		booking?.customer_name && booking.customer_name.trim()
			? booking.customer_name
			: '';

	const hasPlaceholders =
		!customerName || totalRetouch === 0 || totalFrame === 0 || !frameSizeMax;

	const { famCount, babyCount } = classifyRetouch(details);

	return {
		customer_name: customerName || '{고객명}',
		total_retouch: totalRetouch,
		total_frame: totalFrame,
		frame_size: frameSizeMax || '{액자사이즈}',
		has_placeholders: hasPlaceholders,
		famCount,
		babyCount,
	};
}

function originalTemplate(ctx: BuildContext, driveLink: string): string {
	const retouchToken = ctx.total_retouch > 0 ? String(ctx.total_retouch) : '{보정장수}';
	const frameToken = ctx.total_frame > 0 ? String(ctx.total_frame) : '{액자개수}';

	// 카테고리가 둘 다 있으면 breakdown 표시, 한 종류만이면 단순 표시
	const hasBoth = ctx.famCount > 0 && ctx.babyCount > 0;
	const retouchLine = hasBoth
		? `* 보정 원하시는 사진 ${retouchToken}장(가족사진 ${ctx.famCount}장, 아기사진 ${ctx.babyCount}장)을 "파일명 뒷자리 숫자"로 말씀해주세요 ^^`
		: `* 보정 원하시는 사진 ${retouchToken}장을 "파일명 뒷자리 숫자"로 말씀해주세요 ^^`;

	return (
		`안녕하세요 마음껏스튜디오입니다😊\n` +
		`${ctx.customer_name}님 원본사진 링크 보내드립니다^^\n` +
		`아래 링크에서 파일 다운로드 받아 확인해보시면 됩니다!\n\n` +
		`${driveLink}\n\n` +
		`${retouchLine}\n` +
		`(그 중에서 ${ctx.frame_size} 원목액자 하실 사진 ${frameToken}개 표시해주세요)\n` +
		`* 사진 예쁘게 나오셔서 [인스타 업로드 동의 + 네이버 포토리뷰 작성시] 보정1장 추가와 액자로 선택하지 않은 사진도 5*7인치 사진 인화해드리니 참고해주세요`
	);
}

function retouchedTemplate(ctx: BuildContext, driveLink: string): string {
	return (
		`안녕하세요 ${ctx.customer_name}님 마음껏스튜디오입니다😊\n` + 
		`보정본은 아래 구글드라이브 링크에 넣어두었습니다 ^^\n` + 
		`추가 요청 있으시면 편하게 말씀해주세요!\n` + 
		`감사합니다 😊\n\n` +
		`${driveLink}\n\n` +
		`* 추가요청 없으시다면 택배 받으실 주소/연락처/성함부탁드립니다:)\n` +
		`* 문구 있는 사진과 없는 사진 올려드렸는데요, 액자하실 사진 말씀해주세요^^`
	);
}

async function insertSendMessage(
	db: D1Database,
	body: string,
	metadata: Record<string, unknown>,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
			 VALUES ('system', ?1, ?2, datetime('now'))`,
		)
		.bind(body, JSON.stringify(metadata))
		.run();
}

export async function buildOriginalSendMessage(
	db: D1Database,
	bookingId: string,
	driveLink: string,
	baseUrl?: string,
): Promise<void> {
	const ctx = await gatherContext(db, bookingId);
	const { enabled, expiryDays } = await getProxySettings(db);
	const useProxy = enabled && baseUrl && driveLink;
	const linkToUse = useProxy
		? await createProxyToken(db, driveLink, bookingId, 'original', expiryDays, baseUrl!)
		: driveLink || '{Drive링크}';
	const body = originalTemplate(ctx, linkToUse);
	await insertSendMessage(db, body, {
		type: 'drive_send_message',
		send_type: 'original',
		booking_id: bookingId,
		drive_link: driveLink,
		proxy_link: useProxy ? linkToUse : undefined,
		total_retouch: ctx.total_retouch,
		total_frame: ctx.total_frame,
		has_placeholders: ctx.has_placeholders,
	});
}

export async function buildRetouchedSendMessage(
	db: D1Database,
	bookingId: string,
	driveLink: string,
	baseUrl?: string,
): Promise<void> {
	const ctx = await gatherContext(db, bookingId);
	const { enabled, expiryDays } = await getProxySettings(db);
	const useProxy = enabled && baseUrl && driveLink;
	const linkToUse = useProxy
		? await createProxyToken(db, driveLink, bookingId, 'retouched', expiryDays, baseUrl!)
		: driveLink || '{Drive링크}';
	const body = retouchedTemplate(ctx, linkToUse);
	await insertSendMessage(db, body, {
		type: 'drive_send_message',
		send_type: 'retouched',
		booking_id: bookingId,
		drive_link: driveLink,
		proxy_link: useProxy ? linkToUse : undefined,
		total_retouch: ctx.total_retouch,
		total_frame: ctx.total_frame,
		has_placeholders: ctx.has_placeholders,
	});
}

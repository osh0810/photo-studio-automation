/**
 * Phase 6-B Drive 연동 Step 2: 폴더명 파서 + booking 매칭.
 *
 * 입력 예시: "20250501 홍길동님(클래식가족,클래식아기,누드,백일)"
 * 순수 함수(parseFolderName/detectLinkType) + DB 매칭(matchBookingByFolderName).
 */

export type DriveLinkType = 'original' | 'retouched' | 'unknown';

export interface ParsedFolderName {
	date: string; // "YYYY-MM-DD"
	customerName: string;
	products: string[];
	memo: string[];
}

/**
 * 현재 폴더명이 "원본" 또는 "보정본" 포함하는지 판단.
 */
export function detectLinkType(folderName: string): DriveLinkType {
	if (!folderName) return 'unknown';
	const trimmed = folderName.trim();
	if (trimmed === '원본') return 'original';
	if (trimmed.includes('보정본')) return 'retouched';
	return 'unknown';
}

/**
 * 텍스트에서 최상위 (...) 그룹들을 순서대로 추출 (중첩 괄호 보존).
 * 예: "(a)(b,c(d))" → ["a", "b,c(d)"]
 */
function extractParenGroups(text: string): string[] {
	const groups: string[] = [];
	let depth = 0;
	let start = -1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '(') {
			if (depth === 0) start = i + 1;
			depth++;
		} else if (ch === ')') {
			if (depth > 0) {
				depth--;
				if (depth === 0 && start >= 0) {
					groups.push(text.slice(start, i));
					start = -1;
				}
			}
			// depth가 이미 0인데 ')'가 나오면 무시 (잘못된 괄호)
		}
	}
	return groups;
}

/**
 * 최상위 콤마 기준으로만 split (중첩 괄호 안 콤마는 보존).
 * 예: "a,b(c,d),e" → ["a", "b(c,d)", "e"]
 */
function splitTopLevelComma(text: string): string[] {
	const result: string[] = [];
	let depth = 0;
	let buf = '';
	for (const ch of text) {
		if (ch === '(') {
			depth++;
			buf += ch;
		} else if (ch === ')') {
			if (depth > 0) depth--;
			buf += ch;
		} else if (ch === ',' && depth === 0) {
			result.push(buf.trim());
			buf = '';
		} else {
			buf += ch;
		}
	}
	if (buf.trim()) result.push(buf.trim());
	return result.filter((s) => s.length > 0);
}

/**
 * "20250501 홍길동님(클래식가족,클래식아기)" → 구조화.
 * 형식 불일치 시 null.
 *
 * - 날짜: 앞부분 yyyyMMdd 8자리 → yyyy-MM-dd
 * - 고객명: 날짜 다음 "님" 직전까지 한글/영문/공백
 * - 괄호 그룹 처리:
 *   · 1개면 그게 products
 *   · 2개 이상이면 마지막이 products, 나머지는 memo
 * - products는 최상위 콤마 기준으로 분리 (상품 내부 괄호 보존)
 */
export function parseFolderName(folderName: string): ParsedFolderName | null {
	if (!folderName) return null;
	const m = folderName
		.trim()
		.normalize('NFC')
		.match(/^(\d{4})(\d{2})(\d{2})\s+([가-힣A-Za-z][가-힣A-Za-z\s*]{0,20}?)님\s*([\s\S]*)$/);
	if (!m) return null;

	const [, y, mo, d, name, rest] = m;
	const groups = extractParenGroups(rest);

	let products: string[] = [];
	let memo: string[] = [];
	if (groups.length > 0) {
		const last = groups[groups.length - 1];
		products = splitTopLevelComma(last);
		memo = groups
			.slice(0, -1)
			.map((g) => g.trim())
			.filter((g) => g.length > 0);
	}

	return {
		date: `${y}-${mo}-${d}`,
		customerName: name.trim(),
		products,
		memo,
	};
}

/**
 * 단순 휴리스틱: 파일명에서 첫 한글 2~5자를 고객명으로 추정.
 * "20250501_홍길동_원본.zip" → "홍길동". 매칭 없으면 null.
 */
export function extractCustomerNameFromFilename(
	filename: string,
): string | null {
	if (!filename) return null;
	// NFD로 분해된 한글(ㄱ+ㅏ+ㄴ... 형태)을 NFC 완성형으로 변환 후 매칭
	const m = filename.normalize('NFC').match(/[가-힣]{2,5}/);
	if (!m) return null;
	return m[0].replace(/님$/, '');
}

function normalizeName(s: string): string {
	return s.replace(/\s+/g, '').toLowerCase();
}

interface BookingRow {
	booking_id: string;
	customer_name: string;
	shoot_date: string | null;
	talk_id: string | null;
	cancelled: number;
	original_folder_url: string | null;
	retouched_folder_url: string | null;
	talk_customer_name?: string | null;
}

export interface MatchResult {
	booking: BookingRow | null;
	reason: '날짜+이름 일치' | '매칭 없음' | '마스킹으로 제외' | '날짜 일치 없음';
}

/**
 * parsed.date의 shoot_date를 가진 booking 중 customer_name이 일치하는 것 찾기.
 * - 마스킹된(*) customer_name은 매칭 제외 ('마스킹으로 제외' 사유 반환)
 * - 비교는 공백/대소문자 무시
 */
export async function matchBookingByFolderName(
	db: D1Database,
	parsed: ParsedFolderName,
): Promise<MatchResult> {
	const result = await db
		.prepare(
			`SELECT b.booking_id, b.customer_name, b.shoot_date, b.talk_id, b.cancelled,
			        b.original_folder_url, b.retouched_folder_url,
			        c.customer_name AS talk_customer_name
			 FROM bookings b
			 LEFT JOIN customers c ON b.talk_id = c.talk_id
			 WHERE date(b.shoot_date) = ?1
			   AND b.cancelled = 0`,
		)
		.bind(parsed.date)
		.all<BookingRow>();

	const rows = result.results || [];
	if (rows.length === 0) {
		return { booking: null, reason: '날짜 일치 없음' };
	}

	const target = normalizeName(parsed.customerName);
	const fullNameOnly = rows.filter(
		(r) => r.customer_name && !r.customer_name.includes('*'),
	);

	if (fullNameOnly.length === 0) {
		return { booking: null, reason: '마스킹으로 제외' };
	}

	const match = fullNameOnly.find(
		(r) => normalizeName(r.customer_name) === target,
	);
	if (!match) {
		return { booking: null, reason: '매칭 없음' };
	}
	return { booking: match, reason: '날짜+이름 일치' };
}

/**
 * Drive 폴더 URL에서 folderId 추출.
 * ?usp=sharing 등 쿼리 파라미터는 제거 (방어적 처리).
 */
export function extractFolderIdFromUrl(url: string): string | null {
	const m = url.match(/drive\/folders\/([a-zA-Z0-9_-]+)/);
	if (!m) return null;
	return m[1].split('?')[0];
}

// ─── Phase 6-B Step 3: 현장 추가 상품 매칭 ────────────────────────────

export interface NewProductMatch {
	product_id: number;
	product_code: string;
	product_name: string;
	matchedKeywords: string[];
}

export interface ProductMatchResult {
	alreadyCovered: string[];
	newProducts: NewProductMatch[];
	unmatched: string[];
}

/**
 * 폴더명 상품을 booking_details 기존 키워드와 비교하고, 남는 키워드는
 * 전체 products와 조합 매칭. 단어 분리는 공백 제거 후 '+' 기준.
 *
 * 우선순위:
 *   - 한 product가 더 많은 remaining을 한꺼번에 커버할수록 우선
 *   - 동률이면 단일 상품(product_code에 'PKG_' 없음) 우선
 */
export async function matchProductsFromFolder(
	db: D1Database,
	parsedProducts: string[],
	bookingId: string,
): Promise<ProductMatchResult> {
	const normalize = (s: string) => s.replace(/\s+/g, '');

	// Step 1: 기존 booking_details의 match_keyword 단어 모음
	const existingRows = await db
		.prepare(
			`SELECT p.match_keyword
			 FROM booking_details bd
			 JOIN products p ON bd.product_id = p.product_id
			 WHERE bd.booking_id = ?1`,
		)
		.bind(bookingId)
		.all<{ match_keyword: string | null }>();
	const existingWords: string[] = [];
	for (const r of existingRows.results || []) {
		if (!r.match_keyword) continue;
		const parts = normalize(r.match_keyword)
			.split('+')
			.filter((p) => p.length > 0);
		for (const p of parts) existingWords.push(p);
	}

	// Step 2: 폴더 키워드 정규화 + 기존에 커버된 것 분리
	const normalizedFolder = parsedProducts
		.map((p) => normalize(p))
		.filter((p) => p.length > 0);
	const alreadyCovered: string[] = [];
	let remaining: string[] = [];
	for (const folderKw of normalizedFolder) {
		const covered = existingWords.some((w) => w.includes(folderKw));
		if (covered) alreadyCovered.push(folderKw);
		else remaining.push(folderKw);
	}

	// Step 3: 전체 active products + keyword 분리. PKG 후순위 정렬.
	const productsResult = await db
		.prepare(
			`SELECT product_id, product_code, product_name, match_keyword
			 FROM products WHERE is_active = 1`,
		)
		.all<{
			product_id: number;
			product_code: string;
			product_name: string;
			match_keyword: string;
		}>();
	const productKeywords = (productsResult.results || []).map((p) => ({
		product_id: p.product_id,
		product_code: p.product_code,
		product_name: p.product_name,
		keywords: normalize(p.match_keyword)
			.split('+')
			.filter((k) => k.length > 0),
	}));
	const sortedProducts = productKeywords.slice().sort((a, b) => {
		const aPkg = a.product_code.startsWith('PKG_') ? 1 : 0;
		const bPkg = b.product_code.startsWith('PKG_') ? 1 : 0;
		return aPkg - bPkg; // 단일 상품 먼저
	});

	// Step 4: 조합 매칭 루프
	const newProducts: NewProductMatch[] = [];
	while (remaining.length > 0) {
		let best: (typeof sortedProducts)[number] | null = null;
		let bestCovers: string[] = [];
		for (const prod of sortedProducts) {
			const covers = remaining.filter((r) =>
				prod.keywords.some((k) => k.includes(r)),
			);
			// strict greater만 갱신 — 동률에선 앞에 있던(non-PKG) 항목 유지
			if (covers.length > bestCovers.length) {
				best = prod;
				bestCovers = covers;
			}
		}
		if (!best || bestCovers.length === 0) break;
		newProducts.push({
			product_id: best.product_id,
			product_code: best.product_code,
			product_name: best.product_name,
			matchedKeywords: bestCovers,
		});
		remaining = remaining.filter((r) => !bestCovers.includes(r));
	}

	return { alreadyCovered, newProducts, unmatched: remaining };
}

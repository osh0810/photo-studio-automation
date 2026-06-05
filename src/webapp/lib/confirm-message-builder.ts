/**
 * 확정문자 + 추가질문 메시지 생성 (Phase 4 Step 4-C).
 * 메일 도착 시 booking + booking_details + products + additional_questions 조합.
 */

export interface BookingDetailWithProduct {
	product_id: number | null;
	product_name: string | null;
	match_keyword: string | null;
	retouch_count: number;
	retouch_breakdown: string | null;
	frame_count: number;
	frame_size: string | null;
	extra_note: string | null;
	raw_text: string;
	match_status: 'matched' | 'unmatched' | 'manual';
}

export interface AdditionalQuestion {
	question_id: number;
	question_code: string;
	trigger_keyword: string;
	question_text: string;
}

// 안내사항 [D] — 하드코딩 (변경 시 클로드코드에게 수정 요청)
const GUIDE_TEXT = `★ 해당 시간은 단독 이용할 수 있도록 예약되었습니다. 당일 늦지 않게 도착해주세요 ^^ (15분 이상 늦을 시 촬영이 불가합니다)
★ 작가촬영 안내 (준비물/의상/헤어메이크업/보정 등)
https://maum.short.gy/photo
★주차안내
https://maum.short.gy/parking
★스튜디오 주소
경기 용인시 기흥구 흥덕중앙로 59 흥덕노블레스빌딩 9층 (엘베 내려서 좌측)

소중한 시간 되실 수 있도록 준비해 놓겠습니다♥ 부디 즐거운 시간 되시길 바랍니다^^`;

/**
 * shoot_date "2026-05-10 12:00:00" → "5월 10일(일) 오후 12시"
 */
export function formatShootDateForConfirm(sqliteDate: string): string {
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

/**
 * 확정문자 [C] 부분 라인 생성.
 * 매칭 실패 항목 있으면 [⚠️ 매칭실패] 표기, 합계는 matched만 계산.
 */
function buildDetailLines(details: BookingDetailWithProduct[]): string[] {
	const lines: string[] = [];

	// 1. 각 상품명 라인
	for (const d of details) {
		if (d.match_status === 'unmatched') {
			lines.push('- [⚠️ 매칭실패]');
		} else if (d.product_name) {
			lines.push(`- ${d.product_name}`);
		}
	}

	// 2. 원본파일 (공통)
	lines.push('- 원본파일 제공');

	const matched = details.filter((d) => d.match_status !== 'unmatched');

	// 3. 보정본 합계
	const totalRetouch = matched.reduce(
		(sum, d) => sum + (d.retouch_count || 0),
		0,
	);
	const breakdowns = matched
		.map((d) => d.retouch_breakdown)
		.filter((b): b is string => !!b);
	const breakdownStr = breakdowns.length > 0 ? `(${breakdowns.join(',')})` : '';
	lines.push(`- 보정파일 총 ${totalRetouch}장 제공${breakdownStr}`);

	// 4. 액자 합계
	const totalFrames = matched.reduce(
		(sum, d) => sum + (d.frame_count || 0),
		0,
	);
	const sizes = matched
		.filter((d) => d.frame_count > 0 && d.frame_size)
		.map((d) => d.frame_size as string);
	const uniqueSizes = [...new Set(sizes)];

	if (uniqueSizes.length === 0) {
		lines.push(`- 0개 액자 제공`);
	} else if (uniqueSizes.length === 1) {
		lines.push(`- ${uniqueSizes[0]} ${totalFrames}개 제공`);
	} else {
		lines.push(`- 액자 ${totalFrames}개 제공 (사이즈 혼합)`);
	}

	// 5. extra_note 라인들
	for (const d of matched) {
		if (d.extra_note) {
			lines.push(`- ${d.extra_note}`);
		}
	}

	return lines;
}

/**
 * 메인 확정문자 메시지 생성.
 */
export function buildConfirmMessage(
	customerName: string,
	bookingId: string,
	shootDate: string,
	details: BookingDetailWithProduct[],
): string {
	const dateLabel = formatShootDateForConfirm(shootDate);
	const detailLines = buildDetailLines(details);

	return `${customerName}님 아래 내용으로 예약 완료되셨습니다^^

- ${dateLabel}
${detailLines.join('\n')}

${GUIDE_TEXT}

예약번호 : ${bookingId}`;
}

/**
 * 추가질문 매칭 (공백 무시).
 * booking_details의 match_keyword에 trigger_keyword 포함 여부 검사.
 */
export function matchAdditionalQuestions(
	details: BookingDetailWithProduct[],
	questions: AdditionalQuestion[],
): AdditionalQuestion[] {
	const matchKeywords = details
		.filter((d) => d.match_keyword)
		.map((d) => (d.match_keyword as string).replace(/\s/g, ''));

	if (matchKeywords.length === 0) return [];

	const matched: AdditionalQuestion[] = [];
	const seenCodes = new Set<string>();

	for (const q of questions) {
		const trigger = q.trigger_keyword.replace(/\s/g, '');
		if (matchKeywords.some((mk) => mk.includes(trigger))) {
			if (!seenCodes.has(q.question_code)) {
				matched.push(q);
				seenCodes.add(q.question_code);
			}
		}
	}

	return matched;
}

/**
 * 추가질문 메시지 생성 (여러 개면 줄바꿈 묶음).
 */
export function buildAdditionalQuestionMessage(
	matched: AdditionalQuestion[],
): string | null {
	if (matched.length === 0) return null;
	return matched.map((q) => q.question_text).join('\n\n');
}

/**
 * Phase 4.5 Step 1: 톡톡 echo 확정문자 파싱.
 *
 * 작가님이 발송한 확정문자가 톡톡 echo로 다시 들어올 때
 * 예약번호 + 고객명을 추출해 booking ↔ talk_id 매칭에 사용한다.
 *
 * 톡톡 echo는 줄바꿈이 사라지고 한 줄로 들어오므로
 * 정규식은 메시지 전체 텍스트에 대해 적용한다.
 *
 * 순수 함수: DB/네트워크 호출 없음.
 */

export interface EchoParseResult {
	isConfirmEcho: boolean;
	bookingId?: string;
	customerName?: string;
	isMasked?: boolean;
}

// 고객명: 한글/영문/공백/별표 — 첫 글자는 한글/영문, 이후 1~15자
const CUSTOMER_RE =
	/^([가-힣A-Za-z][가-힣A-Za-z\s*]{1,15})님\s+아래\s+내용으로\s+예약\s+완료되셨습니다/;

// 예약번호: 10자리 숫자 또는 MANUAL_ prefix + 숫자, 콜론은 ASCII : 와 전각 ：둘 다 허용
const BOOKING_RE = /예약번호\s*[:：]\s*(MANUAL_\d+|\d{10})/;

export function parseEchoConfirmMessage(message: string): EchoParseResult {
	if (!message) return { isConfirmEcho: false };

	const trimmed = message.trim();

	const nameMatch = trimmed.match(CUSTOMER_RE);
	const bookingMatch = trimmed.match(BOOKING_RE);

	if (!nameMatch || !bookingMatch) {
		return { isConfirmEcho: false };
	}

	const customerName = nameMatch[1].trim();
	const bookingId = bookingMatch[1];

	return {
		isConfirmEcho: true,
		bookingId,
		customerName,
		isMasked: customerName.includes('*'),
	};
}

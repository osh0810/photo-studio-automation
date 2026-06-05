/**
 * Cloudflare Workers secrets. Wrangler가 생성한 `Cloudflare.Env`에 병합되어
 * 전역 `Env` 및 `ExportedHandler<Env>`에서 자동으로 참조된다.
 */
declare global {
	namespace Cloudflare {
		interface Env {
			ANTHROPIC_API_KEY: string;
			GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
			GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
			GOOGLE_SHEETS_ID: string;
			DISCORD_WEBHOOK_DAILY: string;
			DISCORD_WEBHOOK_PROCESSED: string;
			DISCORD_WEBHOOK_ERROR: string;
			NAVER_TALK_TOKEN: string;
			ADMIN_TOKEN: string;
			WEBHOOK_PATH_SECRET?: string;
			GOOGLE_OAUTH_CLIENT_ID: string;
			GOOGLE_OAUTH_CLIENT_SECRET: string;
			DB: D1Database;
			AI_CONTEXT_DAYS?: string;
			AI_CONTEXT_MAX_MESSAGES?: string;
			AI_DAILY_LIMIT?: string;
			CRON_BATCH_LIMIT?: string;
			ALLOWED_EMAIL?: string;
			VAPID_PUBLIC_KEY?: string;
			VAPID_PRIVATE_KEY?: string;
			VAPID_SUBJECT?: string;
			NAVER_BIZ_ID: string;
			CALENDAR_ID: string;
			TIMEZONE: string;
		}
	}
}

export type Env = Cloudflare.Env;

export enum AlertLevel {
	INFO = "INFO",
	WARNING = "WARNING",
	ERROR = "ERROR",
	CRITICAL = "CRITICAL",
}

export const ALERT_COLORS: Record<AlertLevel, number> = {
	[AlertLevel.INFO]: 0x3498db,
	[AlertLevel.WARNING]: 0xf1c40f,
	[AlertLevel.ERROR]: 0xe67e22,
	[AlertLevel.CRITICAL]: 0xe74c3c,
};

export enum CustomerStage {
	S0 = "S0",
	S1 = "S1",
	S2 = "S2",
	S3 = "S3",
	S4 = "S4",
	S5A = "S5a",
	S5B = "S5b",
	S6 = "S6",
	S7 = "S7",
}

/**
 * 시트·Discord 에 사람이 읽을 수 있게 표시하는 라벨. 내부 로직(분류 prompt,
 * 상태머신, retry 등)은 여전히 enum 코드 문자열(`"S1"`)만 쓴다 — 이 라벨은
 * 출력 경계(I/O)에서만 변환해서 쓴다.
 */
export const STAGE_LABELS: Record<CustomerStage, string> = {
	[CustomerStage.S0]: "S0 신규문의",
	[CustomerStage.S1]: "S1 촬영완료",
	[CustomerStage.S2]: "S2 원본발송",
	[CustomerStage.S3]: "S3 셀렉수신",
	[CustomerStage.S4]: "S4 보정발송",
	[CustomerStage.S5A]: "S5a 추가보정요청",
	[CustomerStage.S5B]: "S5b 추가보정없음",
	[CustomerStage.S6]: "S6 추가보정발송",
	[CustomerStage.S7]: "S7 액자발주",
};

export function formatStage(stage: CustomerStage): string {
	return STAGE_LABELS[stage] ?? stage;
}

const STAGE_CODES = new Set<string>(Object.values(CustomerStage));

/**
 * `"S1"`, `"S1 촬영완료"`, `"S5a 추가보정요청"` 모두 `S1` / `S5a` 로 복원.
 * 접두사만 떼서 enum 값과 대조하므로 한국어 라벨이 바뀌어도 읽기는 유지된다.
 * 매칭 실패 / 미등록 코드는 `null` — 호출 측이 빈 문자열로 떨어트림.
 */
export function parseStage(label: string): CustomerStage | null {
	if (!label) return null;
	const match = label.trim().match(/^(S\d+[a-z]?)/);
	if (!match) return null;
	const code = match[1];
	return STAGE_CODES.has(code) ? (code as CustomerStage) : null;
}

/**
 * 두 시트에서 공유되는 상태 문자열.
 *   - `_원본백업.처리상태` — webhook 처리 단계의 상태 (대기/처리완료/실패/검토필요/수동처리완료)
 *   - `고객목록.검토상태`  — 고객 단위 검토 상태. 액자누락 반자동 분기 시 "액자누락확인" 사용.
 *
 * "액자누락확인" 은 고객목록 전용 값이고 _원본백업에는 쓰이지 않는다 — 현재는 한 union 을
 * 공유하지만 관심사가 명확히 갈라지면 둘로 쪼개는 게 맞다 (follow-up 대상).
 */
export type ProcessingStatus =
	| "대기"
	| "처리완료"
	| "처리실패"
	| "검토필요"
	| "수동처리완료"
	| "액자누락확인";

/**
 * `고객목록` 시트 헤더. 배열 index가 컬럼 offset(A=0 … Y=24)이다.
 * 시트에 손을 대면 이 배열을 먼저 맞춰야 `Customer` ↔ row 변환이 깨지지 않는다.
 */
export const CUSTOMER_COLUMNS = [
	"고객ID",
	"고객명",
	"톡톡ID",
	"연락처",
	"상담채널",
	"예약채널",
	"촬영종류",
	"촬영일",
	"현재단계",
	"원본발송일",
	"셀렉수신일",
	"셀렉컷",
	"보정본발송일",
	"추가보정요청일",
	"추가보정내용",
	"추가보정본발송일",
	"액자주문여부",
	"액자발주일",
	"액자옵션",
	"비고",
	"마지막알림일",
	"알림일시정지",
	"검토상태",
	"등록일시",
	"최종수정일시",
] as const;

export type CustomerColumn = (typeof CUSTOMER_COLUMNS)[number];

export type Customer = {
	[K in CustomerColumn]: string;
} & {
	현재단계: CustomerStage | "";
	검토상태: ProcessingStatus | "";
};

export const BACKUP_COLUMNS = [
	"수신시각",
	"톡톡UserID",
	"톡톡UserName",
	"메시지타입",
	"메시지원문",
	"WebhookJSON",
	"처리상태",
	"처리시각",
	"매칭고객ID",
	"분류결과",
	"에러메시지",
	"메시지ID",
] as const;

export type BackupColumn = (typeof BACKUP_COLUMNS)[number];

export type BackupRow = {
	[K in BackupColumn]: string;
} & {
	처리상태: ProcessingStatus | "";
};

/**
 * 고객 메시지 분류 intent. 9개 (2026-04-24 개정).
 *
 *   셀렉전달          원본 중 선택한 컷 번호 전달
 *   재촬영요청        촬영 결과 전반 불만족 / 재촬영 요청
 *   원본누락          원본 중 일부가 안 왔다는 알림
 *   추가보정요청      이미 받은 보정본에 대해 추가 수정 요청 (셀렉추가/보정누락 포함)
 *   보정확정          보정본 OK, 추가 수정 없음 확정
 *   액자누락          액자 배송/전달 누락 신고
 *   일반수신확인      "받았어요"/"감사합니다" 같은 단순 수신 확인
 *   일반문의          주차/위치/준비물 등 운영 문의
 *   판단불가          근거 부족 / 맥락 모호
 *
 * 설계 노트: 예전엔 신규문의/일정변경/취소/액자옵션확정/원본수신확인/보정본수신확인 을
 * 별도 intent 로 뒀으나 실제 운영에서 구분 가치가 낮거나 인간 검토로 빠지는 게 자연스러워
 * 일반문의 / 판단불가 로 흡수했다. human_review_needed: true 로 띄우면 된다.
 */
export type MessageIntent =
	| "셀렉전달"
	| "재촬영요청"
	| "원본누락"
	| "추가보정요청"
	| "보정확정"
	| "액자누락"
	| "일반수신확인"
	| "일반문의"
	| "판단불가";

export type Confidence = "높음" | "중간" | "낮음";

export interface ClassificationResult {
	intent: MessageIntent;
	confidence: Confidence;
	stage_change: {
		from: string;
		to: string | null;
	};
	field_updates: {
		셀렉수신일?: string | null;
		셀렉컷?: string | null;
		추가보정요청일?: string | null;
		추가보정내용?: string | null;
		액자옵션?: string | null;
		비고추가?: string | null;
	};
	suggested_reply: string;
	human_review_needed: boolean;
	review_reason?: string;
}

// ─── _시스템로그 시트 ───────────────────────────────────────────────────

/**
 * `_시스템로그` 시트 헤더. 요구사항 명세서 §5.1 / Day0 가이드와 동일.
 * 시각/등급/종류/내용/관련고객ID 5컬럼 고정.
 */
export const SYSTEM_LOG_COLUMNS = [
	"시각",
	"등급",
	"종류",
	"내용",
	"관련고객ID",
] as const;

export type SystemLogColumn = (typeof SYSTEM_LOG_COLUMNS)[number];

/**
 * 현재 사용 중인 종류 enum. 새 종류를 추가할 때 문자열 리터럴을 늘려간다.
 * union 으로 닫아두면 오타 방지 가능.
 */
export type SystemLogKind = "talk_send";

export interface SystemLogEntry {
	등급: AlertLevel;
	종류: SystemLogKind;
	내용: string;
	관련고객ID?: string;
}

// ─── /admin/send-talk 요청 / 응답 ──────────────────────────────────────

export type TalkSendAction =
	| "원본발송"
	| "보정본발송"
	| "추가보정발송"
	| "액자발주";

export interface AdminSendTalkRequest {
	customerId: string;
	talkId: string;
	message: string;
	/** 프론트(Apps Script) 가 어떤 버튼을 눌렀는지 — 로그/알림용 메타데이터. */
	action?: TalkSendAction | string;
	/** 발송 성공 시 함께 업데이트할 고객목록 필드. 생략하면 시트 건드리지 않음. */
	updates?: Partial<Customer>;
}

export interface AdminSendTalkResponse {
	success: boolean;
	customerId?: string;
	action?: string;
	updatedFields?: string[];
	naverResponse?: unknown;
	/** 발송은 성공했지만 시트 업데이트만 실패한 경우의 경고 메시지. */
	warning?: string;
	failedFields?: string[];
	error?: string;
	detail?: string;
}

export interface ClassificationInput {
	customer: {
		고객명: string;
		고객ID: string;
		현재단계: CustomerStage;
		원본발송일?: string;
		셀렉수신일?: string;
		보정본발송일?: string;
		추가보정요청일?: string;
		비고?: string;
	} | null;
	message: {
		원문: string;
		수신시각: string;
		타입: "text" | "image" | "file" | "sticker";
	};
}

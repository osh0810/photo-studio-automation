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

export type ProcessingStatus =
	| "대기"
	| "처리완료"
	| "처리실패"
	| "검토필요"
	| "수동처리완료";

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

export type MessageIntent =
	| "셀렉전달"
	| "추가보정요청"
	| "보정확정"
	| "액자옵션확정"
	| "원본수신확인"
	| "보정본수신확인"
	| "신규문의"
	| "일정변경"
	| "취소"
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

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

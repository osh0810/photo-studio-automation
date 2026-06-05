/**
 * 일일 09:00 KST Cron 핸들러 (Phase 2).
 *
 * Cloudflare `scheduled` 이벤트에서 호출되거나, 디버깅용 `GET /test/cron`
 * 라우트에서 동기적으로 호출된다. 두 진입점이 같은 `runDailyAlert` 를 쓴다 —
 * 전자는 반환값을 버리고 후자는 JSON 으로 돌려줘서 로컬 검증을 쉽게 한다.
 *
 * 실패 정책:
 *   - 고객 조회 / Discord 전송 같은 외부 API 는 `withRetry` 로 3회까지 재시도.
 *   - 어느 단계에서든 에러가 터지면 `DISCORD_WEBHOOK_ERROR` 로 CRITICAL 알림.
 *     실패 단계 태그(`"고객 조회"` / `"Discord 전송"` 등) 를 제목에 박아
 *     알림만 보고도 어디서 터졌는지 알게 한다.
 *   - `scheduled` 에서 throw 하면 Cloudflare 가 실패로 기록하므로, 운영 히스토리는
 *     Discord 에러 채널 + Cloudflare 대시보드 둘 다에서 추적 가능.
 */

import {
	evaluateCustomer,
	formatDailyReport,
	formatErrorAlert,
	type AlertItem,
	type DailyAlertLevel,
} from "../lib/alerts";
import { withRetry } from "../lib/retry";
import { sendDiscordAlert } from "../services/discord";
import { listAllActiveCustomers } from "../services/sheets";
import { AlertLevel, type Customer, type Env } from "../types";

export interface DailyAlertResult {
	ok: boolean;
	alerts: Record<DailyAlertLevel, number>;
	todayShootings: number;
	title?: string;
	message?: string;
	error?: string;
	failedStage?: string;
}

/** KST 기준 오늘 00:00 Date (UTC epoch 로 저장). */
function todayKst(): Date {
	const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
	return new Date(
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
	);
}

/** 고객의 `촬영일` 이 오늘(KST)인지. */
function isShootingToday(customer: Customer, today: Date): boolean {
	const raw = customer.촬영일?.trim();
	if (!raw) return false;
	const m = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
	if (!m) return false;
	const ms = Date.UTC(
		parseInt(m[1], 10),
		parseInt(m[2], 10) - 1,
		parseInt(m[3], 10),
	);
	return ms === today.getTime();
}

function zeroCounts(): Record<DailyAlertLevel, number> {
	return { 긴급: 0, 일반: 0, 확인필요: 0 };
}

/**
 * 일일 알림 파이프라인 — scheduled / 테스트 라우트 공용.
 * 성공 시: `ok: true` + 카운트. 실패 시: `ok: false` + 에러 알림 전송 완료.
 * 함수 자체는 throw 하지 않는다 — 호출 측(scheduled / fetch) 이 상황에 맞게 판단.
 */
export async function runDailyAlert(env: Env): Promise<DailyAlertResult> {
	const today = todayKst();

	let customers: Awaited<ReturnType<typeof listAllActiveCustomers>>;
	try {
		customers = await withRetry(() => listAllActiveCustomers(env));
	} catch (err) {
		await reportFailure(env, "고객 조회", err);
		return {
			ok: false,
			alerts: zeroCounts(),
			todayShootings: 0,
			failedStage: "고객 조회",
			error: errMessage(err),
		};
	}

	const items: AlertItem[] = [];
	const todayShootings: Customer[] = [];
	try {
		for (const { data } of customers) {
			const item = evaluateCustomer(data, today);
			if (item) items.push(item);
			if (isShootingToday(data, today)) todayShootings.push(data);
		}
	} catch (err) {
		await reportFailure(env, "알림 평가", err);
		return {
			ok: false,
			alerts: zeroCounts(),
			todayShootings: 0,
			failedStage: "알림 평가",
			error: errMessage(err),
		};
	}

	const { title, content } = formatDailyReport(items, today, todayShootings);

	try {
		await withRetry(() =>
			sendDiscordAlert(env.DISCORD_WEBHOOK_DAILY, AlertLevel.INFO, title, content),
		);
	} catch (err) {
		await reportFailure(env, "Discord 전송", err);
		return {
			ok: false,
			alerts: countByLevel(items),
			todayShootings: todayShootings.length,
			failedStage: "Discord 전송",
			error: errMessage(err),
		};
	}

	return {
		ok: true,
		alerts: countByLevel(items),
		todayShootings: todayShootings.length,
		title,
		message: content,
	};
}

/**
 * Cloudflare `scheduled` 이벤트 핸들러.
 * `ctx.waitUntil` 로 감싸서 호출하는 쪽이 백그라운드 실행을 보장한다.
 * 현재 시그니처는 `ScheduledController` 만 받지만, 향후 `event.scheduledTime`
 * 같은 값이 필요하면 이 함수 안에서 꺼내면 된다.
 */
export async function handleScheduledAlert(
	_event: ScheduledController,
	env: Env,
	_ctx: ExecutionContext,
): Promise<void> {
	const result = await runDailyAlert(env);
	if (!result.ok) {
		// 실패 알림은 runDailyAlert 내부에서 이미 보냈으므로, 여기선 로그만.
		console.error(
			`[cron] daily alert failed at ${result.failedStage}: ${result.error}`,
		);
	}

	// Phase 7 Step 1: D1 기반 아침 점검 리포트 — 기존 시트 알림과 격리된 try/catch
	try {
		const { runMorningReport } = await import('../webapp/lib/morning-report');
		await runMorningReport(env as any);
	} catch (err) {
		console.error('[cron] morning report failed:', err);
	}
}

function countByLevel(items: AlertItem[]): Record<DailyAlertLevel, number> {
	const out = zeroCounts();
	for (const i of items) out[i.level]++;
	return out;
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function reportFailure(env: Env, stage: string, err: unknown): Promise<void> {
	const { title, content } = formatErrorAlert(`일일 Cron - ${stage}`, err, null);
	try {
		await sendDiscordAlert(
			env.DISCORD_WEBHOOK_ERROR,
			AlertLevel.CRITICAL,
			title,
			content,
		);
	} catch (discordErr) {
		console.error("[cron] error-webhook 전송도 실패:", discordErr);
	}
}

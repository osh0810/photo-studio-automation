/**
 * 외부 API 호출용 지수 백오프 재시도.
 *
 * 재시도 가능: 5xx, 429, 네트워크/타임아웃 (fetch가 던지는 TypeError 등).
 * 재시도 불가: 4xx 중 401/403/400 같은 클라이언트 오류 — 즉시 throw.
 *
 * sheets.ts / classifier.ts 가 던지는 SheetsApiError, ClassifierApiError 는
 * `status` 필드를 노출하므로 그걸로 분기한다. 이름으로 의존하지 않으려고
 * duck typing(`'status' in err`).
 */

export interface RetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	/** 호출자가 직접 재시도 정책을 덮어쓰고 싶을 때. */
	isRetryable?: (err: unknown) => boolean;
}

const DEFAULTS = {
	maxAttempts: 3,
	baseDelayMs: 1000,
	maxDelayMs: 8000,
} as const;

function defaultIsRetryable(err: unknown): boolean {
	if (err && typeof err === "object" && "status" in err) {
		const status = (err as { status: unknown }).status;
		if (typeof status === "number") {
			if (status === 429) return true;
			if (status >= 500 && status < 600) return true;
			return false;
		}
	}
	// status 가 없으면 네트워크/타임아웃류로 간주 — 재시도.
	return true;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
	const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
	const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
	const isRetryable = options.isRetryable ?? defaultIsRetryable;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt === maxAttempts || !isRetryable(err)) throw err;
			const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
			await sleep(delay);
		}
	}
	throw lastError;
}

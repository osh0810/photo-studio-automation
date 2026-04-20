/**
 * 메시지ID 기반 중복 처리 방지 (in-memory).
 *
 * Workers isolate 단위로 캐시가 살아있다 — 같은 isolate가 같은 webhook을
 * 재수신하는 케이스(네이버의 즉시 재전송)는 막지만, 다른 isolate에서는
 * 못 막는다. 그래도 첫 방어선으로는 충분. 더 강한 보장이 필요해지면
 * Cloudflare KV로 백엔드만 갈아끼우면 되도록 인터페이스를 좁게 유지한다.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map<string, number>();

/** 매 호출마다 만료된 항목을 제거한다. Map 크기를 무한정 키우지 않으려는 lazy GC. */
function sweepExpired(now: number): void {
	for (const [id, expiresAt] of cache) {
		if (expiresAt <= now) cache.delete(id);
	}
}

export function isDuplicate(messageId: string): boolean {
	if (!messageId) return false;
	const now = Date.now();
	const expiresAt = cache.get(messageId);
	if (expiresAt === undefined) return false;
	if (expiresAt <= now) {
		cache.delete(messageId);
		return false;
	}
	return true;
}

export function markProcessed(
	messageId: string,
	ttlMs: number = DEFAULT_TTL_MS,
): void {
	if (!messageId) return;
	const now = Date.now();
	sweepExpired(now);
	cache.set(messageId, now + ttlMs);
}

/** 테스트 / 수동 디버깅용. 프로덕션 경로에서는 호출하지 않는다. */
export function __resetDedupCache(): void {
	cache.clear();
}

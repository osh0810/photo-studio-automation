/**
 * 로컬 테스트용 — /admin/send-talk 엔드포인트를 직접 호출한다.
 *
 * 실행:
 *   1) 별도 터미널에서 `npm run dev` (로컬 워커 뜸, 기본 포트 8787).
 *   2) .dev.vars 에 ADMIN_TOKEN=<토큰> 을 먼저 설정.
 *   3) 이 스크립트 실행.
 *
 * 사용 예:
 *   # 정상 케이스 (실제 네이버 API까지 호출됨 — 주의!)
 *   tsx scripts/test-send-talk.ts
 *
 *   # --dry: Worker 까지만 도달하고 네이버 호출 직전에 멈추게 하려면
 *   # 이 스크립트가 /admin/send-talk 로 보내는 게 아니라 페이로드만 콘솔 출력.
 *   tsx scripts/test-send-talk.ts --dry
 *
 *   # 시나리오 선택
 *   tsx scripts/test-send-talk.ts --scenario=auth-fail
 *   tsx scripts/test-send-talk.ts --scenario=missing-field
 *   tsx scripts/test-send-talk.ts --scenario=ok
 *
 * 시나리오:
 *   ok             — 정상 (기본값). 실제 네이버 API 로 발송됨.
 *   auth-fail      — Authorization 토큰 틀린 경우 (401 기대).
 *   missing-field  — talkId 누락 (400 기대).
 *   dry            — 페이로드만 출력하고 실제 호출은 안 함.
 */

import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(process.cwd(), ".dev.vars") });

const WORKER_URL =
	process.env.TEST_WORKER_URL ?? "http://127.0.0.1:8787/admin/send-talk";

type Scenario = "ok" | "auth-fail" | "missing-field";

function parseArgs(): { scenario: Scenario; dry: boolean } {
	let scenario: Scenario = "ok";
	let dry = false;
	for (const arg of process.argv.slice(2)) {
		if (arg === "--dry") dry = true;
		else if (arg.startsWith("--scenario=")) {
			const v = arg.slice("--scenario=".length);
			if (v === "ok" || v === "auth-fail" || v === "missing-field") {
				scenario = v;
			} else {
				console.error(`알 수 없는 시나리오: ${v}`);
				process.exit(1);
			}
		}
	}
	return { scenario, dry };
}

function buildRequest(scenario: Scenario): {
	token: string;
	body: Record<string, unknown>;
} {
	const realToken = process.env.ADMIN_TOKEN ?? "";
	const base = {
		customerId: "2026-001",
		talkId: "aP76n4SBpbIIgAC8ZAqM9Q",
		message:
			"안녕하세요 허희정님, 원본 사진 링크 전달드립니다. 확인 후 셀렉 주시면 감사하겠습니다.",
		action: "원본발송",
		updates: {
			현재단계: "S2",
			원본발송일: "2026-04-24",
		},
	};

	switch (scenario) {
		case "auth-fail":
			return { token: "wrong-token-for-test", body: base };
		case "missing-field":
			return {
				token: realToken,
				body: { ...base, talkId: undefined },
			};
		case "ok":
		default:
			return { token: realToken, body: base };
	}
}

async function main(): Promise<void> {
	const { scenario, dry } = parseArgs();
	const { token, body } = buildRequest(scenario);

	console.log("─".repeat(60));
	console.log(`시나리오: ${scenario}${dry ? " (dry-run)" : ""}`);
	console.log(`URL: ${WORKER_URL}`);
	console.log("페이로드:");
	console.log(JSON.stringify(body, null, 2));
	console.log("─".repeat(60));

	if (dry) {
		console.log("⚪ --dry 지정됨. 실제 호출은 하지 않음.");
		return;
	}

	if (!token) {
		console.error(
			"❌ ADMIN_TOKEN 이 비어있습니다 (.dev.vars 확인 또는 --scenario=auth-fail 사용).",
		);
		process.exit(1);
	}

	let res: Response;
	try {
		res = await fetch(WORKER_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: token,
			},
			body: JSON.stringify(body),
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error(
			`❌ fetch 실패: ${reason}\n   (npm run dev 로 로컬 워커가 떠있는지 확인)`,
		);
		process.exit(1);
	}

	const text = await res.text();
	console.log(`HTTP ${res.status}`);
	try {
		console.log(JSON.stringify(JSON.parse(text), null, 2));
	} catch {
		console.log(text);
	}
}

main().catch((err) => {
	console.error("치명적 오류:", err);
	process.exit(1);
});

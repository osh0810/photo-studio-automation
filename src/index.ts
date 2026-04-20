import { handleScheduledAlert, runDailyAlert } from "./handlers/cron";
import { handleWebhook } from "./handlers/webhook";
import type { RawWebhookPayload } from "./services/backup";

/**
 * Cloudflare Worker 엔트리.
 *   POST /webhook/talk       → 네이버 톡톡 webhook (실 운영)
 *   GET  /health             → 헬스체크
 *   GET  /test/webhook?case= → 가짜 payload 로 handleWebhook 호출 (디버깅)
 *   GET  /test/cron          → 일일 Cron 즉시 실행 + JSON 결과 반환 (디버깅)
 *   그 외                    → 404
 *
 * `scheduled` 트리거(UTC 00:00 = KST 09:00) 는 handleScheduledAlert 를 호출.
 */
export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/webhook/talk" && request.method === "POST") {
			return handleWebhook(request, env);
		}

		if (url.pathname === "/health" && request.method === "GET") {
			return new Response("OK", { status: 200 });
		}

		if (url.pathname === "/test/webhook" && request.method === "GET") {
			return runTestScenario(url, env);
		}

		if (url.pathname === "/test/cron" && request.method === "GET") {
			const result = await runDailyAlert(env);
			return new Response(JSON.stringify(result, null, 2), {
				status: result.ok ? 200 : 500,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		return new Response("Not Found", { status: 404 });
	},
	async scheduled(event, env, ctx): Promise<void> {
		ctx.waitUntil(handleScheduledAlert(event, env, ctx));
	},
} satisfies ExportedHandler<Env>;

/** 디버깅용 — `/test/webhook?case=N` 로 호출하면 가짜 payload 를 만들어 실제 핸들러에 주입. */
async function runTestScenario(url: URL, env: Env): Promise<Response> {
	const caseParam = url.searchParams.get("case") ?? "1";
	let payload: RawWebhookPayload;
	try {
		payload = buildScenario(caseParam);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return new Response(
			`Invalid case: ${reason}\nusage: /test/webhook?case=1|2|3|4|5|duplicate\n`,
			{ status: 400 },
		);
	}

	const fakeRequest = new Request("https://internal/test/webhook/talk", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	return handleWebhook(fakeRequest, env);
}

/**
 * 시나리오마다 `user.id` 는 시트에 미리 등록된 톡톡ID 를 가정한다 — 실제
 * 테스트 시에는 자기 시트에 맞춰 아래 ID 들을 바꾸거나, 해당 고객을 먼저
 * 등록해 둬야 한다. `case=duplicate` 만 고정 messageId 를 사용해서 같은
 * 호출을 두 번 하면 두 번째가 dedup 에 걸리는지 확인할 수 있다.
 */
function buildScenario(caseParam: string): RawWebhookPayload {
	const now = Date.now();
	const freshId = `test-msg-${caseParam}-${now}`;

	switch (caseParam) {
		case "1":
			return {
				user: { id: "tid_existing_kimmijin", name: "김미진" },
				message: {
					id: freshId,
					text: "셀렉 전달드립니다. 3, 7, 12, 15, 21번 골랐어요.",
					type: "text",
				},
				timestamp: now,
			};
		case "2":
			return {
				user: { id: "tid_existing_kimmijin", name: "김미진" },
				message: {
					id: freshId,
					text: "7번 사진 얼굴이 조금 어두운 것 같아요. 좀 더 밝게 해주실 수 있을까요?",
					type: "text",
				},
				timestamp: now,
			};
		case "3":
			return {
				user: { id: "tid_existing_kimmijin", name: "김미진" },
				message: {
					id: freshId,
					text: "보정본 너무 마음에 들어요. 이대로 확정할게요!",
					type: "text",
				},
				timestamp: now,
			};
		case "4":
			return {
				user: { id: "tid_existing_jsa", name: "정수아" },
				message: {
					id: freshId,
					text: "그건 좀 어떻게 해야 할지... 일단 나중에 다시 말씀드릴게요",
					type: "text",
				},
				timestamp: now,
			};
		case "5":
			return {
				user: { id: `tid_new_${now}`, name: "홍길동" },
				message: {
					id: freshId,
					text: "안녕하세요, 가족사진 예약 문의드려요. 이번 주말 촬영 가능한가요?",
					type: "text",
				},
				timestamp: now,
			};
		case "duplicate":
			return {
				user: { id: "tid_existing_kimmijin", name: "김미진" },
				message: {
					id: "test-msg-duplicate-fixed",
					text: "dedup 검증용 메시지",
					type: "text",
				},
				timestamp: now,
			};
		default:
			throw new Error(`unknown case "${caseParam}"`);
	}
}

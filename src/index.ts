import { handleAdminSendTalk } from "./handlers/admin-send-talk";
import { handleScheduledAlert, runDailyAlert } from "./handlers/cron";
import { handleWebhook } from "./handlers/webhook";
import type { RawWebhookPayload } from "./services/backup";

/**
 * Cloudflare Worker 엔트리.
 *   POST /webhook/talk       → 네이버 톡톡 webhook (실 운영)
 *   POST /admin/send-talk    → Apps Script 관리자용 톡톡 발송 API (Bearer: ADMIN_TOKEN)
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

		if (url.pathname === "/admin/send-talk" && request.method === "POST") {
			return handleAdminSendTalk(request, env);
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
			`Invalid case: ${reason}\nusage: /test/webhook?case=1|2|3|4|5|6|7|8|9|10|ambiguous|duplicate\n`,
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
 * 시나리오마다 `user` 는 시트에 미리 등록된 톡톡ID 를 가정한다 — 실제
 * 테스트 시에는 자기 시트에 맞춰 아래 ID 들을 바꾸거나, 해당 고객을 먼저
 * 등록해 둬야 한다. `case=duplicate` 만 고정 messageId 를 사용해서 같은
 * 호출을 두 번 하면 두 번째가 dedup 에 걸리는지 확인할 수 있다.
 *
 * 네이버 톡톡 파트너 webhook 실제 shape 기준:
 *   { event, user: string, messageId, textContent: { text, inputType }, options }
 */
function buildScenario(caseParam: string): RawWebhookPayload {
	const now = Date.now();
	const freshId = now; // messageId 는 실제로 number 로 옴

	const send = (user: string, text: string, messageId: string | number): RawWebhookPayload => ({
		event: "send",
		user,
		messageId,
		textContent: { text, inputType: "typing" },
		options: { mobile: true },
	});

	switch (caseParam) {
		// ── 기존 회귀 케이스 ─────────────────────────────────────────
		case "1":
			// S2 → S3 (셀렉전달). 시트에 tid_existing_kimmijin 을 현재단계=S2 로 세팅해둘 것.
			return send(
				"tid_existing_kimmijin",
				"셀렉 전달드립니다. 3, 7, 12, 15, 21번 골랐어요.",
				freshId,
			);
		case "2":
			// S4 → S5a (일반 추가보정요청). 시트에 tid_existing_kimmijin 을 현재단계=S4 로 바꿔두거나
			// 별도 S4 고객을 만들어 톡톡ID 를 여기 맞춰도 됨.
			return send(
				"tid_existing_kimmijin",
				"7번 사진 얼굴이 조금 어두운 것 같아요. 좀 더 밝게 해주실 수 있을까요?",
				freshId,
			);
		case "3":
			// S4 → S5b (보정확정).
			return send(
				"tid_existing_kimmijin",
				"보정본 너무 마음에 들어요. 이대로 확정할게요!",
				freshId,
			);
		case "4":
			// 모호 메시지 — 기존엔 human_review_needed 테스트였음. "ambiguous" 케이스와 중복이라
			// 유지만 함 (회귀 방지).
			return send(
				"tid_existing_jsa",
				"그건 좀 어떻게 해야 할지... 일단 나중에 다시 말씀드릴게요",
				freshId,
			);
		case "5":
			// 신규 고객 — handleNewCustomer 경로.
			return send(
				`tid_new_${now}`,
				"안녕하세요, 가족사진 예약 문의드려요. 이번 주말 촬영 가능한가요?",
				freshId,
			);

		// ── 신규: 역방향 / 루프 / 반자동 ─────────────────────────────
		case "6":
			// S2 → S1 (원본누락). tid_existing_s2 는 현재단계 S2 로 사전 세팅.
			return send(
				"tid_existing_s2",
				"초반에 찍은 컷들이 빠진거같아요",
				freshId,
			);
		case "7":
			// S3 → S2 (재촬영요청). tid_existing_s3 는 현재단계 S3 로 사전 세팅.
			return send(
				"tid_existing_s3",
				"아기가 너무 울어서 마음에 드는 사진이 없어요, 재촬영 가능할까요",
				freshId,
			);
		case "8":
			// S5b → S5a (번복). tid_existing_s5b 는 현재단계 S5b 로 사전 세팅.
			return send(
				"tid_existing_s5b",
				"아 이 사진도 수정해주세요",
				freshId,
			);
		case "9":
			// S6 → S5a (루프, [N차] 누적). tid_existing_s6 는 현재단계 S6 +
			// 추가보정내용="독사진 밝기" 등 기존 값 세팅해 두면 누적 동작 확인 가능.
			return send(
				"tid_existing_s6",
				"눈가도 조금 더 자연스럽게",
				freshId,
			);
		case "10":
			// S7 → S6 반자동 (액자누락). tid_existing_s7 는 현재단계 S7 로 사전 세팅.
			// 단계는 S7 유지, 비고 auto-append, 검토상태=액자누락확인, #긴급에러 알림.
			return send(
				"tid_existing_s7",
				"이 사진 액자 안왔어요",
				freshId,
			);
		case "ambiguous":
			// 모호 메시지 — confidence=낮음 + review=true 경로 확인.
			return send(
				"tid_existing_kimmijin",
				"사진이 좀 이상한 것 같아요",
				freshId,
			);

		case "duplicate":
			return send(
				"tid_existing_kimmijin",
				"dedup 검증용 메시지",
				"test-msg-duplicate-fixed",
			);
		default:
			throw new Error(`unknown case "${caseParam}"`);
	}
}

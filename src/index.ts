import { handleAdminSendTalk } from "./handlers/admin-send-talk";
import { handleScheduledAlert, runDailyAlert } from "./handlers/cron";
import { handleWebhook } from "./handlers/webhook";
import type { RawWebhookPayload } from "./services/backup";
import { handleWebappRequest } from './webapp/router';
import { handleScheduled } from './webapp/lib/cron-handler';  // ⭐ Phase 3
import { getValidAccessToken, getTokenStatus } from './webapp/lib/google-tokens';  // ⭐ Phase 4
import { sendKakaoMessage } from './webapp/lib/kakao-client';  // ⭐ 카카오
import { listMessages, getMessage, getHeader, extractPlainBody } from './webapp/lib/gmail-client';  // ⭐ Phase 4 Step 3
import { detectEmailType, parseConfirmEmail, parseCancelEmail } from './webapp/lib/email-parser';
import { processEmail } from './webapp/lib/email-processor';  // ⭐ Phase 4 Step 4-A
import { handleScheduledEmail } from './webapp/lib/cron-email';  // ⭐ Phase 4 Step 5
import { parseEchoConfirmMessage } from './webapp/lib/echo-parser';  // ⭐ Phase 4.5 Step 1
import { matchEchoToBooking } from './webapp/lib/echo-matcher';  // ⭐ Phase 4.5 Step 2
import {
	listEventsByBookingId,
	listEvents,
	type CalendarEvent,
} from './webapp/lib/calendar-client';  // ⭐ Phase 5 Step 2
import {
	buildEventResource,
	gatherEventInputForBooking,
	createCalendarEventForBooking,
} from './webapp/lib/calendar-event-builder';  // ⭐ Phase 5 Step 2-B / 3-A
import {
	getFolderInfo,
	getFolderChildren,
	getParentFolder,
} from './webapp/lib/drive-client';  // ⭐ Phase 6-B Drive Step 1
import {
	parseFolderName,
	detectLinkType,
	matchBookingByFolderName,
} from './webapp/lib/drive-folder-parser';  // ⭐ Phase 6-B Drive Step 2

/**
 * Cloudflare Worker 엔트리.
 *   POST /webhook/talk         → 네이버 톡톡 webhook (실 운영)
 *   POST /admin/send-talk      → Apps Script 관리자용 톡톡 발송 API (Bearer: ADMIN_TOKEN)
 *   GET  /health               → 헬스체크
 *   GET  /test/webhook?case=   → 가짜 payload 로 handleWebhook 호출 (디버깅)
 *   GET  /test/cron            → 일일 Cron 즉시 실행 + JSON 결과 반환 (디버깅)
 *   GET  /test/cron-talk       → Phase 3 톡톡 처리 Cron 즉시 실행 (디버깅) ⭐
 *   GET  /test/cron-email      → Phase 4 Step 5 메일 폴링 Cron 즉시 실행 (디버깅) ⭐
 *   GET  /test/parse-echo      → Phase 4.5 Step 1 톡톡 echo 확정문자 파싱 (디버깅) ⭐
 *   GET  /test/match-echo      → Phase 4.5 Step 2 echo→bookings 매칭 (디버깅, dryRun 기본=1) ⭐
 *   GET  /test/calendar-list   → Phase 5 Step 2 캘린더 이벤트 조회 (디버깅) ⭐
 *   GET  /test/calendar-build  → Phase 5 Step 2-B 이벤트 리소스 빌드 dryRun (디버깅) ⭐
 *   GET  /test/calendar-create → Phase 5 Step 3-A 캘린더 이벤트 생성 (멱등성, dryRun=1 옵션) ⭐
 *   GET  /test/drive-read      → Phase 6-B Drive Step 1 폴더 조회 (current/parent/children) ⭐
 *   GET  /test/drive-parse     → Phase 6-B Drive Step 2 폴더명 파싱 + booking 매칭 dryRun ⭐
 *   GET  /test/cron-morning    → Phase 7 Step 1 아침 점검 리포트 즉시 실행 (디버깅) ⭐
 *   GET  /test/sync-calendar-bookings → 캘린더 description 예약번호 → calendar_event_id 동기화 ⭐
 *   그 외                      → 404
 *
 * `scheduled` 트리거:
 *   - "0 0 * * *" (UTC 00:00 = KST 09:00) → handleScheduledAlert (기존 일일 알림)
 *   - "* * * * *" (1분마다)               → handleScheduled (Phase 3 톡톡 처리) ⭐
 *   - "*\/5 * * * *" (5분마다)            → handleScheduledEmail (Phase 4 Step 5 메일 폴링) ⭐
 */
export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		
		// 새 웹앱 라우터 먼저 시도
		const webappResponse = await handleWebappRequest(request, env as any);
		if (webappResponse) return webappResponse;
    

		// webhook URL: /webhook/talk/<WEBHOOK_PATH_SECRET>
		// 네이버 톡톡 파트너 센터에서 이 전체 URL을 webhook으로 등록.
		if (url.pathname.startsWith("/webhook/talk/") && request.method === "POST") {
			const pathSecret = url.pathname.substring("/webhook/talk/".length);
			if (!env.WEBHOOK_PATH_SECRET) {
				console.error("[webhook] WEBHOOK_PATH_SECRET 미설정");
				return new Response("Server misconfigured", { status: 500 });
			}
			if (!pathSecret || pathSecret !== env.WEBHOOK_PATH_SECRET) {
				console.warn(`[webhook] 잘못된 path secret 시도: ${url.pathname}`);
				return new Response("Not Found", { status: 404 });
			}
			return handleWebhook(request, env);
		}

		if (url.pathname === "/admin/send-talk" && request.method === "POST") {
			return handleAdminSendTalk(request, env);
		}

		if (url.pathname === "/health" && request.method === "GET") {
			return new Response("OK", { status: 200 });
		}

		if (url.pathname === "/test/webhook" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			return runTestScenario(url, env);
		}

		if (url.pathname === "/test/cron" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const result = await runDailyAlert(env);
			return new Response(JSON.stringify(result, null, 2), {
				status: result.ok ? 200 : 500,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		// ⭐ Phase 3: 컨텍스트 로더 디버깅용
		if (url.pathname === "/test/context" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const talkId = url.searchParams.get("talk_id");
			if (!talkId) {
				return new Response(
					JSON.stringify({ error: "talk_id required" }, null, 2),
					{
						status: 400,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			}
			const targetIdsStr = url.searchParams.get("target_ids") ?? "";
			const targetIds = targetIdsStr
				? targetIdsStr
						.split(",")
						.map((s) => parseInt(s, 10))
						.filter((n) => !isNaN(n))
				: [];
			try {
				const { loadCustomerContext } = await import(
					"./webapp/lib/customer-context"
				);
				const context = await loadCustomerContext(env, talkId, targetIds);
				return new Response(JSON.stringify(context, null, 2), {
					status: 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4 Step 3: Gmail 메시지 목록
		if (url.pathname === "/test/list-emails" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const accessToken = await getValidAccessToken(env);
			if (!accessToken) {
				return new Response(
					JSON.stringify({ error: "Google 토큰 없음 — /auth/google?reauth=1 필요" }, null, 2),
					{ status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const max = parseInt(url.searchParams.get("max") || "10", 10) || 10;
			const query =
				url.searchParams.get("q") || "from:naverbooking_noreply@navercorp.com";
			try {
				const list = await listMessages(accessToken, query, max);
				return new Response(JSON.stringify(list, null, 2), {
					status: 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4 Step 3: 특정 메일 파싱 시뮬
		if (url.pathname === "/test/parse-email" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const messageId = url.searchParams.get("messageId");
			if (!messageId) {
				return new Response(
					JSON.stringify({ error: "messageId required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const accessToken = await getValidAccessToken(env);
			if (!accessToken) {
				return new Response(
					JSON.stringify({ error: "Google 토큰 없음 — /auth/google?reauth=1 필요" }, null, 2),
					{ status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			try {
				const message = await getMessage(accessToken, messageId);
				const subject = getHeader(message, "Subject") || "";
				const body = extractPlainBody(message) || "";
				const emailType = detectEmailType(subject);
				let parsed: unknown = null;
				if (emailType === "confirm") parsed = parseConfirmEmail(body);
				else if (emailType === "cancel") parsed = parseCancelEmail(body);
				return new Response(
					JSON.stringify(
						{
							message_id: messageId,
							subject,
							email_type: emailType,
							parsed,
							body_preview: body.slice(0, 500),
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4 Step 4-B-3: 메뉴 split + 매칭 시뮬 (DB INSERT 없음)
		if (url.pathname === "/test/split-menu" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const text = url.searchParams.get("text");
			if (!text) {
				return new Response(
					JSON.stringify({ error: "text required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const items = text
				.split(/\s\+\s/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			const results: Array<{
				raw_text: string;
				keyword: string;
				matched: boolean;
				product: unknown;
			}> = [];
			for (const rawText of items) {
				const keyword = rawText.replace(/\s*[\d,]+\s*원\s*$/, "").trim();
				let product: unknown = null;
				if (keyword) {
					product = await env.DB.prepare(
						`SELECT product_id, product_code, product_name
						 FROM products
						 WHERE REPLACE(match_keyword, ' ', '') = REPLACE(?1, ' ', '')
						   AND is_active = 1
						 LIMIT 1`,
					)
						.bind(keyword)
						.first();
				}
				results.push({
					raw_text: rawText,
					keyword,
					matched: product !== null,
					product,
				});
			}
			return new Response(JSON.stringify({ items, results }, null, 2), {
				status: 200,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		// ⭐ Phase 4 Step 4-A: 메일 1건 처리 (DB INSERT + system 메시지 + 푸시)
		if (url.pathname === "/test/process-email" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const messageId = url.searchParams.get("messageId");
			if (!messageId) {
				return new Response(
					JSON.stringify({ error: "messageId required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const accessToken = await getValidAccessToken(env);
			if (!accessToken) {
				return new Response(
					JSON.stringify({ error: "Google 토큰 없음 — /auth/google?reauth=1 필요" }, null, 2),
					{ status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			try {
				const message = await getMessage(accessToken, messageId);
				const result = await processEmail(env as any, message);
				return new Response(JSON.stringify(result, null, 2), {
					status: 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4: Google 토큰 상태 조회
		if (url.pathname === "/test/google-tokens" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const status = await getTokenStatus(env);
			return new Response(JSON.stringify(status, null, 2), {
				status: 200,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		}

		// ⭐ Phase 4: access_token 즉시 갱신 시뮬
		if (url.pathname === "/test/refresh-token" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const token = await getValidAccessToken(env);
			if (!token) {
				return new Response(
					JSON.stringify({ error: "토큰 없음 또는 갱신 실패 — /auth/google?reauth=1" }, null, 2),
					{
						status: 500,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			}
			return new Response(
				JSON.stringify({ success: true, token_preview: token.slice(0, 20) + "..." }, null, 2),
				{
					status: 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				},
			);
		}

		// ⭐ Phase 3 Step 7: 푸시 발송 디버깅용
		if (url.pathname === "/test/push" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const title = url.searchParams.get("title") || "테스트 알림";
			const body = url.searchParams.get("body") || "푸시 발송 테스트";
			try {
				const { sendPushNotification } = await import(
					"./webapp/lib/push-sender"
				);
				const result = await sendPushNotification(
					env as any,
					env.ALLOWED_EMAIL || "",
					{ title, body, tag: "test", data: { source: "test_push" } },
				);
				return new Response(JSON.stringify(result, null, 2), {
					status: 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 3: AI 분석 디버깅용 (system 메시지 INSERT 안 함)
		if (url.pathname === "/test/analyze" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const talkId = url.searchParams.get("talk_id");
			if (!talkId) {
				return new Response(
					JSON.stringify({ error: "talk_id required" }, null, 2),
					{
						status: 400,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			}
			const targetIdsStr = url.searchParams.get("target_ids") ?? "";
			const targetIds = targetIdsStr
				? targetIdsStr
						.split(",")
						.map((s) => parseInt(s, 10))
						.filter((n) => !isNaN(n))
				: [];
			try {
				const { loadCustomerContext } = await import(
					"./webapp/lib/customer-context"
				);
				const { matchLearnedRule } = await import(
					"./webapp/lib/rule-matcher"
				);
				const { analyzeWithAI } = await import(
					"./webapp/lib/batch-analyzer"
				);
				const context = await loadCustomerContext(env, talkId, targetIds);
				const rule = await matchLearnedRule(env, context);
				let analysis = null;
				if (!rule.matched) {
					analysis = await analyzeWithAI(env, context);
				}
				return new Response(
					JSON.stringify({ context, rule, analysis }, null, 2),
					{
						status: 200,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 3: 학습 규칙 매칭 디버깅용
		if (url.pathname === "/test/match" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const talkId = url.searchParams.get("talk_id");
			if (!talkId) {
				return new Response(
					JSON.stringify({ error: "talk_id required" }, null, 2),
					{
						status: 400,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			}
			const targetIdsStr = url.searchParams.get("target_ids") ?? "";
			const targetIds = targetIdsStr
				? targetIdsStr
						.split(",")
						.map((s) => parseInt(s, 10))
						.filter((n) => !isNaN(n))
				: [];
			try {
				const { loadCustomerContext } = await import(
					"./webapp/lib/customer-context"
				);
				const { matchLearnedRule } = await import(
					"./webapp/lib/rule-matcher"
				);
				const context = await loadCustomerContext(env, talkId, targetIds);
				const match = await matchLearnedRule(env, context);
				return new Response(
					JSON.stringify({ context, match }, null, 2),
					{
						status: 200,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 6-B Drive Step 2: 폴더명 파싱 + booking 매칭 (dryRun, DB UPDATE 없음)
		if (url.pathname === "/test/drive-parse" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const folderIdRaw = url.searchParams.get("folderId");
			if (!folderIdRaw) {
				return new Response(
					JSON.stringify({ error: "folderId is required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			// ?usp=sharing 등 쿼리 파라미터 제거
			const folderId = folderIdRaw.split("?")[0];

			try {
				const current = await getFolderInfo(env as any, folderId);
				const linkType = detectLinkType(current.name);
				const parent = await getParentFolder(env as any, folderId);
				const childrenResult = await getFolderChildren(env as any, folderId);
				const parsed = parent ? parseFolderName(parent.name) : null;
				const matchResult = parsed
					? await matchBookingByFolderName(env.DB, parsed)
					: { booking: null, reason: "상위 폴더 파싱 실패" as const };

				return new Response(
					JSON.stringify(
						{
							current: { id: current.id, name: current.name, linkType },
							parent: parent
								? { id: parent.id, name: parent.name, parsed }
								: null,
							children: (childrenResult.files || []).map((f) => ({
								id: f.id,
								name: f.name,
								mimeType: f.mimeType,
							})),
							matchedBooking: matchResult.booking,
							matchReason: matchResult.reason,
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 6-B Drive Step 1: 폴더 조회 디버그
		if (url.pathname === "/test/drive-read" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const folderIdRaw = url.searchParams.get("folderId");
			if (!folderIdRaw) {
				return new Response(
					JSON.stringify({ error: "folderId is required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			// ?usp=sharing 등 쿼리 파라미터 제거
			const folderId = folderIdRaw.split("?")[0];

			try {
				const current = await getFolderInfo(env as any, folderId);
				const parent = await getParentFolder(env as any, folderId);
				const childrenResult = await getFolderChildren(env as any, folderId);
				return new Response(
					JSON.stringify(
						{
							current: { id: current.id, name: current.name, mimeType: current.mimeType },
							parent: parent ? { id: parent.id, name: parent.name } : null,
							children: (childrenResult.files || []).map((f) => ({
								id: f.id,
								name: f.name,
								mimeType: f.mimeType,
							})),
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 5 Step 2-B: 이벤트 리소스 빌드 dryRun (DB만 조회, Calendar API 호출 X)
		if (url.pathname === "/test/calendar-build" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const bookingId = url.searchParams.get("bookingId");
			if (!bookingId) {
				return new Response(
					JSON.stringify({ error: "bookingId is required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}

			try {
				// (1) bookings
				const booking = await env.DB.prepare(
					"SELECT booking_id, customer_name, shoot_date FROM bookings WHERE booking_id = ?1",
				)
					.bind(bookingId)
					.first<{ booking_id: string; customer_name: string; shoot_date: string | null }>();

				if (!booking) {
					return new Response(
						JSON.stringify({ error: "booking_not_found", bookingId }, null, 2),
						{ status: 404, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}
				if (!booking.shoot_date) {
					return new Response(
						JSON.stringify({ error: "shoot_date_missing", bookingId }, null, 2),
						{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}

				// (2) 데이터 수집 — Step 3-A에서 공통화한 헬퍼 사용
				const gathered = await gatherEventInputForBooking(
					env.DB,
					booking.booking_id,
					booking.customer_name,
					booking.shoot_date,
					env.NAVER_BIZ_ID,
					env.TIMEZONE,
				);
				if (!gathered.ok) {
					return new Response(
						JSON.stringify({ error: "confirm_email_not_found", bookingId }, null, 2),
						{ status: 404, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}

				const eventResource = buildEventResource(gathered.input);

				return new Response(
					JSON.stringify(
						{
							bookingId,
							source: {
								bookings: {
									customer_name: booking.customer_name,
									shoot_date: booking.shoot_date,
								},
								gmailMessageId: gathered.gmailMessageId,
								resolvedCustomerName: gathered.input.customerName,
								abbreviations: gathered.input.abbreviations,
							},
							eventResource,
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 5 Step 3-A: 캘린더 이벤트 생성 (멱등성, dryRun 옵션)
		if (url.pathname === "/test/calendar-create" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const bookingId = url.searchParams.get("bookingId");
			if (!bookingId) {
				return new Response(
					JSON.stringify({ error: "bookingId is required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const dryRun = url.searchParams.get("dryRun") === "1";

			try {
				const result = await createCalendarEventForBooking(
					{ env: env as any, db: env.DB },
					bookingId,
					{ dryRun },
				);
				return new Response(
					JSON.stringify({ bookingId, dryRun, result }, null, 2),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				if (reason === "booking_not_found") {
					return new Response(
						JSON.stringify({ error: "booking_not_found", bookingId }, null, 2),
						{ status: 404, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 5 Step 2: 캘린더 이벤트 조회 디버깅
		if (url.pathname === "/test/calendar-list" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const bookingId = url.searchParams.get("bookingId");

			try {
				let items: CalendarEvent[] = [];
				if (bookingId) {
					const result = await listEventsByBookingId(env as any, bookingId);
					items = result.items ?? [];
				} else {
					const now = new Date();
					const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
					const result = await listEvents(env as any, {
						timeMin: now.toISOString(),
						timeMax: thirtyDaysLater.toISOString(),
						singleEvents: "true",
						orderBy: "startTime",
						maxResults: "10",
					});
					items = result.items ?? [];
				}

				const summarized = items.map((ev) => ({
					id: ev.id,
					summary: ev.summary ?? null,
					start: ev.start?.dateTime ?? ev.start?.date ?? null,
					end: ev.end?.dateTime ?? ev.end?.date ?? null,
					bookingId: ev.extendedProperties?.private?.bookingId ?? null,
				}));

				return new Response(
					JSON.stringify(
						{
							calendarId: env.CALENDAR_ID,
							count: summarized.length,
							items: summarized,
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4.5 Step 2: echo→bookings 매칭 디버깅 (dryRun 기본 ON)
		if (url.pathname === "/test/match-echo" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const talkMessageId = url.searchParams.get("talkMessageId");
			const dryRunParam = url.searchParams.get("dryRun");
			const dryRun = dryRunParam !== "0";

			if (!talkMessageId) {
				return new Response(
					JSON.stringify({ error: "talkMessageId is required" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const idNum = Number(talkMessageId);
			if (!Number.isInteger(idNum) || idNum <= 0) {
				return new Response(
					JSON.stringify({ error: "talkMessageId must be a positive integer" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}

			try {
				const row = await env.DB.prepare(
					"SELECT talk_id, message_content FROM talk_messages WHERE id = ?1",
				)
					.bind(idNum)
					.first<{ talk_id: string; message_content: string | null }>();
				if (!row) {
					return new Response(
						JSON.stringify({ error: `talk_messages id=${idNum} not found` }, null, 2),
						{ status: 404, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}

				const message = row.message_content ?? "";
				const matchResult = await matchEchoToBooking(env as any, row.talk_id, message, { dryRun });

				return new Response(
					JSON.stringify(
						{
							talkMessageId: idNum,
							talkId: row.talk_id,
							messagePreview: message.slice(0, 200),
							messageLength: message.length,
							dryRun,
							parseResult: matchResult.parseResult ?? null,
							matchResult,
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4.5 Step 1: 톡톡 echo 확정문자 파싱 디버깅
		if (url.pathname === "/test/parse-echo" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const talkMessageId = url.searchParams.get("talkMessageId");
			const messageParam = url.searchParams.get("message");

			let message: string | null = null;
			let source: "param" | "talk_messages" = "param";

			try {
				if (talkMessageId) {
					const idNum = Number(talkMessageId);
					if (!Number.isInteger(idNum) || idNum <= 0) {
						return new Response(
							JSON.stringify({ error: "talkMessageId must be a positive integer" }, null, 2),
							{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
						);
					}
					const row = await env.DB.prepare(
						"SELECT message_content FROM talk_messages WHERE id = ?1",
					)
						.bind(idNum)
						.first<{ message_content: string | null }>();
					if (!row) {
						return new Response(
							JSON.stringify({ error: `talk_messages id=${idNum} not found` }, null, 2),
							{ status: 404, headers: { "content-type": "application/json; charset=utf-8" } },
						);
					}
					message = row.message_content;
					source = "talk_messages";
				} else if (messageParam) {
					message = messageParam;
					source = "param";
				} else {
					return new Response(
						JSON.stringify({ error: "either message or talkMessageId is required" }, null, 2),
						{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}

				const result = parseEchoConfirmMessage(message || "");
				const preview = (message || "").slice(0, 200);

				return new Response(
					JSON.stringify(
						{
							source,
							talk_message_id: talkMessageId ? Number(talkMessageId) : null,
							message_length: (message || "").length,
							message_preview: preview,
							result,
						},
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 7 Step 1: 아침 점검 리포트 즉시 실행 (디버깅)
		if (url.pathname === "/test/cron-morning" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			try {
				const { runMorningReport } = await import("./webapp/lib/morning-report");
				await runMorningReport(env as any);
				return new Response(
					JSON.stringify(
						{ ok: true, message: "morning report 실행 완료. 채팅창 확인하세요." },
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ ok: false, error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// 톡톡 직접 발송 테스트
		if (url.pathname === "/test/talk-send" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const talkId = decodeURIComponent(url.searchParams.get("talkId") || "");
			const message = decodeURIComponent(url.searchParams.get("message") || "");
			if (!talkId || !message) {
				return new Response(
					JSON.stringify({ ok: false, error: "talkId와 message 파라미터 필수" }, null, 2),
					{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			try {
				const { sendNaverTalkMessage } = await import("./services/talk");
				const result = await sendNaverTalkMessage(env, talkId, message);
				return new Response(
					JSON.stringify({ ok: result.success, talkId, message, raw: result.raw }, null, 2),
					{ status: result.success ? 200 : 502, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ ok: false, error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// 만차안내 즉시 실행 (디버깅)
		if (url.pathname === "/test/cron-parking" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const dryRun = url.searchParams.get("dryRun") === "1";
			try {
				const { runParkingNotice } = await import("./webapp/lib/parking-notice");
				const result = await runParkingNotice(env as any, dryRun);
				if (dryRun && result) {
					return new Response(JSON.stringify({ ok: true, dryRun: true, ...result }, null, 2), {
						status: 200,
						headers: { "content-type": "application/json; charset=utf-8" },
					});
				}
				return new Response(
					JSON.stringify({ ok: true, message: "만차안내 실행 완료. 채팅창 확인하세요." }, null, 2),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ ok: false, error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// 카카오 토큰 상태 확인
		if (url.pathname === "/test/kakao-tokens" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			try {
				const row = await env.DB.prepare(
					`SELECT user_id, expires_at, updated_at FROM kakao_tokens WHERE id = 1`,
				).first<{ user_id: string; expires_at: string; updated_at: string }>();
				if (!row) {
					return new Response(
						JSON.stringify({ exists: false, message: "/auth/kakao 에서 연동 필요" }, null, 2),
						{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}
				const expired = new Date() > new Date(row.expires_at.replace(' ', 'T') + 'Z');
				return new Response(
					JSON.stringify({ exists: true, user_id: row.user_id, expires_at: row.expires_at, expired, updated_at: row.updated_at }, null, 2),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ ok: false, error: reason }, null, 2), {
					status: 500, headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// talk_id 수동 교체 (booking 1건) 또는 고객명으로 후보 조회
		if (url.pathname === "/admin/update-talk-id" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const bookingId = url.searchParams.get("booking_id");
			const customerName = url.searchParams.get("customer_name");
			const newTalkId = url.searchParams.get("new_talk_id");
			const dryRun = url.searchParams.get("dryRun") !== "0";

			try {
				// 고객명 조회 모드: 후보 목록 반환
				if (customerName && !bookingId) {
					const rows = await env.DB.prepare(
						`SELECT booking_id, talk_id, customer_name, shoot_date
						 FROM bookings
						 WHERE customer_name = ?1
						 ORDER BY shoot_date DESC`,
					)
						.bind(customerName)
						.all<{ booking_id: string; talk_id: string | null; customer_name: string; shoot_date: string | null }>();

					return new Response(
						JSON.stringify({
							candidates: (rows.results ?? []).map((r) => ({
								bookingId: r.booking_id,
								oldTalkId: r.talk_id,
								customerName: r.customer_name,
								shootDate: r.shoot_date,
							})),
							hint: "candidates가 여러 개면 booking_id를 지정해 dryRun=0으로 재실행하세요",
						}, null, 2),
						{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}

				if (!bookingId || !newTalkId) {
					return new Response(
						JSON.stringify({ error: "booking_id+new_talk_id 또는 customer_name+new_talk_id 필수" }, null, 2),
						{ status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
					);
				}

				const { updateBookingTalkId } = await import("./webapp/lib/talk-id-updater");
				const result = await updateBookingTalkId(env, bookingId, newTalkId, { dryRun });
				return new Response(JSON.stringify(result, null, 2), {
					status: result.status === "no_booking" ? 404 : 200,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// 카카오톡 즉시 발송 테스트
		if (url.pathname === "/test/kakao-send" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			const message = url.searchParams.get("message") || "카카오톡 테스트 메시지";
			try {
				await sendKakaoMessage(env as any, message);
				return new Response(
					JSON.stringify({ ok: true, message: "발송 완료", text: message }, null, 2),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ ok: false, error: reason }, null, 2), {
					status: 500, headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		// ⭐ Phase 4 Step 5: 메일 폴링 Cron 디버깅용 (5분 안 기다리고 즉시 실행)
		if (url.pathname === "/test/cron-email" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			try {
				await handleScheduledEmail(env as any);
				return new Response(
					JSON.stringify(
						{ ok: true, message: "cron-email 실행 완료. wrangler tail 로그 확인하세요." },
						null,
						2,
					),
					{
						status: 200,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(
					JSON.stringify({ ok: false, error: reason }, null, 2),
					{
						status: 500,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			}
		}

		// ⭐ Phase 3: 톡톡 처리 Cron 디버깅용 (1분 안 기다리고 즉시 실행)
		if (url.pathname === "/test/cron-talk" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;
			try {
				await handleScheduled(
					{
						cron: "* * * * *",
						scheduledTime: Date.now(),
						type: "scheduled",
						noRetry: () => {},
					} as unknown as ScheduledController,
					env,
				);
				return new Response(
					JSON.stringify({ ok: true, message: "Phase 3 cron executed. Check logs for details." }, null, 2),
					{
						status: 200,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(
					JSON.stringify({ ok: false, error: reason }, null, 2),
					{
						status: 500,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			}
		}

		// ⭐ Phase 5: 캘린더 description 예약번호 → bookings.calendar_event_id 동기화 (디버깅)
		if (url.pathname === "/test/sync-calendar-bookings" && request.method === "GET") {
			const authErr = checkAdminAuth(request, env);
			if (authErr) return authErr;

			const dryRun = url.searchParams.get("dryRun") === "1";
			const accessToken = await getValidAccessToken(env);
			if (!accessToken) {
				return new Response(
					JSON.stringify({ error: "Google 토큰 없음 — /auth/google?reauth=1 필요" }, null, 2),
					{ status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}

			try {
				const now = new Date();
				const sixMonthsAgo = new Date(now);
				sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
				const sixMonthsLater = new Date(now);
				sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

				const result = await listEvents(env as any, {
					timeMin: sixMonthsAgo.toISOString(),
					timeMax: sixMonthsLater.toISOString(),
					maxResults: "100",
					singleEvents: "true",
					fields: "items(id,summary,description)",
				});

				const items = result.items ?? [];

				type UpdatedItem = { booking_id: string; customer_name: string; event_id: string; summary: string };
				type AlreadyMatchedItem = { booking_id: string; customer_name: string };
				type SkippedItem = { event_id: string; summary: string; parsed_booking_id: string };

				const updated: UpdatedItem[] = [];
				const already_matched: AlreadyMatchedItem[] = [];
				const skipped: SkippedItem[] = [];
				let no_booking_id = 0;

				const bookingIdRegex = /예약번호\s*[:：]\s*([A-Za-z0-9_-]+)/;

				for (const event of items) {
					const description = event.description ?? "";
					const match = bookingIdRegex.exec(description);
					if (!match) {
						no_booking_id++;
						continue;
					}
					const parsedBookingId = match[1];
					const summary = event.summary ?? "";

					const booking = await env.DB.prepare(
						"SELECT booking_id, customer_name, calendar_event_id FROM bookings WHERE booking_id = ?1",
					)
						.bind(parsedBookingId)
						.first<{ booking_id: string; customer_name: string; calendar_event_id: string | null }>();

					if (!booking) {
						skipped.push({ event_id: event.id, summary, parsed_booking_id: parsedBookingId });
						continue;
					}

					if (booking.calendar_event_id === event.id) {
						already_matched.push({ booking_id: booking.booking_id, customer_name: booking.customer_name });
						continue;
					}

					if (!dryRun) {
						await env.DB.prepare(
							"UPDATE bookings SET calendar_event_id = ?1, updated_at = datetime('now') WHERE booking_id = ?2",
						)
							.bind(event.id, booking.booking_id)
							.run();
					}
					updated.push({
						booking_id: booking.booking_id,
						customer_name: booking.customer_name,
						event_id: event.id,
						summary,
					});
				}

				return new Response(
					JSON.stringify(
						{ dryRun, total_events: items.length, updated, already_matched, skipped, no_booking_id },
						null,
						2,
					),
					{ status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
				);
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				return new Response(JSON.stringify({ error: reason }, null, 2), {
					status: 500,
					headers: { "content-type": "application/json; charset=utf-8" },
				});
			}
		}

		return new Response("Not Found", { status: 404 });
	},
	async scheduled(event, env, ctx): Promise<void> {
		// ⭐ Phase 3 / Phase 4: cron 표현식으로 분기
		if (event.cron === "* * * * *") {
			// 1분마다: Phase 3 톡톡 처리
			ctx.waitUntil(handleScheduled(event, env));
		} else if (event.cron === "0 0 * * *") {
			// 자정 (UTC 00:00 = KST 09:00): 기존 일일 알림
			ctx.waitUntil(handleScheduledAlert(event, env, ctx));
		} else if (event.cron === "*/5 * * * *") {
			// 5분마다: Phase 4 Step 5 메일 폴링
			ctx.waitUntil(handleScheduledEmail(env as any));
		} else if (event.cron === "0 23 * * *") {
			// UTC 23:00 = KST 08:00: 만차안내 자동 발송
			ctx.waitUntil((async () => {
				const { runParkingNotice } = await import("./webapp/lib/parking-notice");
				await runParkingNotice(env as any);
			})());
		} else {
			console.warn(`[scheduled] Unknown cron expression: ${event.cron}`);
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * /test/* 엔드포인트 보호. Authorization 헤더 == ADMIN_TOKEN 단순 비교
 * (admin-send-talk.ts와 동일 패턴, Bearer 접두어 없음).
 */
function checkAdminAuth(request: Request, env: Env): Response | null {
	if (!env.ADMIN_TOKEN) {
		return new Response("Server misconfigured", { status: 500 });
	}
	const auth = request.headers.get("Authorization");
	if (auth !== env.ADMIN_TOKEN) {
		const path = new URL(request.url).pathname;
		console.warn(`[admin] /test/* 인증 실패: path=${path}`);
		return new Response("Unauthorized", { status: 401 });
	}
	return null;
}

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
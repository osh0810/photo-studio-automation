/**
 * POST /admin/send-talk — Apps Script(사장님 대시보드) 에서 호출하는
 * 네이버 톡톡 자동 발송 엔드포인트.
 *
 * 목적:
 *   - 사장님이 시트에서 "원본발송" 등 버튼을 누르면 Apps Script 가 이 API 로
 *     호출해서 (1) 네이버 톡톡 메시지 발송 + (2) 고객목록 시트 상태 업데이트를
 *     원자적으로 처리하게 한다.
 *
 * 처리 순서 (webhook.ts 와 동일한 3단 방어 철학):
 *   1) 인증 → 필수필드 검증 → 하루 발송한도 체크 (입구 방어)
 *   2) 네이버 톡톡 발송 (withRetry 로 5xx/429 는 최대 3회 재시도)
 *   3) 발송 성공 시 시트 업데이트 + _시스템로그 기록 + Discord 알림
 *   4) 발송은 성공했는데 시트 업데이트만 실패한 경우 → HTTP 200 + warning
 *      (재시도하면 중복 발송 위험, 사람이 수동 처리하도록 긴급에러로 알림)
 */

import { withRetry } from "../lib/retry";
import { sendDiscordAlert } from "../services/discord";
import {
	appendSystemLog,
	countTodaySystemLogEntries,
	searchCustomerByTalkId,
	updateCustomerCells,
} from "../services/sheets";
import { NaverTalkApiError, sendNaverTalkMessage } from "../services/talk";
import {
	AlertLevel,
	type AdminSendTalkRequest,
	type AdminSendTalkResponse,
	type Customer,
	type Env,
} from "../types";

/** 하루 발송 한도. 실패 포함 카운트 — 폭주/루프 방어가 최우선. */
const DAILY_SEND_LIMIT = 100;
/** 미리보기 자르기 길이. Discord 알림용. */
const PREVIEW_LEN = 50;

// ─── 응답 helpers ───────────────────────────────────────────────────────

function jsonResponse(
	status: number,
	body: AdminSendTalkResponse,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

/** Discord 실패가 API 응답 자체를 실패로 만들지 않도록 catch 로 감싼다. */
function safeSendDiscord(
	env: Env,
	webhook: string,
	level: AlertLevel,
	title: string,
	content: string,
): Promise<void> {
	return sendDiscordAlert(webhook, level, title, content).catch((err) => {
		console.error("[admin-send-talk] Discord 전송 실패:", err);
	});
}

/**
 * 시스템로그 `내용` 컬럼 포맷. 시트에서 직접 눈으로 스캔/필터하기 쉽게
 * `key=value | key=value` 파이프 구분. 값에 `|` 가 들어갈 일은 거의 없지만
 * 혹시 몰라 공백으로 치환.
 */
function formatLogContent(parts: Record<string, string | number>): string {
	return Object.entries(parts)
		.map(([k, v]) => `${k}=${String(v).replace(/\|/g, " ")}`)
		.join(" | ");
}

// ─── 본체 ───────────────────────────────────────────────────────────────

export async function handleAdminSendTalk(
	request: Request,
	env: Env,
): Promise<Response> {
	// ── 1. 인증 ───────────────────────────────────────────────────────
	// Apps Script 에서 Authorization 헤더에 ADMIN_TOKEN 그대로 실어서 보낸다.
	// "Bearer " 접두사는 붙이지 않고 토큰 원문만 비교 — 운영 단순화 목적.
	const auth = request.headers.get("authorization") ?? "";
	if (!env.ADMIN_TOKEN || auth !== env.ADMIN_TOKEN) {
		return jsonResponse(401, {
			success: false,
			error: "인증 실패",
			detail: "Authorization 헤더가 올바르지 않습니다.",
		});
	}

	// ── 2. payload 파싱 + 필수필드 검증 ──────────────────────────────
	let body: AdminSendTalkRequest;
	try {
		body = (await request.json()) as AdminSendTalkRequest;
	} catch {
		return jsonResponse(400, {
			success: false,
			error: "JSON 파싱 실패",
		});
	}

	const { customerId, talkId, message, action, updates } = body ?? {};
	const missing: string[] = [];
	if (!customerId) missing.push("customerId");
	if (!talkId) missing.push("talkId");
	if (!message) missing.push("message");
	if (missing.length > 0) {
		return jsonResponse(400, {
			success: false,
			error: "필수 필드 누락",
			detail: `누락된 필드: ${missing.join(", ")}`,
		});
	}

	// ── 3. 하루 발송 한도 체크 ─────────────────────────────────────────
	// _시스템로그 에서 오늘 `종류=talk_send` 행 개수를 센다. 실패 포함.
	// 한도 초과 자체도 로그 1건으로 남겨서 "왜 안 나갔는지" 추적 가능.
	try {
		const todayCount = await withRetry(() =>
			countTodaySystemLogEntries(env, "talk_send"),
		);
		if (todayCount >= DAILY_SEND_LIMIT) {
			await appendSystemLog(env, {
				등급: AlertLevel.WARNING,
				종류: "talk_send",
				내용: formatLogContent({
					result: "blocked",
					reason: "daily_limit",
					action: action ?? "",
					length: message.length,
					todayCount,
				}),
				관련고객ID: customerId,
			}).catch((err) =>
				console.error("[admin-send-talk] 한도초과 로그 기록 실패:", err),
			);
			return jsonResponse(429, {
				success: false,
				error: "하루 발송 한도 초과",
				detail: `오늘 ${todayCount}건 발송 완료 (한도: ${DAILY_SEND_LIMIT}건).`,
			});
		}
	} catch (err) {
		// 한도 체크 실패는 "발송 계속" 쪽으로 갈 수도, "차단" 쪽으로 갈 수도 있지만
		// 시트 장애 시 업무 전체가 멈추면 안 되므로 보수적으로 "계속 진행" + 경고 로그.
		console.error("[admin-send-talk] 한도 체크 실패 (진행 계속):", err);
	}

	// ── 4. 네이버 톡톡 발송 ────────────────────────────────────────────
	// withRetry 는 NaverTalkApiError 의 status 필드로 5xx/429 재시도. 4xx 는 즉시 throw.
	try {
		const send = await withRetry(() =>
			sendNaverTalkMessage(env, talkId, message),
		);

		if (!send.success) {
			// HTTP 2xx 지만 body 레벨에서 실패 — 시트 업데이트 절대 하지 않는다.
			await appendSystemLog(env, {
				등급: AlertLevel.ERROR,
				종류: "talk_send",
				내용: formatLogContent({
					result: "fail",
					action: action ?? "",
					length: message.length,
					duration: `${send.durationMs}ms`,
					resultCode: send.resultCode ?? "-",
				}),
				관련고객ID: customerId,
			}).catch((err) =>
				console.error("[admin-send-talk] 실패 로그 기록 실패:", err),
			);
			return jsonResponse(502, {
				success: false,
				error: "네이버 응답 실패",
				detail: `resultCode=${send.resultCode ?? "unknown"}`,
				naverResponse: send.raw,
			});
		}

		// ── 5. 시트 업데이트 (updates 있을 때만) ────────────────────
		// 발송은 이미 성공했으므로 여기 실패해도 재시도하면 중복 발송이 된다.
		// → throw 하지 않고 warning 필드로 응답에 담아 사람이 수동 처리하게 함.
		let updatedFields: string[] = [];
		let updateWarning: string | undefined;
		let updateFailedFields: string[] | undefined;

		if (updates && Object.keys(updates).length > 0) {
			try {
				const match = await withRetry(() =>
					searchCustomerByTalkId(env, talkId),
				);
				if (!match) {
					updateWarning = `고객목록에서 talkId=${talkId} 매칭 실패 — 시트 업데이트 스킵`;
					updateFailedFields = Object.keys(updates);
				} else {
					// Customer 타입의 key 만 골라서 넘긴다 — 미지정 key 는 updateCustomerCells 에서 throw.
					const patch: Partial<Customer> = { ...updates };
					await withRetry(() =>
						updateCustomerCells(env, match.rowNumber, patch),
					);
					updatedFields = Object.keys(patch);
				}
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				updateWarning = `시트 업데이트 실패: ${reason}`;
				updateFailedFields = Object.keys(updates);
				console.error("[admin-send-talk] 시트 업데이트 실패:", err);

				// 중복 발송 위험 — 사장님이 수동으로 시트 고치도록 긴급에러 알림.
				await safeSendDiscord(
					env,
					env.DISCORD_WEBHOOK_ERROR,
					AlertLevel.CRITICAL,
					"⚠️ 톡톡 발송 성공 / 시트 업데이트 실패",
					[
						`**고객ID**: ${customerId}`,
						`**작업**: ${action ?? "-"}`,
						`**실패 사유**: ${reason}`,
						`**수동 업데이트 필요 필드**: ${updateFailedFields.join(", ")}`,
					].join("\n"),
				);
			}
		}

		// ── 6. _시스템로그 성공 기록 ──────────────────────────────────
		// warning 여부와 관계없이 "발송은 됐다" 는 사실을 남겨야 — 한도 카운트의 기준.
		await appendSystemLog(env, {
			등급: updateWarning ? AlertLevel.WARNING : AlertLevel.INFO,
			종류: "talk_send",
			내용: formatLogContent({
				result: updateWarning ? "success_with_warning" : "success",
				action: action ?? "",
				length: message.length,
				duration: `${send.durationMs}ms`,
				...(send.resultCode ? { resultCode: send.resultCode } : {}),
				...(updateWarning ? { warning: "sheet_update_failed" } : {}),
			}),
			관련고객ID: customerId,
		}).catch((err) =>
			console.error("[admin-send-talk] 성공 로그 기록 실패:", err),
		);

		// ── 7. Discord #처리내역 알림 ─────────────────────────────────
		// 이름은 매칭된 경우만 알 수 있음 — 없으면 customerId 로 대체.
		// 여기서 searchCustomerByTalkId 재조회를 피하기 위해 위의 updates 블록에서
		// 얻은 정보를 활용했지만, updates 없으면 재조회 없이 customerId 만 표시.
		const preview =
			message.length > PREVIEW_LEN
				? `${message.slice(0, PREVIEW_LEN)}…`
				: message;
		const processedTitle = `✅ 톡톡 자동 발송 완료 - ${action ?? "메시지"}`;
		const processedContent = [
			`**고객ID**: ${customerId}`,
			`**작업**: ${action ?? "-"}`,
			`**메시지 미리보기**: ${preview}`,
			updatedFields.length > 0
				? `**시트 업데이트**: ${updatedFields.join(", ")}`
				: "**시트 업데이트**: (없음)",
			updateWarning ? `⚠️ ${updateWarning}` : "",
		]
			.filter(Boolean)
			.join("\n");
		await safeSendDiscord(
			env,
			env.DISCORD_WEBHOOK_PROCESSED,
			AlertLevel.INFO,
			processedTitle,
			processedContent,
		);

		// ── 8. 최종 응답 ─────────────────────────────────────────────
		return jsonResponse(200, {
			success: true,
			customerId,
			action,
			updatedFields,
			naverResponse: send.raw,
			...(updateWarning
				? { warning: updateWarning, failedFields: updateFailedFields }
				: {}),
		});
	} catch (err) {
		// 여기 오는 것: withRetry(sendNaverTalkMessage) 가 최종 실패.
		// 네트워크 / 4xx / 재시도 모두 소진한 5xx 포함.
		console.error("[admin-send-talk] 네이버 발송 실패:", err);
		const status =
			err instanceof NaverTalkApiError
				? err.status >= 400 && err.status < 500
					? 502 // 4xx 도 운영 관점에선 "외부 게이트웨이 오류" 로 취급.
					: 502
				: 500;
		const message = err instanceof Error ? err.message : String(err);

		await appendSystemLog(env, {
			등급: AlertLevel.ERROR,
			종류: "talk_send",
			내용: formatLogContent({
				result: "fail",
				action: action ?? "",
				length: body?.message?.length ?? 0,
				error: message,
			}),
			관련고객ID: customerId,
		}).catch((logErr) =>
			console.error("[admin-send-talk] 실패 로그 기록 실패:", logErr),
		);

		await safeSendDiscord(
			env,
			env.DISCORD_WEBHOOK_ERROR,
			AlertLevel.ERROR,
			"❌ 톡톡 자동 발송 실패",
			[
				`**고객ID**: ${customerId}`,
				`**작업**: ${action ?? "-"}`,
				`**에러**: ${message}`,
			].join("\n"),
		);

		return jsonResponse(status, {
			success: false,
			error:
				status === 502
					? "네이버 톡톡 API 호출 실패"
					: "내부 처리 오류",
			detail: message,
		});
	}
}

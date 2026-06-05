/**
 * Phase 3 Step 4-C: 배치 처리용 AI 분석.
 *
 * cron-handler가 사용자별 미처리 메시지(target)를 묶어 호출.
 * 학습 규칙으로 처리 못 한 케이스에서 Claude Haiku에 컨텍스트를 전달하고
 * 결과를 4가지 type 중 하나로 분류해 반환.
 *
 * 본 함수는 system 메시지 INSERT를 하지 않음 — 호출자(cron-handler)가
 * 결과를 받아 system-message-builder를 통해 INSERT.
 */

import type { Env } from '../../types';
import type { CustomerContext, MilestoneKey } from './customer-context';
import {
	TOOLS,
	executeRecordMilestone,
	executeSearchCustomers,
	executeUpdateCustomerMemo,
	executeAddLearnedRule,
	executeSaveFrameAddress,
	executeRecordPromotionConsent,
	executeSetUrgent,
} from './ai-tools';

// ─── 상수 ──────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const AI_TIMEOUT_MS = 30_000;
const MAX_TOOL_ROUNDS = 3; // 배치는 보수적
const MAX_OUTPUT_TOKENS = 1024;

const DATA_QUERY_KEYWORDS = [
	'원본', '셀렉', '보정', '추가보정', '액자',
	'고객', '예약', '단계', '촬영',
	'안 한', '안한', '못한', '대기', '필요', '발송',
	'몇 명', '몇명', '얼마나', '누구', '있나',
	'보여', '알려', '찾아', '검색', '조회',
	'오늘', '어제', '경과', '지났', '늦었',
];

// ─── 타입 ──────────────────────────────────────────────────────────────

export interface ConfirmActionPayload {
	type: string;
	milestone_type?: string;
	content?: string;
	date?: string;
	require_confirmation?: boolean;
}

export type BatchAnalysisResult =
	| {
			type: 'auto_processed';
			summary: string;
			tool_uses: Array<{ name: string; input: any; result: any }>;
	  }
	| {
			type: 'awaiting_confirm';
			ai_text: string;
			confirmation: ConfirmActionPayload | null;
	  }
	| {
			type: 'info_only';
			summary: string;
	  }
	| {
			type: 'duplicate';
	  }
	| {
			type: 'error';
			reason: string;
	  };

interface AnthropicTextBlock {
	type: 'text';
	text: string;
}
interface AnthropicToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, any>;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicResponse {
	id: string;
	content: AnthropicContentBlock[];
	stop_reason: string;
	usage: { input_tokens: number; output_tokens: number };
}

// ─── 시스템 프롬프트 조립 ──────────────────────────────────────────────

const MILESTONE_LABELS: Record<MilestoneKey, string> = {
	shoot_date: '촬영',
	original_sent_at: '원본 발송',
	selection_received_at: '셀렉 수신',
	retouched_sent_at: '보정본 발송',
	revision_requested_at: '추가보정 요청',
	revision_no_more_at: '추가보정 없음 확정',
	revision_sent_at: '추가보정 발송',
	frame_ordered_at: '액자 발주',
};

function fmtMilestoneLine(
	key: MilestoneKey,
	date: string | null,
	days: number | null,
): string {
	const label = MILESTONE_LABELS[key];
	if (!date) return `- ${label}: -`;
	const ago = days != null ? ` (${days}일 전)` : '';
	return `- ${label}: ${date}${ago}`;
}

function buildSystemPrompt(ctx: CustomerContext): string {
	const c = ctx.customer;
	const customerName = c.customer_name ?? `미등록(talk_id=${c.talk_id})`;
	const bookingId = c.booking_id ?? '없음';

	const milestoneLines: string[] = [];
	(Object.keys(MILESTONE_LABELS) as MilestoneKey[]).forEach((k) => {
		milestoneLines.push(fmtMilestoneLine(k, c.milestones[k], c.days_since[k]));
		if (k === 'selection_received_at' && c.selection_cuts) {
			milestoneLines.push(`  (셀렉컷: ${c.selection_cuts})`);
		}
		if (k === 'revision_requested_at' && c.revision_content) {
			milestoneLines.push(`  (요청내용: ${c.revision_content})`);
		}
	});

	const lastMs = c.last_milestone.key
		? `${c.last_milestone.key} (${c.last_milestone.days_ago}일 전)`
		: '없음';

	const talkLines = ctx.talk_history.map((m) => {
		const time = m.message_at.slice(5, 16); // MM-DD HH:mm
		const who = m.sender_type === 'customer' ? '고객' : '작가';
		const target = m.is_target ? ' [⭐ 처리 대상]' : '';
		return `[${time}] ${who}${target}: ${m.message_content ?? ''}`;
	});
	const talkBlock = talkLines.length > 0 ? talkLines.join('\n') : '(없음)';

	const aiHistLines = ctx.ai_chat_history.map((m) => {
		const time = m.created_at.slice(5, 16);
		return `[${time}] (${m.sender}) ${m.message}`;
	});
	const aiHistBlock = aiHistLines.length > 0 ? aiHistLines.join('\n') : '(없음)';

	return `당신은 사진관 "마음껏스튜디오"의 AI 비서입니다.
한 고객의 톡톡 대화 흐름을 보고, 새로 도착한 메시지들을 처리합니다.

## 📌 판단 원칙 (가장 중요)

본질 = milestone 처리 날짜와 시간 흐름
- "이 시점에 어떤 일이 마지막으로 일어났나"가 판단의 기준
- 같은 메시지도 직전 milestone이 무엇이냐에 따라 의미가 달라짐
- 단계 라벨(S0~S7)은 UX 표시일 뿐, 판단에 사용 X
- 추측 X. 모호하면 작가님에게 확인 요청.

## 고객 정보

- 이름: ${customerName}
- talk_id: ${c.talk_id} ← save_frame_address 호출 시 이 값을 그대로 사용
- 예약번호: ${bookingId}

## 처리 날짜 (milestone) — 본질 정보

${milestoneLines.join('\n')}

⭐ 가장 최근 milestone: ${lastMs}
(참고 표시: ${c.stage_label} — UX 요약일 뿐)

## 최근 톡톡 대화 (시간순, 최근 14일)

${talkBlock}

## 작가님 처리 히스토리 (최근 10건)

${aiHistBlock}

## 판단 가이드

1. 명확한 milestone 이벤트 → record_milestone 도구 호출
2. 모호함 → 작가님 확인 요청 (도구 호출 X, 텍스트로)
3. 단순 인사/잡담/확인 → 보고만 (도구 호출 X)
4. 이미 처리된 흐름 → 중복 인식

⚠️ 절대 환각 금지. milestone 날짜 + 톡톡 대화 사실로만 판단.
⚠️ 미등록 고객(booking_id 없음)이면 새 잠재 고객 가능성 높음 → 작가님 확인 권장.

## 셀렉 수신(selection_received) 판단 기준

고객 메시지에 구체적인 사진 번호(숫자)가 포함되어 있으면 selection_received_at 기록:
- "413, 572 골랐어요", "고정으로 고른건 413, 572" → 즉시 record_milestone(selection_received)
- 일부 확정 + 일부 고민 혼재("413 572 고정, 223 246 중 고민") → 확정된 것만으로도 기록. content에 전체 언급 포함
- 작가님 의견 요청("어떤 게 나을까요?")이 섞여 있어도 → 번호가 명시되어 있으면 우선 기록 후 awaiting_confirm으로 의견 요청
- 번호 없이 "마음에 드는 걸로 해주세요" 등 → 기록 불가, 작가님 확인 요청

## 🚨 save_frame_address 자동 처리 (절대 규칙)

메시지에 도로명·지번 주소가 포함된 경우 (시/군/구/동/로/길/번지 등 패턴):
- 위 "고객 정보"의 talk_id 값을 그대로 사용해서 즉시 save_frame_address 호출
- booking_id가 없어도 상관없음 — talk_id만 있으면 저장 가능
- booking_id가 없다는 이유로 주소 저장을 건너뛰는 것 절대 금지
- "talk_id를 알려주세요" 절대 금지 — talk_id는 위 고객 정보에 항상 제공됨
- 수령인 이름이 메시지에 있으면 frame_recipient 함께 전달
- 연락처가 메시지에 있으면 frame_phone 함께 전달
- "지난번 동일 주소", "이전 주소로" → frame_address = '[이전주소동일]' 저장

처리 우선순위:
1. 주소 패턴 감지 → save_frame_address(talk_id="${c.talk_id}", ...) 즉시 호출 (auto_processed)
2. 주소 + milestone 동시 감지 → 두 도구 모두 호출
3. talk_id가 비어 있는 경우에만 → 작가님 확인 요청

## 🚫 frame_ordered 완전 차단 (절대 규칙)

고객 톡톡 메시지에서는 **어떠한 경우에도 frame_ordered milestone을 기록하지 않습니다.**

frame_ordered는 작가님이 발주 업체에 실제로 주문한 시점에만 기록하며,
그 기록은 작가님이 채팅창에서 직접 하거나 외부 발주 시스템 웹훅으로만 이루어집니다.
고객 메시지로는 절대 트리거되지 않습니다.

고객 톡톡에서 액자 관련 메시지가 오면:
- 배송주소/연락처/수령자 → save_frame_address만 호출
- 사진 선택·요청 ("원목액자는 5042 사진으로", "50번으로 만들어주세요" 등) → [INFO_ONLY]
- 액자 관련 문의, 확인, 감사 인사 → [INFO_ONLY]

## 🔴 긴급 설정 규칙

작가님이 아래와 같은 표현을 사용하는 경우 set_urgent 도구 호출:
- "OOO님 긴급", "긴급 처리", "빠르게 해줘야 해", "급하게 처리" 등
- 날짜 언급 없으면 until_date = 오늘 날짜(KST)
- 날짜 언급 있으면 해당 날짜 사용 (예: "이번 주 금요일까지", "31일까지" 등)

## 📣 홍보동의 감지 규칙

고객이 아래와 같은 의미의 메시지를 보낸 경우 record_promotion_consent 도구 호출:
- 후기/리뷰 작성 의사 표현
- 업로드/인스타/SNS 동의 표현
- 이벤트 참여 의사 표현
- "업로드 하셔도 돼요", "올려도 됩니다" 등

consent_type 판단 기준:
- '홍보o': 제한 없이 전체 동의 ("업로드 동의", "인스타 올려도 돼요" 등)
- '홍보o-아기만': 아기 사진만 동의 명시 ("아기 사진만", "아기꺼만" 등)
- '홍보o-특정사진만': 특정 사진 지정 ("이 사진만", "9956번 사진" 등 특정 컷 언급)

주의: 홍보동의와 무관한 일반 대화나 보정 요청이 혼재된 경우에도
홍보동의 내용이 포함되어 있으면 record_promotion_consent 호출.

## 응답 가이드 (반드시 준수)

당신의 응답은 채팅창에 표시됩니다. 작가님이 폰에서 빠르게 보고 판단합니다.
한국어로, 짧고 명확하게. 마크다운 헤더(##, **) 사용 X.
긴 분석 X. 핵심만 1~3문장.

응답 분류 (정확히 하나 선택):

### 1. 도구 호출 (auto_processed)
- 메시지가 명확한 milestone 이벤트이고 즉시 기록 가능할 때
- record_milestone 등 도구를 호출
- 텍스트는 도구 호출 결과 한 줄 요약 ("S5a 추가보정요청 기록")

### 2. 작가님 확인 요청 (awaiting_confirm)
- milestone 후보가 명확하지만 작가님 확인이 필요할 때
- 또는 모호해서 작가님 판단이 필요할 때
- 응답 끝에 반드시 [CONFIRM_ACTION] 마커 + JSON:

형식 예시:
\`\`\`
허희정님 추가보정 요청으로 보입니다 (보정본 발송 후 2일).
'독사진 좀 더 밝게 수정' 내용으로 S5a 기록할까요?
[CONFIRM_ACTION]
{"type":"record_milestone","milestone_type":"revision_requested","content":"독사진 좀 더 밝게 수정","require_confirmation":true}
\`\`\`

milestone_type 값 (반드시 _at 없이):
shoot, original_sent, selection_received, retouched_sent,
revision_requested, revision_no_more, revision_sent, frame_ordered

content는 작가님 메모용 짧은 요약 (메시지 일부 발췌).
JSON은 한 줄, 닫는 중괄호까지 정확히.

### 3. 단순 보고 (info_only)
- milestone 변경 없이 단순 인지/잡담일 때
- "잘 받았어요" 같이 직전 milestone 확인 메시지
- 응답 시작에 [INFO_ONLY] 마커
- 한 줄 요약: "[INFO_ONLY] 보정본 수령 확인"
- ⚠️ "작가님께 확인 요청" 같은 문구가 들어가면 절대 INFO_ONLY 아님

### 4. 중복 흐름 (duplicate)
- 같은 메시지가 ai_chat 히스토리에 이미 처리된 경우
- 응답 시작에 [DUPLICATE] 마커
- 한 줄: "[DUPLICATE] 이미 처리한 흐름"

⚠️ 분류 우선순위:
1. 명확하면 도구 호출
2. 액션이 보이면 awaiting_confirm + [CONFIRM_ACTION]
3. 액션 없으면 info_only
4. 중복 명백하면 duplicate

⚠️ 마커는 정확히. 잘못된 마커는 awaiting_confirm으로 처리됩니다.
⚠️ 한국어 응답. 마크다운 헤더 사용 X. 짧게.`;
}

// ─── [CONFIRM_ACTION] 마커 파싱 ──────────────────────────────────────

function extractConfirmAction(text: string): {
	cleaned: string;
	action: ConfirmActionPayload | null;
} {
	const MARKER = '[CONFIRM_ACTION]';
	const markerIndex = text.indexOf(MARKER);
	if (markerIndex === -1) {
		return { cleaned: text, action: null };
	}

	const beforeMarker = text.substring(0, markerIndex).trim();
	const afterMarker = text.substring(markerIndex + MARKER.length);

	// 첫 '{' 부터 균형 잡힌 '}'까지 추출
	const startBrace = afterMarker.indexOf('{');
	if (startBrace === -1) {
		return { cleaned: beforeMarker, action: null };
	}

	let depth = 0;
	let endIdx = -1;
	for (let i = startBrace; i < afterMarker.length; i++) {
		const ch = afterMarker[i];
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) {
				endIdx = i;
				break;
			}
		}
	}

	if (endIdx === -1) {
		return { cleaned: beforeMarker, action: null };
	}

	const jsonOnly = afterMarker.substring(startBrace, endIdx + 1);

	try {
		const parsed = JSON.parse(jsonOnly) as ConfirmActionPayload;
		console.log(
			`[ai] CONFIRM_ACTION 추출 성공: type=${parsed.type} milestone_type=${parsed.milestone_type}`,
		);
		return { cleaned: beforeMarker, action: parsed };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.warn(`[ai] [CONFIRM_ACTION] JSON parse failed: ${reason}`);
		return { cleaned: beforeMarker, action: null };
	}
}

// ─── 도구 실행 ────────────────────────────────────────────────────────

async function runTool(
	env: Env,
	name: string,
	input: Record<string, any>,
): Promise<unknown> {
	// ai-tools.ts의 Env는 [k:string]:unknown 인덱스 시그니처를 요구해 Cloudflare.Env와
	// 분기됨 — 호출 시점에 any로 캐스트.
	const toolEnv = env as any;
	switch (name) {
		case 'record_milestone':
			return await executeRecordMilestone(toolEnv, input);
		case 'search_customers':
			return await executeSearchCustomers(toolEnv, input);
		case 'update_customer_memo':
			return await executeUpdateCustomerMemo(toolEnv, input);
		case 'add_learned_rule':
			return await executeAddLearnedRule(toolEnv, input);
		case 'save_frame_address':
			return await executeSaveFrameAddress(toolEnv, input);
		case 'record_promotion_consent':
			return await executeRecordPromotionConsent(toolEnv, input);
		case 'set_urgent':
			return await executeSetUrgent(toolEnv, input);
		default:
			return { error: `알 수 없는 도구: ${name}` };
	}
}

// ─── 메인 ──────────────────────────────────────────────────────────────

export async function analyzeWithAI(
	env: Env,
	context: CustomerContext,
): Promise<BatchAnalysisResult> {
	const talkId = context.customer.talk_id;
	const targets = context.talk_history.filter((m) => m.is_target);
	if (targets.length === 0) {
		return { type: 'error', reason: 'no targets' };
	}

	const userMsgText = targets.map((m) => m.message_content ?? '').join('\n');
	const isDataQuery = DATA_QUERY_KEYWORDS.some((kw) => userMsgText.includes(kw));

	const systemPrompt = buildSystemPrompt(context);

	const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
		{ role: 'user', content: userMsgText },
	];

	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	const finalTextParts: string[] = [];
	const toolUsesLog: Array<{ name: string; input: any; result: any }> = [];

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const apiBody: Record<string, unknown> = {
			model: ANTHROPIC_MODEL,
			max_tokens: MAX_OUTPUT_TOKENS,
			temperature: 0,
			system: systemPrompt,
			tools: TOOLS,
			messages,
		};
		if (round === 0 && isDataQuery) {
			apiBody.tool_choice = { type: 'any' };
		}

		let res: Response;
		try {
			res = await fetch(ANTHROPIC_URL, {
				method: 'POST',
				headers: {
					'x-api-key': env.ANTHROPIC_API_KEY,
					'anthropic-version': ANTHROPIC_VERSION,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(apiBody),
				signal: AbortSignal.timeout(AI_TIMEOUT_MS),
			});
		} catch (e: any) {
			const reason = e?.message || 'network error';
			console.log(`[ai] talk_id=${talkId} fetch 실패: ${reason}`);
			return { type: 'error', reason: `API 실패: ${reason}` };
		}

		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			console.log(`[ai] talk_id=${talkId} API 에러 status=${res.status} body=${errText.slice(0, 300)}`);
			return { type: 'error', reason: `API 응답 ${res.status}` };
		}

		let data: AnthropicResponse;
		try {
			data = (await res.json()) as AnthropicResponse;
		} catch {
			return { type: 'error', reason: 'parse error' };
		}

		totalInputTokens += data.usage?.input_tokens ?? 0;
		totalOutputTokens += data.usage?.output_tokens ?? 0;

		const roundTextParts: string[] = [];
		const toolUses: AnthropicToolUseBlock[] = [];
		for (const block of data.content || []) {
			if (block.type === 'text') roundTextParts.push(block.text);
			else if (block.type === 'tool_use') toolUses.push(block);
		}

		console.log(
			`[ai] talk_id=${talkId} round=${round} stop=${data.stop_reason} text=${roundTextParts.length} tools=${toolUses.length}`,
		);

		if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
			finalTextParts.push(...roundTextParts);
			break;
		}

		// 도구 실행 → tool_result 누적
		const toolResults: Array<{
			type: 'tool_result';
			tool_use_id: string;
			content: string;
			is_error?: boolean;
		}> = [];
		for (const tu of toolUses) {
			const result = await runTool(env, tu.name, tu.input);
			toolUsesLog.push({ name: tu.name, input: tu.input, result });
			const isError =
				typeof result === 'object' && result !== null && 'error' in (result as any);
			toolResults.push({
				type: 'tool_result',
				tool_use_id: tu.id,
				content: JSON.stringify(result),
				...(isError ? { is_error: true } : {}),
			});
		}

		messages.push({ role: 'assistant', content: data.content });
		messages.push({ role: 'user', content: toolResults });

		if (round === MAX_TOOL_ROUNDS - 1) {
			finalTextParts.push(...roundTextParts);
		}
	}

	const aiText = finalTextParts.join('\n').trim();

	// 결과 분류
	if (toolUsesLog.length > 0) {
		const summary =
			aiText ||
			`${toolUsesLog.map((t) => t.name).join(', ')} 실행 완료`;
		console.log(
			`[ai] talk_id=${talkId} type=auto_processed tools=${toolUsesLog.length} tokens=${totalInputTokens + totalOutputTokens}`,
		);
		return {
			type: 'auto_processed',
			summary,
			tool_uses: toolUsesLog,
		};
	}

	// DUPLICATE 우선 (가장 명확)
	if (/^\[DUPLICATE\]/i.test(aiText)) {
		console.log(`[ai] talk_id=${talkId} type=duplicate`);
		return { type: 'duplicate' };
	}

	// INFO_ONLY 다음
	if (/^\[INFO_ONLY\]/i.test(aiText)) {
		const summary = aiText.replace(/^\[INFO_ONLY\]\s*/i, '').trim();
		console.log(`[ai] talk_id=${talkId} type=info_only`);
		return { type: 'info_only', summary };
	}

	// 그 외는 awaiting_confirm — [CONFIRM_ACTION] 마커가 있으면 추출
	const { cleaned, action } = extractConfirmAction(aiText);
	console.log(
		`[ai] talk_id=${talkId} type=awaiting_confirm has_action=${action ? 'true' : 'false'}`,
	);
	return {
		type: 'awaiting_confirm',
		ai_text: cleaned || '확인이 필요합니다.',
		confirmation: action,
	};
}

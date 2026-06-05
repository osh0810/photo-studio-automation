/**
 * Phase 3 Step 4-A: 고객 컨텍스트 로더.
 *
 * cron이 사용자별 메시지 배치를 처리할 때, AI에게 넘길 사실관계를 한 번에
 * 모아주는 함수. 이 단계는 "조회만" — 학습 규칙 매칭(4-B), AI 분석(4-C)은
 * 별도 단계.
 */

import type { Env } from '../../types';
import { computeStage, STAGE_LABELS, type BookingRow } from './ai-tools';

// ─── 타입 ──────────────────────────────────────────────────────────────

export type MilestoneKey =
	| 'shoot_date'
	| 'original_sent_at'
	| 'selection_received_at'
	| 'retouched_sent_at'
	| 'revision_requested_at'
	| 'revision_no_more_at'
	| 'revision_sent_at'
	| 'frame_ordered_at';

export interface CustomerContext {
	customer: {
		talk_id: string;
		customer_name: string | null;
		booking_id: string | null;
		milestones: {
			shoot_date: string | null;
			original_sent_at: string | null;
			selection_received_at: string | null;
			retouched_sent_at: string | null;
			revision_requested_at: string | null;
			revision_no_more_at: string | null;
			revision_sent_at: string | null;
			frame_ordered_at: string | null;
		};
		days_since: {
			shoot_date: number | null;
			original_sent_at: number | null;
			selection_received_at: number | null;
			retouched_sent_at: number | null;
			revision_requested_at: number | null;
			revision_no_more_at: number | null;
			revision_sent_at: number | null;
			frame_ordered_at: number | null;
		};
		last_milestone: {
			key: MilestoneKey | null;
			date: string | null;
			days_ago: number | null;
		};
		stage_label: string;
		memo: string | null;
		selection_cuts: string | null;
		revision_content: string | null;
	};
	talk_history: Array<{
		id: number;
		sender_type: 'customer' | 'studio';
		message_content: string | null;
		message_at: string;
		is_target: boolean;
	}>;
	ai_chat_history: Array<{
		sender: string;
		message: string;
		created_at: string;
	}>;
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────

const MILESTONE_PRIORITY: MilestoneKey[] = [
	'frame_ordered_at',
	'revision_sent_at',
	'revision_no_more_at',
	'revision_requested_at',
	'retouched_sent_at',
	'selection_received_at',
	'original_sent_at',
	'shoot_date',
];

function daysSince(dateStr: string | null): number | null {
	if (!dateStr) return null;
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) return null;
	const now = new Date();
	return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

interface CustomerRow {
	talk_id: string;
	customer_name: string | null;
	memo: string | null;
}

// ─── 메인 ──────────────────────────────────────────────────────────────

export async function loadCustomerContext(
	env: Env,
	talkId: string,
	targetMessageIds: number[],
): Promise<CustomerContext> {
	// 환경변수 파싱 + 안전장치
	let days = parseInt(env.AI_CONTEXT_DAYS ?? '14', 10);
	let max = parseInt(env.AI_CONTEXT_MAX_MESSAGES ?? '50', 10);
	if (isNaN(days) || days < 1) days = 14;
	if (isNaN(max) || max < 1) max = 50;

	// a. 고객 + 예약 조회
	const customerRow = await env.DB.prepare(
		`SELECT talk_id, customer_name, memo
		 FROM customers
		 WHERE talk_id = ?1`,
	)
		.bind(talkId)
		.first<CustomerRow>();

	const bookingRow = await env.DB.prepare(
		`SELECT booking_id, talk_id, customer_name,
		        shoot_date, original_sent_at, selection_received_at, selection_cuts,
		        retouched_sent_at, revision_requested_at, revision_content,
		        revision_no_more_at, revision_sent_at, frame_ordered_at,
		        current_stage
		 FROM bookings
		 WHERE talk_id = ?1
		 ORDER BY created_at DESC
		 LIMIT 1`,
	)
		.bind(talkId)
		.first<BookingRow>();

	// b/c. milestones + days_since
	const milestones = {
		shoot_date: bookingRow?.shoot_date ?? null,
		original_sent_at: bookingRow?.original_sent_at ?? null,
		selection_received_at: bookingRow?.selection_received_at ?? null,
		retouched_sent_at: bookingRow?.retouched_sent_at ?? null,
		revision_requested_at: bookingRow?.revision_requested_at ?? null,
		revision_no_more_at: bookingRow?.revision_no_more_at ?? null,
		revision_sent_at: bookingRow?.revision_sent_at ?? null,
		frame_ordered_at: bookingRow?.frame_ordered_at ?? null,
	};
	const days_since = {
		shoot_date: daysSince(milestones.shoot_date),
		original_sent_at: daysSince(milestones.original_sent_at),
		selection_received_at: daysSince(milestones.selection_received_at),
		retouched_sent_at: daysSince(milestones.retouched_sent_at),
		revision_requested_at: daysSince(milestones.revision_requested_at),
		revision_no_more_at: daysSince(milestones.revision_no_more_at),
		revision_sent_at: daysSince(milestones.revision_sent_at),
		frame_ordered_at: daysSince(milestones.frame_ordered_at),
	};

	// d. last_milestone
	let lastKey: MilestoneKey | null = null;
	for (const k of MILESTONE_PRIORITY) {
		if (milestones[k]) {
			lastKey = k;
			break;
		}
	}
	const last_milestone = {
		key: lastKey,
		date: lastKey ? milestones[lastKey] : null,
		days_ago: lastKey ? days_since[lastKey] : null,
	};

	// e. stage_label
	const stage = bookingRow ? computeStage(bookingRow) : 'S0';
	const stage_label = STAGE_LABELS[stage] || stage;

	// f. talk_history
	const talkHistoryResult = await env.DB.prepare(
		`SELECT id, sender_type, message_content, message_at
		 FROM talk_messages
		 WHERE talk_id = ?1
		   AND strftime('%Y-%m-%d %H:%M:%S', message_at) >= datetime('now', '-' || ?2 || ' days')
		 ORDER BY message_at ASC
		 LIMIT ?3`,
	)
		.bind(talkId, days, max)
		.all<{
			id: number;
			sender_type: string;
			message_content: string | null;
			message_at: string;
		}>();

	const targetSet = new Set(targetMessageIds);
	const talk_history = (talkHistoryResult.results || []).map((r) => ({
		id: r.id,
		sender_type: (r.sender_type === 'studio' ? 'studio' : 'customer') as
			| 'customer'
			| 'studio',
		message_content: r.message_content,
		message_at: r.message_at,
		is_target: targetSet.has(r.id),
	}));

	// g. ai_chat_history (json_extract 사용)
	const aiChatResult = await env.DB.prepare(
		`SELECT sender, message, created_at
		 FROM ai_chat_messages
		 WHERE metadata IS NOT NULL
		   AND json_extract(metadata, '$.talk_id') = ?1
		 ORDER BY created_at DESC
		 LIMIT 10`,
	)
		.bind(talkId)
		.all<{ sender: string; message: string; created_at: string }>();

	const ai_chat_history = (aiChatResult.results || []).slice().reverse();

	// 6. 로그
	const customerName = customerRow?.customer_name ?? bookingRow?.customer_name ?? null;
	const lastDesc = lastKey ? `${lastKey}(${last_milestone.days_ago}일 전)` : 'null';
	console.log(
		`[ctx] talk_id=${talkId} customer=${customerName ?? '미등록'} ` +
			`booking=${bookingRow?.booking_id ?? 'null'} ` +
			`last_ms=${lastDesc} talk=${talk_history.length}건 ai_chat=${ai_chat_history.length}건`,
	);

	return {
		customer: {
			talk_id: talkId,
			customer_name: customerName,
			booking_id: bookingRow?.booking_id ?? null,
			milestones,
			days_since,
			last_milestone,
			stage_label,
			memo: customerRow?.memo ?? null,
			selection_cuts: bookingRow?.selection_cuts ?? null,
			revision_content: bookingRow?.revision_content ?? null,
		},
		talk_history,
		ai_chat_history,
	};
}

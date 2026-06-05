/**
 * Phase 3 Step 4-B: 학습 규칙 매칭 엔진.
 *
 * cron 배치에서 모인 target 메시지(들)이 ai_learned_rules의 활성 규칙 중
 * 어느 하나라도 매칭되는지 판단. 매칭 시 첫 번째 규칙(created_at ASC 우선)을
 * 반환. AI 호출 없이 빠르게 분기하기 위한 사전 단계.
 *
 * 이 모듈은 "검사만" — 규칙 적용 카운트(incrementRuleApplyCount)는
 * 실제 처리 성공 시점(4-C)에서 별도 호출.
 */

import type { Env } from '../../types';
import type { CustomerContext, MilestoneKey } from './customer-context';

// ─── 타입 ──────────────────────────────────────────────────────────────

export interface RuleConditions {
	text_contains_any?: string[];
	text_contains_all?: string[];
	text_regex?: string;
	has_milestones?: MilestoneKey[];
	missing_milestones?: MilestoneKey[];
	days_since?: {
		milestone: MilestoneKey;
		min_days?: number;
		max_days?: number;
	};
}

export interface RuleAction {
	type: 'record_milestone';
	milestone_type: MilestoneKey;
	use_message_as_content?: boolean;
	require_confirmation: boolean;
}

export type RuleMatchResult =
	| {
			matched: true;
			rule_id: number;
			rule_type: 'auto_process' | 'confirm_required';
			rule_description: string;
			action: RuleAction;
			require_confirmation: boolean;
			matched_message_ids: number[];
			matched_text: string;
	  }
	| {
			matched: false;
	  };

interface RuleRow {
	id: number;
	rule_type: string;
	pattern_description: string;
	conditions: string | null;
	action: string | null;
}

// ─── 스키마 검증 헬퍼 ──────────────────────────────────────────────────

const VALID_MILESTONE_KEYS: MilestoneKey[] = [
	'shoot_date',
	'original_sent_at',
	'selection_received_at',
	'retouched_sent_at',
	'revision_requested_at',
	'revision_no_more_at',
	'revision_sent_at',
	'frame_ordered_at',
];

function hasAnyV3Condition(c: RuleConditions): boolean {
	return (
		(c.text_contains_any?.length ?? 0) > 0 ||
		(c.text_contains_all?.length ?? 0) > 0 ||
		!!c.text_regex ||
		(c.has_milestones?.length ?? 0) > 0 ||
		(c.missing_milestones?.length ?? 0) > 0 ||
		!!c.days_since
	);
}

function isValidAction(action: any): action is RuleAction {
	return (
		!!action &&
		action.type === 'record_milestone' &&
		typeof action.milestone_type === 'string' &&
		(VALID_MILESTONE_KEYS as string[]).includes(action.milestone_type) &&
		typeof action.require_confirmation === 'boolean'
	);
}

// ─── 조건 검사 ─────────────────────────────────────────────────────────

function checkConditions(
	conditions: RuleConditions,
	targetText: string,
	customer: CustomerContext['customer'],
): boolean {
	// text_contains_any (1개 이상 포함)
	if (conditions.text_contains_any?.length) {
		const hit = conditions.text_contains_any.some((kw) => targetText.includes(kw));
		if (!hit) return false;
	}

	// text_contains_all (모두 포함)
	if (conditions.text_contains_all?.length) {
		const allHit = conditions.text_contains_all.every((kw) => targetText.includes(kw));
		if (!allHit) return false;
	}

	// text_regex
	if (conditions.text_regex) {
		try {
			const re = new RegExp(conditions.text_regex);
			if (!re.test(targetText)) return false;
		} catch (e) {
			console.warn(`[rule] invalid regex: ${conditions.text_regex}`);
			return false;
		}
	}

	// has_milestones (모두 not null)
	if (conditions.has_milestones?.length) {
		const allHave = conditions.has_milestones.every(
			(key) => customer.milestones[key] !== null,
		);
		if (!allHave) return false;
	}

	// missing_milestones (모두 null)
	if (conditions.missing_milestones?.length) {
		const allMissing = conditions.missing_milestones.every(
			(key) => customer.milestones[key] === null,
		);
		if (!allMissing) return false;
	}

	// days_since
	if (conditions.days_since) {
		const { milestone, min_days, max_days } = conditions.days_since;
		const days = customer.days_since[milestone];
		if (days === null || days === undefined) return false;
		if (min_days !== undefined && days < min_days) return false;
		if (max_days !== undefined && days > max_days) return false;
	}

	return true;
}

// ─── 메인 ──────────────────────────────────────────────────────────────

export async function matchLearnedRule(
	env: Env,
	context: CustomerContext,
): Promise<RuleMatchResult> {
	const talkId = context.customer.talk_id;

	// a. target 메시지 추출
	const targets = context.talk_history.filter((m) => m.is_target);
	if (targets.length === 0) {
		console.log(`[rule] talk_id=${talkId} target=0건 → 매칭 없음`);
		return { matched: false };
	}

	// b. 미등록 고객 가드 — booking_id 없으면 milestone 정보가 없어 규칙 매칭이 위험.
	//    AI가 직접 판단하도록 넘긴다.
	if (!context.customer.booking_id) {
		console.log(
			`[rule] talk_id=${talkId} 미등록 고객 → 학습 규칙 스킵 (AI에 위임)`,
		);
		return { matched: false };
	}

	const targetText = targets.map((m) => m.message_content ?? '').join('\n');
	const targetIds = targets.map((m) => m.id);

	// c. 활성 규칙 조회 (먼저 만든 규칙 우선)
	const result = await env.DB.prepare(
		`SELECT id, rule_type, pattern_description, conditions, action
		 FROM ai_learned_rules
		 WHERE is_active = 1
		 ORDER BY created_at ASC`,
	).all<RuleRow>();

	const rules = result.results || [];
	console.log(
		`[rule] talk_id=${talkId} target=${targets.length}건 후보 ${rules.length}개 검사 시작`,
	);

	// d. 각 규칙 순회
	for (const row of rules) {
		// conditions JSON 파싱
		let parsedConditions: RuleConditions;
		try {
			parsedConditions = row.conditions ? JSON.parse(row.conditions) : {};
		} catch (e) {
			console.warn(`[rule] 규칙 #${row.id} conditions JSON 파싱 실패 → 스킵`);
			continue;
		}

		// action JSON 파싱
		let parsedAction: any;
		try {
			if (!row.action) {
				console.warn(`[rule] 규칙 #${row.id} action 비어 있음 → 스킵`);
				continue;
			}
			parsedAction = JSON.parse(row.action);
		} catch (e) {
			console.warn(`[rule] 규칙 #${row.id} action JSON 파싱 실패 → 스킵`);
			continue;
		}

		// 빈 conditions 가드 — v3 스키마 키가 하나도 없으면 옛 데이터로 간주
		if (!hasAnyV3Condition(parsedConditions)) {
			console.warn(
				`[rule] 규칙 #${row.id} conditions 비어있음 (또는 v3 스키마 아님) → 스킵`,
			);
			continue;
		}

		// action 스키마 검증
		if (!isValidAction(parsedAction)) {
			console.warn(
				`[rule] 규칙 #${row.id} action 스키마 위반 (v3 형식 아님) → 스킵 ` +
					`(받은 action: ${JSON.stringify(parsedAction)})`,
			);
			continue;
		}

		// 조건 검사
		if (!checkConditions(parsedConditions, targetText, context.customer)) {
			continue;
		}

		// d. 매칭 — require_confirmation 결정 (OR)
		const ruleType: 'auto_process' | 'confirm_required' =
			row.rule_type === 'confirm_required' ? 'confirm_required' : 'auto_process';
		const requireConfirmation =
			ruleType === 'confirm_required' || parsedAction.require_confirmation === true;

		console.log(
			`[rule] talk_id=${talkId} 매칭=#${row.id} desc='${row.pattern_description}' type=${ruleType}`,
		);

		return {
			matched: true,
			rule_id: row.id,
			rule_type: ruleType,
			rule_description: row.pattern_description,
			action: parsedAction,
			require_confirmation: requireConfirmation,
			matched_message_ids: targetIds,
			matched_text: targetText,
		};
	}

	console.log(`[rule] talk_id=${talkId} 매칭 없음 (검사한 규칙 ${rules.length}개)`);
	return { matched: false };
}

// ─── 적용 카운트 갱신 (4-C에서 호출) ─────────────────────────────────

export async function incrementRuleApplyCount(
	env: Env,
	ruleId: number,
): Promise<void> {
	await env.DB.prepare(
		`UPDATE ai_learned_rules
		 SET apply_count = apply_count + 1,
		     last_applied_at = datetime('now')
		 WHERE id = ?1`,
	)
		.bind(ruleId)
		.run();
}

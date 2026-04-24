/**
 * `_원본백업` 시트에 대한 도메인 래퍼.
 *
 * 핵심 책임 두 가지:
 *  1. webhook 수신 즉시 원본을 시트에 박는다 — 시스템 전체에서 가장 먼저
 *     성공해야 하는 단계. 실패 시 `CriticalBackupError` 로 별도 식별해
 *     호출 측이 #긴급에러 채널로 즉시 띄울 수 있게 한다.
 *  2. 백업 행의 처리상태/메타 컬럼만 부분 갱신한다 — 추후 webhook 핸들러가
 *     처리 결과(완료/검토필요/실패 등)를 같은 행에 기록할 때 사용.
 *
 * 행 번호는 1)에서 받은 값을 그대로 들고 다닌다 — `messageId` 기반 재검색은
 * 굳이 하지 않는다 (호출 한 번 더 들고 race도 생김).
 */

import { withRetry } from "../lib/retry";
import {
	BACKUP_COLUMNS,
	type BackupColumn,
	type BackupRow,
	type Env,
	type ProcessingStatus,
} from "../types";
import { appendBackupRowReturnRow, updateRange } from "./sheets";

const BACKUP_SHEET = "_원본백업";

export class CriticalBackupError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "CriticalBackupError";
	}
}

/**
 * 네이버 톡톡 파트너 webhook 실제 스키마 (send 이벤트 기준).
 *   - `user` 는 **문자열**(톡톡 사용자 고유 ID) — 객체 아님. 이름은 페이로드에 없음.
 *   - `messageId` 는 실제론 number 로 오지만, 상위 스키마 변동 대비 string|number 로 받는다.
 *     시트/dedup 쪽은 전부 string 기준이라 `String()` 로 강제 변환해 흡수한다.
 *   - `textContent.text` 가 실제 메시지 본문.
 *   - 타입 레이블(메시지타입) 은 페이로드에 없음 — 현재는 "text" 로 고정.
 *     이미지/파일 이벤트 shape 는 별도 샘플 확보 후 확장.
 *   - `event` 가 `"send"` 외 값(예: `"leave"`, `"friend"`)이면 webhook 진입점에서
 *     백업만 남기고 파이프라인은 스킵. 비-send 이벤트도 무조건 200 OK.
 */
export interface RawWebhookPayload {
	event?: string;
	user?: string;
	messageId?: string | number;
	textContent?: { text?: string; inputType?: string };
	options?: Record<string, unknown>;
	[k: string]: unknown;
}

export interface BackupStatusExtras {
	처리시각?: string;
	매칭고객ID?: string;
	분류결과?: string;
	에러메시지?: string;
}

function nowKstTimestamp(): string {
	const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
		`${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
	);
}

function columnLetter(index: number): string {
	if (index < 0 || index > 25) throw new Error(`Backup column index out of range: ${index}`);
	return String.fromCharCode(65 + index);
}

export async function backupWebhookPayload(
	env: Env,
	payload: RawWebhookPayload,
): Promise<{ rowNumber: number }> {
	const backup: Partial<BackupRow> = {
		수신시각: nowKstTimestamp(),
		톡톡UserID: payload.user ?? "",
		// 페이로드에 이름 없음. 컬럼은 유지 — 추후 Profile API 로 보강 예정.
		톡톡UserName: "",
		// send 이벤트만 본문 있음. 타입은 현재 "text" 고정 (이미지/파일 shape 미확인).
		메시지타입: payload.textContent ? "text" : "",
		메시지원문: payload.textContent?.text ?? "",
		WebhookJSON: JSON.stringify(payload),
		처리상태: "대기",
		메시지ID: String(payload.messageId ?? ""),
	};

	try {
		return await withRetry(() => appendBackupRowReturnRow(env, backup));
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new CriticalBackupError(`_원본백업 시트 기록 실패: ${reason}`, err);
	}
}

/**
 * 처리상태 + 보조 컬럼만 갱신. extras에서 명시되지 않은 컬럼은 건드리지
 * 않는다 (한 번에 묶어 PUT 하면 빈 컬럼이 기존 값을 덮어쓸 수 있음).
 * 컬럼이 5개 이하라 셀 단위 update 비용은 충분히 감수 가능.
 */
export async function updateBackupStatus(
	env: Env,
	rowNumber: number,
	status: ProcessingStatus,
	extras: BackupStatusExtras = {},
): Promise<void> {
	const updates: Partial<Record<BackupColumn, string>> = {
		처리상태: status,
		처리시각: extras.처리시각 ?? nowKstTimestamp(),
	};
	if (extras.매칭고객ID !== undefined) updates.매칭고객ID = extras.매칭고객ID;
	if (extras.분류결과 !== undefined) updates.분류결과 = extras.분류결과;
	if (extras.에러메시지 !== undefined) updates.에러메시지 = extras.에러메시지;

	for (const col of Object.keys(updates) as BackupColumn[]) {
		const value = updates[col];
		if (value === undefined) continue;
		const index = BACKUP_COLUMNS.indexOf(col);
		if (index < 0) continue;
		const range = `${BACKUP_SHEET}!${columnLetter(index)}${rowNumber}`;
		await withRetry(() => updateRange(env, range, [[value]]));
	}
}

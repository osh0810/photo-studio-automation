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

/** 네이버 톡톡 webhook 가짜 스키마 — 실제 명세는 미정이라 광범위하게 받는다. */
export interface RawWebhookPayload {
	user?: { id?: string; name?: string };
	message?: { id?: string; text?: string; type?: string };
	timestamp?: string | number;
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
		톡톡UserID: payload.user?.id ?? "",
		톡톡UserName: payload.user?.name ?? "",
		메시지타입: payload.message?.type ?? "",
		메시지원문: payload.message?.text ?? "",
		WebhookJSON: JSON.stringify(payload),
		처리상태: "대기",
		메시지ID: payload.message?.id ?? "",
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

/**
 * Phase 6-B Drive 연동: Google Drive API 래퍼.
 *
 * - 인증: getValidAccessToken(env) 재사용 (Gmail/Calendar와 공용 refresh token)
 * - drive scope 필요 (폴더명 rename 포함)
 */

import { getValidAccessToken } from './google-tokens';

interface Env {
	DB: D1Database;
	GOOGLE_OAUTH_CLIENT_ID: string;
	GOOGLE_OAUTH_CLIENT_SECRET: string;
	[key: string]: unknown;
}

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	parents?: string[];
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

async function authedFetch(env: Env, url: string): Promise<Response> {
	const token = await getValidAccessToken(env);
	if (!token) {
		throw new Error(
			'Google access token 없음 — /auth/google?reauth=1 필요',
		);
	}
	return fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
	});
}

async function authedPatch(env: Env, url: string, body: unknown): Promise<Response> {
	const token = await getValidAccessToken(env);
	if (!token) {
		throw new Error(
			'Google access token 없음 — /auth/google?reauth=1 필요',
		);
	}
	return fetch(url, {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
}

async function readError(res: Response, op: string): Promise<Error> {
	const text = await res.text().catch(() => '');
	if (res.status === 401) {
		return new Error(
			`Drive API ${op}: 401 — Drive 접근 권한 없음. /auth/google?reauth=1 재인증 필요`,
		);
	}
	if (res.status === 403) {
		return new Error(
			`Drive API ${op}: 403 — 해당 폴더에 접근 권한 없음 (서비스 계정/공유 설정 확인)`,
		);
	}
	return new Error(
		`Drive API ${op} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
	);
}

/**
 * 폴더/파일 메타데이터 조회 (id, name, parents, mimeType).
 */
export async function getFolderInfo(
	env: Env,
	folderId: string,
): Promise<DriveFile> {
	const url =
		`${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}` +
		`?fields=id,name,parents,mimeType`;
	const res = await authedFetch(env, url);
	if (!res.ok) throw await readError(res, 'getFolderInfo');
	return (await res.json()) as DriveFile;
}

/**
 * 폴더 내 하위 파일/폴더 목록 (trash 제외).
 */
export async function getFolderChildren(
	env: Env,
	folderId: string,
): Promise<{ files: DriveFile[] }> {
	const q = encodeURIComponent(
		`'${folderId}' in parents and trashed=false`,
	);
	const url =
		`${DRIVE_API_BASE}/files` +
		`?q=${q}` +
		`&fields=files(id,name,mimeType)`;
	const res = await authedFetch(env, url);
	if (!res.ok) throw await readError(res, 'getFolderChildren');
	return (await res.json()) as { files: DriveFile[] };
}

/**
 * 부모 폴더 정보. parents가 없거나 비어있으면 null.
 */
export async function getParentFolder(
	env: Env,
	folderId: string,
): Promise<DriveFile | null> {
	const info = await getFolderInfo(env, folderId);
	const parentId = info.parents && info.parents[0];
	if (!parentId) return null;
	return await getFolderInfo(env, parentId);
}

/**
 * 파일/폴더의 상위 폴더 ID 반환. parents가 없으면 null.
 */
export async function getParentFolderId(
	env: Env,
	folderId: string,
): Promise<string | null> {
	const info = await getFolderInfo(env, folderId);
	return (info.parents && info.parents[0]) ?? null;
}

/**
 * 홍보동의 유형에 따라 Drive 폴더명에 동의 표시 삽입.
 * 이미 '(홍보o' 포함된 경우 → 현재 이름 그대로 반환 (멱등성).
 * 삽입 위치: 고객명 직후 첫 번째 '(' 앞.
 * 예: '20260525 양서진님(클래식아기,누드)' → '20260525 양서진님(홍보o)(클래식아기,누드)'
 */
export async function renameFolderWithPromotion(
	env: Env,
	folderId: string,
	promotionType: string,
): Promise<string> {
	const info = await getFolderInfo(env, folderId);
	const currentName = info.name;

	if (currentName.includes('(홍보o')) {
		return currentName;
	}

	const badge = `(${promotionType})`;
	const parenIdx = currentName.indexOf('(');
	const newName =
		parenIdx === -1
			? currentName + badge
			: currentName.slice(0, parenIdx) + badge + currentName.slice(parenIdx);

	const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}`;
	const res = await authedPatch(env, url, { name: newName });
	if (!res.ok) throw await readError(res, 'renameFolderWithPromotion');

	return newName;
}

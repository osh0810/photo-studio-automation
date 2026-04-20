/**
 * Google Sheets API v4 클라이언트.
 * Service Account JWT(RS256) → OAuth access token → Sheets REST.
 * Workers 런타임에는 Node crypto가 없으므로 Web Crypto API만 사용한다.
 */

import {
	BACKUP_COLUMNS,
	CUSTOMER_COLUMNS,
	formatStage,
	parseStage,
	type BackupColumn,
	type BackupRow,
	type Customer,
	type CustomerColumn,
	type Env,
} from "../types/index";

export class SheetsAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SheetsAuthError";
	}
}

export class SheetsApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body: string,
	) {
		super(message);
		this.name = "SheetsApiError";
	}
}

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64urlEncode(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncodeString(value: string): string {
	return base64urlEncode(new TextEncoder().encode(value));
}

function pemToPkcs8(pem: string): Uint8Array {
	// wrangler secret / .dev.vars 는 줄바꿈을 문자 그대로 `\n`으로 저장하는 경우가 많다.
	const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
	const body = normalized
		.replace(/-----BEGIN PRIVATE KEY-----/g, "")
		.replace(/-----END PRIVATE KEY-----/g, "")
		.replace(/\s+/g, "");
	if (!body) throw new SheetsAuthError("Empty PEM body — check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
	const binary = atob(body);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function signJwt(email: string, privateKeyPem: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		iss: email,
		scope: SHEETS_SCOPE,
		aud: OAUTH_TOKEN_URL,
		iat: now,
		exp: now + 3600,
	};
	const signingInput = `${base64urlEncodeString(JSON.stringify(header))}.${base64urlEncodeString(
		JSON.stringify(payload),
	)}`;

	const keyBytes = pemToPkcs8(privateKeyPem);
	const cryptoKey = await crypto.subtle.importKey(
		"pkcs8",
		keyBytes,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${base64urlEncode(signature)}`;
}

async function exchangeJwtForAccessToken(
	jwt: string,
): Promise<{ token: string; expiresIn: number }> {
	const res = await fetch(OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new SheetsAuthError(`OAuth token exchange failed (${res.status}): ${body}`);
	}
	const data = (await res.json()) as { access_token?: string; expires_in?: number };
	if (!data.access_token || !data.expires_in) {
		throw new SheetsAuthError(`OAuth token response missing fields: ${JSON.stringify(data)}`);
	}
	return { token: data.access_token, expiresIn: data.expires_in };
}

export async function getAccessToken(env: Env): Promise<string> {
	if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS) {
		return cachedToken.token;
	}
	try {
		const jwt = await signJwt(
			env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
			env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
		);
		const { token, expiresIn } = await exchangeJwtForAccessToken(jwt);
		cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
		return token;
	} catch (err) {
		if (err instanceof SheetsAuthError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		throw new SheetsAuthError(`Failed to obtain access token: ${message}`);
	}
}

/** 테스트 / 수동 디버깅용. 프로덕션 경로에서는 호출하지 않는다. */
export function __resetTokenCache(): void {
	cachedToken = null;
}

// ─── Sheets REST helpers ────────────────────────────────────────────────

const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

function spreadsheetUrl(env: Env, pathAndQuery: string): string {
	return `${SHEETS_BASE_URL}/${env.GOOGLE_SHEETS_ID}${pathAndQuery}`;
}

async function sheetsFetch(
	env: Env,
	url: string,
	init: RequestInit,
	operation: string,
): Promise<Response> {
	const token = await getAccessToken(env);
	const res = await fetch(url, {
		...init,
		headers: {
			...init.headers,
			authorization: `Bearer ${token}`,
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new SheetsApiError(
			`Sheets ${operation} failed (${res.status})`,
			res.status,
			body,
		);
	}
	return res;
}

/**
 * Sheets A1 range (`고객목록!A2:Y`) 는 시트명에 한글 등 non-ASCII가 들어가므로
 * URL path에 그대로 넣으면 400이 난다. 컴포넌트 단위로 percent-encode 한다.
 */
function encodeRange(range: string): string {
	return encodeURIComponent(range);
}

export async function readRange(env: Env, range: string): Promise<string[][]> {
	const res = await sheetsFetch(
		env,
		spreadsheetUrl(env, `/values/${encodeRange(range)}`),
		{ method: "GET" },
		`readRange(${range})`,
	);
	const data = (await res.json()) as { values?: string[][] };
	return data.values ?? [];
}

export async function appendRow(
	env: Env,
	sheetName: string,
	values: string[],
): Promise<void> {
	const url = spreadsheetUrl(
		env,
		`/values/${encodeRange(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
	);
	await sheetsFetch(
		env,
		url,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values: [values] }),
		},
		`appendRow(${sheetName})`,
	);
}

export async function updateRange(
	env: Env,
	range: string,
	values: string[][],
): Promise<void> {
	const url = spreadsheetUrl(
		env,
		`/values/${encodeRange(range)}?valueInputOption=USER_ENTERED`,
	);
	await sheetsFetch(
		env,
		url,
		{
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values }),
		},
		`updateRange(${range})`,
	);
}

// ─── Domain helpers ─────────────────────────────────────────────────────

const CUSTOMER_SHEET = "고객목록";
const BACKUP_SHEET = "_원본백업";
const CUSTOMER_RANGE_ALL = `${CUSTOMER_SHEET}!A2:Y`;
const TALK_ID_INDEX = CUSTOMER_COLUMNS.indexOf("톡톡ID");

function columnLetter(index: number): string {
	// 현재 스키마는 25컬럼(A..Y)이라 한 글자로 충분. 26을 넘기면 다시 설계.
	if (index < 0 || index > 25) throw new Error(`Column index out of range: ${index}`);
	return String.fromCharCode(65 + index);
}

/** KST(UTC+9) 기준 `YYYY-MM-DD HH:mm:ss`. Workers 런타임은 기본 UTC라 수동 환산. */
function nowKstTimestamp(): string {
	const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
		`${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
	);
}

function rowToCustomer(row: string[]): Customer {
	const out: Record<string, string> = {};
	for (let i = 0; i < CUSTOMER_COLUMNS.length; i++) {
		out[CUSTOMER_COLUMNS[i]] = row[i] ?? "";
	}
	// 시트에는 `"S2 원본발송"` 라벨로 저장돼 있을 수 있다 — 내부 로직이 기대하는
	// enum 코드(`"S2"`)로 되돌린다. 매칭 실패/빈 값은 `""` 로 떨어져 기존 타입
	// `CustomerStage | ""` 과 호환.
	const parsed = parseStage(out["현재단계"] ?? "");
	out["현재단계"] = parsed ?? "";
	return out as Customer;
}

/**
 * 시트에 저장할 때 enum 코드(`"S2"`)를 라벨(`"S2 원본발송"`)로 변환.
 * 이미 라벨 형태거나 enum 미등록 값이면 그대로 둔다 — parseStage 로 한 번
 * 복원을 시도해보고 실패하면 원본 문자열을 유지.
 */
function stageCellForWrite(raw: string): string {
	const code = parseStage(raw);
	if (!code) return raw;
	return formatStage(code);
}

export async function searchCustomerByTalkId(
	env: Env,
	talkId: string,
): Promise<{ rowNumber: number; data: Customer } | null> {
	const rows = await readRange(env, CUSTOMER_RANGE_ALL);
	for (let i = 0; i < rows.length; i++) {
		if (rows[i][TALK_ID_INDEX] === talkId) {
			// 시트 헤더가 1행이므로 데이터 첫 행(i=0)은 실제로 2행.
			return { rowNumber: i + 2, data: rowToCustomer(rows[i]) };
		}
	}
	return null;
}

export async function appendCustomerRow(
	env: Env,
	customer: Partial<Customer>,
): Promise<void> {
	const now = nowKstTimestamp();
	const merged: Partial<Customer> = {
		...customer,
		등록일시: customer.등록일시 || now,
		최종수정일시: now,
	};
	const row = CUSTOMER_COLUMNS.map((col) => {
		const raw = String(merged[col] ?? "");
		return col === "현재단계" ? stageCellForWrite(raw) : raw;
	});
	await appendRow(env, CUSTOMER_SHEET, row);
}

export async function updateCustomerCells(
	env: Env,
	rowNumber: number,
	updates: Partial<Customer>,
): Promise<void> {
	const patched: Partial<Customer> = { ...updates, 최종수정일시: nowKstTimestamp() };
	for (const col of Object.keys(patched) as CustomerColumn[]) {
		const value = patched[col];
		if (value === undefined) continue;
		const index = CUSTOMER_COLUMNS.indexOf(col);
		if (index < 0) throw new Error(`Unknown customer column: ${col}`);
		const raw = String(value);
		const cell = col === "현재단계" ? stageCellForWrite(raw) : raw;
		const range = `${CUSTOMER_SHEET}!${columnLetter(index)}${rowNumber}`;
		await updateRange(env, range, [[cell]]);
	}
}

export async function appendBackupRow(
	env: Env,
	backup: Partial<BackupRow>,
): Promise<void> {
	const row = BACKUP_COLUMNS.map((col: BackupColumn) => String(backup[col] ?? ""));
	await appendRow(env, BACKUP_SHEET, row);
}

/**
 * `appendBackupRow` 와 동일하지만 Sheets `values.append` 응답의
 * `updates.updatedRange` 를 파싱해 행 번호를 돌려준다 — 이후
 * `updateBackupStatus` 가 같은 행을 추가 호출 없이 갱신할 수 있게
 * 만들기 위한 변형. 기존 `appendBackupRow` 는 호환 위해 그대로 둠.
 *
 * `updatedRange` 형식 예: `_원본백업!A5:L5` 또는 시트명에 공백/특수문자가
 * 있을 때 `'시트 명'!A5:L5`. 마지막 `!` 이후의 셀 부분에서 첫 행 번호만
 * 뽑는 방식이 가장 견고하다.
 */
export async function appendBackupRowReturnRow(
	env: Env,
	backup: Partial<BackupRow>,
): Promise<{ rowNumber: number }> {
	const row = BACKUP_COLUMNS.map((col: BackupColumn) => String(backup[col] ?? ""));
	const url = spreadsheetUrl(
		env,
		`/values/${encodeRange(BACKUP_SHEET)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
	);
	const res = await sheetsFetch(
		env,
		url,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ values: [row] }),
		},
		`appendBackupRowReturnRow(${BACKUP_SHEET})`,
	);
	const data = (await res.json()) as {
		updates?: { updatedRange?: string };
	};
	const updatedRange = data.updates?.updatedRange ?? "";
	const lastBang = updatedRange.lastIndexOf("!");
	const cellPart = lastBang >= 0 ? updatedRange.slice(lastBang + 1) : updatedRange;
	const match = cellPart.match(/^[A-Z]+(\d+)/);
	if (!match) {
		throw new SheetsApiError(
			`appendBackupRowReturnRow: updatedRange 파싱 실패 (${updatedRange})`,
			200,
			updatedRange,
		);
	}
	return { rowNumber: parseInt(match[1], 10) };
}

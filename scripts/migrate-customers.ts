/**
 * 일회성 마이그레이션 스크립트. 실행 후 보존(향후 참고용).
 *
 * migration/full_migration.json 의 기존 고객 데이터를 Google Sheets
 * `고객목록` 시트에 일괄 삽입한다. `src/services/sheets.ts` 의
 * `appendCustomerRow` 를 그대로 재사용하므로 Workers 프로덕션 경로와
 * 동일한 쓰기 포맷(라벨 변환, KST 타임스탬프)이 적용된다.
 *
 * 실행: npm run migrate  (tsx scripts/migrate-customers.ts)
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

import { appendCustomerRow } from "../src/services/sheets";
import {
	CUSTOMER_COLUMNS,
	parseStage,
	type Customer,
	type CustomerColumn,
	type Env,
} from "../src/types/index";

// ─── 1. 환경변수 로드 (.dev.vars) ────────────────────────────────────
const DEV_VARS_PATH = resolve(process.cwd(), ".dev.vars");
loadDotenv({ path: DEV_VARS_PATH });

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value || value.trim() === "") {
		console.error(`❌ 필수 환경변수 누락: ${key} (확인: ${DEV_VARS_PATH})`);
		process.exit(1);
	}
	return value;
}

const env: Env = {
	ANTHROPIC_API_KEY: "", // 마이그레이션에선 사용 안 함
	GOOGLE_SERVICE_ACCOUNT_EMAIL: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
	GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: requireEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
	GOOGLE_SHEETS_ID: requireEnv("GOOGLE_SHEETS_ID"),
	DISCORD_WEBHOOK_DAILY: "",
	DISCORD_WEBHOOK_PROCESSED: "",
	DISCORD_WEBHOOK_ERROR: "",
	NAVER_TALK_TOKEN: "",
};

// ─── 2. 마이그레이션 JSON 로드 ──────────────────────────────────────
interface MigrationFile {
	metadata?: unknown;
	customers: Array<Record<string, string | null | undefined>>;
}

const JSON_PATH = resolve(process.cwd(), "migration/retry_migration.json");
const raw = readFileSync(JSON_PATH, "utf8");
const parsed = JSON.parse(raw) as MigrationFile;
const sourceCustomers = parsed.customers ?? [];

if (!Array.isArray(sourceCustomers) || sourceCustomers.length === 0) {
	console.error(`❌ customers 배열이 비어있음: ${JSON_PATH}`);
	process.exit(1);
}

// ─── 3. 원본 → Customer 변환 ─────────────────────────────────────────
const CUSTOMER_COLUMN_SET = new Set<string>(CUSTOMER_COLUMNS);

function toCustomer(source: Record<string, string | null | undefined>): Partial<Customer> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(source)) {
		if (!CUSTOMER_COLUMN_SET.has(key)) continue; // 스키마에 없는 키는 건너뜀
		if (value === null || value === undefined) {
			out[key] = "";
			continue;
		}
		out[key] = String(value);
	}
	// 현재단계: "S2 원본발송" 같은 라벨을 enum 코드로 복원 →
	// appendCustomerRow 내부에서 stageCellForWrite 가 다시 라벨화하여 시트에 씀.
	if (out["현재단계"]) {
		const code = parseStage(out["현재단계"]);
		out["현재단계"] = code ?? "";
	}
	return out as Partial<Customer>;
}

// ─── 4. 실행 확인 프롬프트 ───────────────────────────────────────────
const total = sourceCustomers.length;

async function confirm(): Promise<boolean> {
	const rl = createInterface({ input, output });
	try {
		const answer = await rl.question(
			`${total}건의 고객 데이터를 고객목록 시트에 추가합니다.\n` +
				`이미 데이터가 있다면 중복될 수 있습니다. 계속하시겠습니까? (y/N) `,
		);
		return answer.trim() === "y" || answer.trim() === "Y";
	} finally {
		rl.close();
	}
}

// ─── 5. 순차 업로드 (300ms 간격) ─────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FailureEntry {
	고객ID: string;
	고객명: string;
	error: string;
}

async function run(): Promise<void> {
	const ok = await confirm();
	if (!ok) {
		console.log("취소됨");
		return;
	}

	const failures: FailureEntry[] = [];
	let successCount = 0;

	for (let i = 0; i < sourceCustomers.length; i++) {
		const src = sourceCustomers[i];
		const id = String(src["고객ID"] ?? "(ID없음)");
		const name = String(src["고객명"] ?? "");
		const idx = i + 1;

		process.stdout.write(`[${idx}/${total}] ${id} ${name} 추가 중... `);

		try {
			const customer = toCustomer(src);
			await appendCustomerRow(env, customer);
			successCount++;
			console.log("✅ 성공");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			failures.push({ 고객ID: id, 고객명: name, error: message });
			console.log(`❌ 실패: ${message}`);
		}

		// Sheets API rate limit 회피 (마지막 건 뒤에는 불필요)
		if (i < sourceCustomers.length - 1) await sleep(1200);
	}

	// ─── 6. 요약 출력 ──────────────────────────────────────────────
	console.log("");
	console.log("─".repeat(60));
	console.log(`총 ${total}건 중 ${successCount}건 성공, ${failures.length}건 실패`);

	if (failures.length > 0) {
		console.log("");
		console.log("실패한 고객:");
		for (const f of failures) {
			console.log(`  - ${f.고객ID} ${f.고객명}: ${f.error}`);
		}
	}
}

run().catch((err) => {
	console.error("치명적 오류:", err);
	process.exit(1);
});

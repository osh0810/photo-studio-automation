interface Env {
  DB: D1Database;
}

interface LogParams {
  env: Env;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextText?: string;
  talkId?: string;
}

// 모델별 토큰당 단가 (USD)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-4-5-20251001': {
    input:      0.80  / 1_000_000,
    output:     2.40  / 1_000_000,
    cacheRead:  0.08  / 1_000_000,
    cacheWrite: 1.00  / 1_000_000,
  },
  'claude-sonnet-4-6': {
    input:      3.00  / 1_000_000,
    output:    15.00  / 1_000_000,
    cacheRead:  0.30  / 1_000_000,
    cacheWrite: 3.75  / 1_000_000,
  },
};

const DEFAULT_PRICING = PRICING['claude-haiku-4-5-20251001'];

export async function logApiCost(params: LogParams): Promise<void> {
  const {
    env, operation, model,
    inputTokens, outputTokens,
    cacheReadTokens = 0, cacheWriteTokens = 0,
    contextText, talkId,
  } = params;

  const p = PRICING[model] ?? DEFAULT_PRICING;
  const costUsd =
    inputTokens     * p.input +
    outputTokens    * p.output +
    cacheReadTokens * p.cacheRead +
    cacheWriteTokens * p.cacheWrite;

  try {
    await env.DB.prepare(
      `INSERT INTO api_usage_log
         (operation, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, context_text, talk_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
      operation, model,
      inputTokens, outputTokens,
      cacheReadTokens, cacheWriteTokens,
      costUsd,
      contextText ? contextText.slice(0, 200) : null,
      talkId ?? null,
    ).run();
  } catch (e) {
    console.log(`[api-cost] 로그 저장 실패: ${e}`);
  }
}

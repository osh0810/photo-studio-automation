/**
 * 개발 메모 API
 *
 *   POST /api/memo/analyze    — 경량 AI로 개발 메모 여부 판단 + 정리 (내부 호출용)
 *   GET  /api/memos           — 메모 목록
 *   PATCH /api/memos/:id      — 상태/내용 수정
 *   DELETE /api/memos/:id     — 삭제
 *   POST /api/memos/reorder   — 드래그 완료 후 순서 일괄 업데이트
 */

import { requireAuth } from './auth';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  [key: string]: unknown;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

// 경량 시스템 프롬프트 (~50 토큰)
const MEMO_SYSTEM_PROMPT = `사용자 메시지에서 개발/기능 개선 요청 사항을 찾으세요.
요청이 있으면: {"is_memo":true,"items":[{"title":"짧은 제목","body":"상세 내용","priority":"urgent|normal|low"}]}
없으면: {"is_memo":false}
JSON만 반환하세요. 설명 없이.`;

export interface MemoItem {
  title: string;
  body: string;
  priority: 'urgent' | 'normal' | 'low';
}

export type MemoAnalyzeResult =
  | { is_memo: false; usage?: { input_tokens: number; output_tokens: number } }
  | { is_memo: true; items: MemoItem[]; usage?: { input_tokens: number; output_tokens: number } };

// ─── 경량 AI 분석 ──────────────────────────────────────────────────────────

export async function analyzeMemo(
  text: string,
  apiKey: string,
): Promise<MemoAnalyzeResult> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: MEMO_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return { is_memo: false };

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const usage = data.usage;
  const raw = data.content?.find((b) => b.type === 'text')?.text ?? '';

  try {
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(jsonStr) as MemoAnalyzeResult;
    return { ...parsed, usage };
  } catch {
    return { is_memo: false, usage };
  }
}

// ─── DB 저장 ───────────────────────────────────────────────────────────────

export async function saveMemos(
  db: D1Database,
  items: MemoItem[],
  rawInput: string,
): Promise<number[]> {
  const ids: number[] = [];
  // 기존 todo 항목 중 최대 sort_order 조회 → 새 항목은 그 다음부터 부여
  const maxRow = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM dev_memos WHERE status = 'todo'`)
    .first<{ mx: number }>();
  let nextOrder = (maxRow?.mx ?? -1) + 1;

  for (const item of items) {
    const row = await db
      .prepare(
        `INSERT INTO dev_memos (title, body, priority, status, sort_order, raw_input, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'todo', ?4, ?5, datetime('now'), datetime('now'))
         RETURNING id`,
      )
      .bind(item.title, item.body, item.priority, nextOrder, rawInput)
      .first<{ id: number }>();
    if (row) ids.push(row.id);
    nextOrder++;
  }
  return ids;
}

// ─── GET /api/memos ────────────────────────────────────────────────────────

export async function handleGetMemos(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  // status 그룹별로 sort_order 기준 정렬, 같은 sort_order면 created_at 순
  const rows = await env.DB.prepare(
    `SELECT * FROM dev_memos ORDER BY
     CASE status WHEN 'todo' THEN 0 WHEN 'in-progress' THEN 1 ELSE 2 END,
     sort_order ASC,
     created_at ASC`,
  ).all();

  return Response.json({ memos: rows.results ?? [] });
}

// ─── POST /api/memos/reorder ───────────────────────────────────────────────

export async function handleReorderMemos(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { ids: number[] };
  try {
    body = await request.json<{ ids: number[] }>();
  } catch {
    return Response.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: 'ids 배열 필요' }, { status: 400 });
  }

  // 배열 순서대로 sort_order 0, 1, 2... 부여
  const stmts = body.ids.map((id, idx) =>
    env.DB.prepare(
      `UPDATE dev_memos SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2`,
    ).bind(idx, id),
  );
  await env.DB.batch(stmts);

  return Response.json({ ok: true });
}

// ─── PATCH /api/memos/:id ──────────────────────────────────────────────────

export async function handlePatchMemo(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: Record<string, string | number>;
  try {
    body = await request.json<Record<string, string | number>>();
  } catch {
    return Response.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  const allowed = ['status', 'priority', 'title', 'body', 'sort_order'];
  const sets: string[] = [];
  const binds: (string | number)[] = [];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?${binds.length + 1}`);
      binds.push(body[key]);
    }
  }

  if (sets.length === 0) {
    return Response.json({ error: '변경할 항목 없음' }, { status: 400 });
  }

  sets.push(`updated_at = datetime('now')`);
  binds.push(id);

  await env.DB.prepare(
    `UPDATE dev_memos SET ${sets.join(', ')} WHERE id = ?${binds.length}`,
  )
    .bind(...binds)
    .run();

  return Response.json({ ok: true });
}

// ─── DELETE /api/memos/:id ─────────────────────────────────────────────────

export async function handleDeleteMemo(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  await env.DB.prepare(`DELETE FROM dev_memos WHERE id = ?1`).bind(id).run();
  return Response.json({ ok: true });
}

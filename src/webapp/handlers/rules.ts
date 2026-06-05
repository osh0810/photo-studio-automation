/**
 * 학습 규칙(ai_learned_rules) 페이지 + API.
 *
 *   GET   /rules                  — 목록 페이지 (인증 필요)
 *   GET   /api/rules              — JSON 배열 반환 (인증 필요)
 *   PATCH /api/rules/:id/toggle   — is_active 토글 (인증 필요)
 */

import { requireAuth } from './auth';
import { renderRulesPage } from '../ui/rules';

interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

export async function handleRulesPage(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  return new Response(renderRulesPage(auth.userEmail), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function handleGetRules(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const rows = await env.DB.prepare(
    `SELECT id, rule_type, pattern_description, conditions, action,
            is_active, last_applied_at,
            apply_count AS application_count,
            created_at
     FROM ai_learned_rules
     ORDER BY is_active DESC, apply_count DESC, id DESC`,
  ).all<{
    id: number;
    rule_type: string;
    pattern_description: string;
    conditions: string | null;
    action: string | null;
    is_active: number;
    last_applied_at: string | null;
    application_count: number;
    created_at: string;
  }>();

  return new Response(JSON.stringify(rows.results || []), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleToggleRule(
  request: Request,
  env: Env,
  idParam: string,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(
      JSON.stringify({ error: 'invalid id' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  const current = await env.DB.prepare(
    `SELECT is_active FROM ai_learned_rules WHERE id = ?1`,
  )
    .bind(id)
    .first<{ is_active: number }>();

  if (!current) {
    return new Response(
      JSON.stringify({ error: 'rule_not_found', id }),
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }

  await env.DB.prepare(
    `UPDATE ai_learned_rules
     SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
     WHERE id = ?1`,
  )
    .bind(id)
    .run();

  const newValue = current.is_active === 1 ? 0 : 1;
  return new Response(
    JSON.stringify({ success: true, id, is_active: newValue }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

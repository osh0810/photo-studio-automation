# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

사진관 업무누락방지 자동화 시스템 — a Cloudflare Workers service that receives Naver TalkTalk (네이버 톡톡) partner webhooks, uses the Anthropic Claude API to classify each message, persists state to Google Sheets, and escalates on Discord when a workflow stage overruns its SLA. Documentation is in Korean (`README.md`, `docs/`); user-facing strings and Discord/Sheets content should also be Korean.

**Current state:** the skeleton in `src/handlers/`, `src/services/`, `src/lib/`, `src/types/`, `src/prompts/` is committed as empty files. `src/index.ts` still returns "Hello World!". When implementing, wire these in rather than restructuring — the layout is intentional (see Architecture below).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npx wrangler dev` | Local dev server, reads `.dev.vars` |
| `npm test` | Vitest via `@cloudflare/vitest-pool-workers` (runs inside workerd) |
| `npx vitest run test/index.spec.ts -t "integration style"` | Run a single test |
| `npm run deploy` / `npx wrangler deploy` | Deploy to Cloudflare |
| `npm run cf-typegen` / `npx wrangler types` | Regenerate `worker-configuration.d.ts` — **run after editing `wrangler.jsonc` bindings** |
| `npx wrangler tail` | Stream production logs |
| `npx wrangler secret put <KEY>` | Set a production secret (never hard-code) |

Tests run under `@cloudflare/vitest-pool-workers`, so imports like `cloudflare:test` and `SELF` are available; `test/tsconfig.json` is distinct from root `tsconfig.json`, and root `tsconfig.json` excludes `test/`.

## Architecture

Two entry points multiplex on a single Worker (`src/index.ts`):

1. **`fetch` handler → `src/handlers/webhook.ts`** — TalkTalk webhook. The required order is strict: **(1) back up raw payload to `_원본백업` sheet first**, then (2) dedup via KV, (3) look up customer in Sheets, (4) classify with Claude, (5) update Sheets, (6) post to Discord `PROCESSED`. Step 1 must succeed before anything else; that is the first line of defense.
2. **`scheduled` handler → `src/handlers/cron.ts`** — daily 09:00 KST scan. Walks the `고객목록` sheet, applies the alert-threshold logic in `src/lib/alerts.ts`, and posts a daily digest to Discord `DAILY`.

Cross-cutting modules:

- `src/services/sheets.ts` — Google Sheets API client; auth uses a service-account JWT built from `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM with literal `\n`; unescape when signing).
- `src/services/classifier.ts` + `src/prompts/classifier.ts` — Claude Haiku 4.5 classification. Keep the prompt in `prompts/` so it can be iterated independently.
- `src/services/discord.ts` — three separate webhooks: `DISCORD_WEBHOOK_DAILY`, `DISCORD_WEBHOOK_PROCESSED`, `DISCORD_WEBHOOK_ERROR`. Route by severity; don't collapse them.
- `src/lib/retry.ts` — exponential backoff (≤3 attempts) wrapping every external API call.
- `src/lib/dedup.ts` — KV-backed idempotency (binding not yet declared in `wrangler.jsonc` — add it and rerun `wrangler types`).
- `src/lib/alerts.ts` — encodes the workflow state machine **S0–S7** and their SLA thresholds (see `README.md` table). Any stage/threshold change belongs here, not scattered in handlers.

### Defense-in-depth invariant

Three-tier failure handling is a hard requirement, not a suggestion:
1. Raw payload written to `_원본백업` **before** any processing that can throw.
2. All outbound API calls wrapped in the retry helper.
3. Terminal failures post to `DISCORD_WEBHOOK_ERROR` immediately.

Preserve this ordering when editing `webhook.ts`.

### Workflow state codes

The codes `S0, S1, S2, S3, S4, S5a, S5b, S6, S7` and their alert thresholds (e.g. 촬영일 +1일, 발송일 +7일/+14일) are the domain model. They appear in `README.md` and must stay in sync with `src/lib/alerts.ts` and the classifier prompt. Alert levels: 🔴 긴급 / 🟡 일반 / 📌 확인필요.

## Environment & secrets

- Local dev reads `.dev.vars` (gitignored). **Never commit it**, and never paste its contents into chat, commit messages, or docs — it currently holds live keys.
- Production uses `wrangler secret put`. Required keys are listed in `README.md` → `🔐 환경변수`. Note the README lists `NAVER_TALK_AUTH_TOKEN` but `.dev.vars` uses `NAVER_TALK_TOKEN`; reconcile before shipping outbound TalkTalk calls.
- `wrangler.jsonc` uses `compatibility_date: 2026-04-17` with `nodejs_compat`. Bump the date deliberately; it can change runtime semantics.

## Cloudflare Workers guidance

Per `AGENTS.md`: assume your cached knowledge of Workers APIs, limits, and bindings is stale. For any task touching KV, Durable Objects, Queues, Workers AI, cron triggers, or platform limits, fetch live docs from `https://developers.cloudflare.com/workers/` (or the product's `/platform/limits/` page) before writing code.

## Reference docs

Korean specs in `docs/` are the source of truth for scope and schema:
- `사진관_업무누락방지_자동화_요구사항명세서.md` — full requirements + Sheets column layout
- `Day0_사전준비물_가이드.md`, `Day1_PhaseA_환경세팅.md`, `Day1_PhaseB_Session1_Discord.md` — setup playbooks

`docs/` is gitignored; treat it as local-only context, not shippable documentation.

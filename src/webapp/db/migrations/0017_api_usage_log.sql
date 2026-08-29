-- API 비용 로그 테이블
CREATE TABLE IF NOT EXISTS api_usage_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at           TEXT NOT NULL DEFAULT (datetime('now')),  -- UTC
  operation           TEXT NOT NULL,  -- 'chat_reply' | 'batch_analyze'
  model               TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL NOT NULL DEFAULT 0,
  context_text        TEXT,           -- 처리 대상 메시지 앞 200자
  talk_id             TEXT            -- 관련 고객 talk_id (있을 경우)
);

CREATE INDEX idx_api_usage_logged_at ON api_usage_log(logged_at DESC);
CREATE INDEX idx_api_usage_operation ON api_usage_log(operation, logged_at DESC);

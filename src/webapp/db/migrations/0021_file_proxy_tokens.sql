-- 파일 프록시 토큰 테이블: Drive 링크를 만료 가능한 단기 URL로 래핑
CREATE TABLE IF NOT EXISTS file_proxy_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token        TEXT NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  booking_id   TEXT,
  link_type    TEXT,  -- 'original' | 'retouched' | 'revision'
  expires_at   TEXT NOT NULL,  -- UTC YYYY-MM-DD HH:MM:SS
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_file_proxy_tokens_token ON file_proxy_tokens(token);

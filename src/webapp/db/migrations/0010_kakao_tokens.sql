-- 0010: 카카오 OAuth 토큰 저장 테이블
CREATE TABLE IF NOT EXISTS kakao_tokens (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 앱 설정 키-값 테이블
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('proxy_link_enabled', 'true');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('proxy_link_expires_days', '60');

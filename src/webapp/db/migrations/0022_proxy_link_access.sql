-- 프록시 링크 접속 이력 추적
ALTER TABLE file_proxy_tokens ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE file_proxy_tokens ADD COLUMN last_accessed_at TEXT;

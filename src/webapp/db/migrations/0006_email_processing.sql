-- ============================================
-- Migration 0006: 메일 처리 환경 셋업
-- Phase 4: 네이버 예약 메일 → DB 자동 등록
-- ============================================

-- 1. bookings 테이블에 취소 관련 컬럼 추가
ALTER TABLE bookings ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_reason TEXT;
ALTER TABLE bookings ADD COLUMN refund_amount INTEGER;

-- 2. processed_emails 테이블 (메일 처리 추적)
CREATE TABLE processed_emails (
  message_id TEXT PRIMARY KEY,           -- Gmail 메시지 ID
  email_type TEXT NOT NULL,              -- 'confirm' | 'cancel' | 'unknown'
  booking_id TEXT,                       -- 추출된 예약번호 (FK 아님 — 파싱 실패해도 기록)
  processing_result TEXT NOT NULL,       -- 'success' | 'parse_failed' | 'duplicate' | 'error'
  error_message TEXT,
  parsed_data TEXT,                      -- JSON (파싱 결과 보존, 디버깅용)
  raw_subject TEXT,
  raw_received_at TEXT,                  -- 메일 발송 시각 (Date 헤더, SQLite 형식)
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_processed_emails_processed_at
  ON processed_emails(processed_at);

CREATE INDEX idx_processed_emails_booking_id
  ON processed_emails(booking_id);

-- 3. google_tokens 테이블 (OAuth Refresh Token 저장 — 싱글턴)
-- 코드에서 INSERT INTO google_tokens (id, ...) VALUES (1, ...) ON CONFLICT(id) DO UPDATE 패턴.
CREATE TABLE google_tokens (
  id INTEGER PRIMARY KEY,                -- 항상 1 (싱글턴, 작가님 본인 계정)
  user_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,              -- access_token 만료 시각 (UTC SQLite 형식)
  scope TEXT NOT NULL,                   -- 부여된 scope (공백 구분)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase 7: 작가 사진 업로드 & 인스타 초안 관리

-- 사진 묶음 (photo_uploads가 참조하므로 먼저 생성)
CREATE TABLE IF NOT EXISTS photo_groups (
  group_id   TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
  caption    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 업로드된 개별 사진
CREATE TABLE IF NOT EXISTS photo_uploads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id      TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
  r2_key          TEXT    NOT NULL,
  file_name       TEXT    NOT NULL,
  file_size       INTEGER NOT NULL DEFAULT 0,
  width           INTEGER,
  height          INTEGER,
  group_id        TEXT REFERENCES photo_groups(group_id) ON DELETE SET NULL,
  group_order     INTEGER NOT NULL DEFAULT 0,
  caption         TEXT,
  chat_message_id INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 인스타 게시물 초안
CREATE TABLE IF NOT EXISTS insta_drafts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id         TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
  source_type        TEXT NOT NULL,  -- 'group' | 'booking_fallback'
  source_id          TEXT NOT NULL,  -- group_id 또는 booking_id
  draft_type         TEXT NOT NULL,  -- 'carousel' | 'reels'
  mood               TEXT NOT NULL,  -- '감동적'|'잔잔함'|'발랄함'|'반전'|'화기애애'
  photo_order        TEXT NOT NULL,  -- JSON: [photo_upload_id, ...]
  caption_text       TEXT NOT NULL,
  story_notes        TEXT,
  reference_keywords TEXT,           -- JSON: ["키워드", ...]
  bgm_suggestion     TEXT,
  uploaded_at        TEXT,           -- NULL = 미업로드
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 초안 생성 작업 상태 (백그라운드 처리 추적)
CREATE TABLE IF NOT EXISTS generation_jobs (
  job_id      TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'in_progress'|'done'|'failed'
  progress    INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 3,
  error_msg   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_photo_uploads_booking ON photo_uploads(booking_id);
CREATE INDEX IF NOT EXISTS idx_photo_uploads_group   ON photo_uploads(group_id);
CREATE INDEX IF NOT EXISTS idx_insta_drafts_booking  ON insta_drafts(booking_id);
CREATE INDEX IF NOT EXISTS idx_insta_drafts_uploaded ON insta_drafts(uploaded_at);

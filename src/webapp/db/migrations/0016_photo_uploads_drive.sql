-- Phase 7 리팩터: R2 → Google Drive
-- r2_key 컬럼을 drive_file_id로 교체

CREATE TABLE photo_uploads_drive (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id      TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
  drive_file_id   TEXT    NOT NULL,
  file_name       TEXT    NOT NULL,
  file_size       INTEGER NOT NULL DEFAULT 0,
  width           INTEGER,
  height          INTEGER,
  group_id        TEXT,
  group_order     INTEGER NOT NULL DEFAULT 0,
  caption         TEXT,
  chat_message_id INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO photo_uploads_drive
  SELECT id, booking_id, r2_key, file_name, file_size, width, height,
         group_id, group_order, caption, chat_message_id, created_at
  FROM photo_uploads;

DROP TABLE photo_uploads;
ALTER TABLE photo_uploads_drive RENAME TO photo_uploads;

CREATE INDEX IF NOT EXISTS idx_photo_uploads_booking ON photo_uploads(booking_id);
CREATE INDEX IF NOT EXISTS idx_photo_uploads_group   ON photo_uploads(group_id);

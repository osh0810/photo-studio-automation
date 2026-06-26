-- photo_uploads.group_id의 photo_groups FK 참조 제거
-- (photo_groups 테이블이 0014에서 삭제됨)

CREATE TABLE photo_uploads_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id      TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
  r2_key          TEXT    NOT NULL,
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

INSERT INTO photo_uploads_new SELECT * FROM photo_uploads;
DROP TABLE photo_uploads;
ALTER TABLE photo_uploads_new RENAME TO photo_uploads;

CREATE INDEX IF NOT EXISTS idx_photo_uploads_booking ON photo_uploads(booking_id);
CREATE INDEX IF NOT EXISTS idx_photo_uploads_group   ON photo_uploads(group_id);

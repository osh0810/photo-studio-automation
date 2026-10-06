-- Preserve legacy bundled delivery locks; new approvals lock each message independently.
ALTER TABLE booking_confirmation_sends RENAME TO booking_confirmation_sends_legacy;
CREATE TABLE booking_confirmation_sends (
 booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
 message_kind TEXT NOT NULL DEFAULT 'both' CHECK(message_kind IN ('both','confirmation','additional')),
 attempt_id TEXT NOT NULL, route TEXT NOT NULL CHECK(route IN ('browser','api')),
 status TEXT NOT NULL CHECK(status IN ('sending','sent','uncertain')), message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY (booking_id,message_kind)
);
INSERT INTO booking_confirmation_sends (booking_id,attempt_id,route,status,message,created_at,updated_at)
 SELECT booking_id,attempt_id,route,status,message,created_at,updated_at FROM booking_confirmation_sends_legacy;
DROP TABLE booking_confirmation_sends_legacy;
ALTER TABLE booking_confirmation_jobs RENAME TO booking_confirmation_jobs_legacy;
CREATE TABLE booking_confirmation_jobs (
 booking_id TEXT NOT NULL REFERENCES bookings(booking_id),
 message_kind TEXT NOT NULL DEFAULT 'both' CHECK(message_kind IN ('both','confirmation','additional')),
 approved_by TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','sent','already_sent','uncertain')),
 claim_id TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY (booking_id,message_kind)
);
INSERT INTO booking_confirmation_jobs (booking_id,approved_by,status,claim_id,error,created_at,updated_at)
 SELECT booking_id,approved_by,status,claim_id,error,created_at,updated_at FROM booking_confirmation_jobs_legacy;
DROP TABLE booking_confirmation_jobs_legacy;
CREATE INDEX idx_confirmation_jobs_status ON booking_confirmation_jobs(status,created_at);

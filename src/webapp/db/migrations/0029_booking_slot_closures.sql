CREATE TABLE booking_slot_closures (
 booking_id TEXT PRIMARY KEY,
 shoot_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','closed','failed','login_required')),
 claim_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 result TEXT,
 error TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

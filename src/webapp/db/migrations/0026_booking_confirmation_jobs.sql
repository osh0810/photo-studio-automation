-- Only an explicit assistant approval creates a job. A claimed job is never automatically retried.
CREATE TABLE booking_confirmation_jobs (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(booking_id),
  approved_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'sent', 'already_sent', 'uncertain')),
  claim_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_confirmation_jobs_status ON booking_confirmation_jobs(status, created_at);

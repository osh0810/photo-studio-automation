-- One confirmation per reservation; uncertain attempts stay locked for manual review.
CREATE TABLE booking_confirmation_sends (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(booking_id),
  attempt_id TEXT NOT NULL,
  route TEXT NOT NULL CHECK(route IN ('browser', 'api')),
  status TEXT NOT NULL CHECK(status IN ('sending', 'sent', 'uncertain')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

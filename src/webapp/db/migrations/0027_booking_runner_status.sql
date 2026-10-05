CREATE TABLE booking_runner_status (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  status TEXT NOT NULL CHECK(status IN ('unknown', 'ready', 'login_required')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO booking_runner_status(id, status) VALUES (1, 'unknown');

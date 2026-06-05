-- ========================================
-- Migration 0003: Push Subscriptions
-- Phase 2 Step 6: PWA + 푸시 알림 (구독 저장)
-- ========================================

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_push_user ON push_subscriptions(user_email);

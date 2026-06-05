-- ============================================
-- Phase 3 Step 1: talk_messages 재생성
-- v3 가이드 컬럼 + 기존 유용 필드 통합
-- ============================================

-- 1. 백업 (혹시 모르니)
-- CREATE TABLE talk_messages_backup AS SELECT * FROM talk_messages;

-- 2. 기존 테이블 drop
DROP TABLE talk_messages;

-- 3. 새 테이블 생성
CREATE TABLE talk_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- 식별
  talk_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  
  -- 내용
  message_content TEXT,
  image_url TEXT,
  
  -- 시간
  message_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- 처리
  processing_status TEXT NOT NULL DEFAULT 'pending',
  batch_id INTEGER,
  ai_chat_message_id INTEGER,
  
  -- 디버깅/감사
  event_type TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  
  -- AI 분석 결과 (선택)
  classification_result TEXT,
  ai_suggestion TEXT,
  related_booking_id TEXT,
  
  FOREIGN KEY (related_booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (ai_chat_message_id) REFERENCES ai_chat_messages(id)
);

-- 4. 인덱스
CREATE INDEX idx_talk_pending 
  ON talk_messages(processing_status, talk_id, message_at);

CREATE INDEX idx_talk_user_time
  ON talk_messages(talk_id, message_at DESC);

CREATE INDEX idx_talk_sender_type
  ON talk_messages(sender_type, talk_id, message_at DESC);

-- -- 5. 기존 데이터 마이그레이션
-- INSERT INTO talk_messages (
--   id, talk_id, sender_type, message_content, 
--   message_at, received_at, processing_status,
--   event_type, raw_payload,
--   classification_result, ai_suggestion, related_booking_id
-- )
-- SELECT 
--   id,
--   user_talk_id AS talk_id,
--   CASE 
--     WHEN event_type = 'send' THEN 'customer'
--     WHEN event_type = 'echo' THEN 'studio'
--     ELSE 'customer'
--   END AS sender_type,
--   message_text AS message_content,
--   created_at AS message_at,
--   created_at AS received_at,
--   COALESCE(processing_status, 'done') AS processing_status,
--   event_type,
--   raw_payload,
--   classification_result,
--   ai_suggestion,
--   related_booking_id
-- FROM talk_messages_backup;

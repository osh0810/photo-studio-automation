-- ========================================
-- 마음껏스튜디오 관리 시스템 DB Schema
-- Migration 0001: Initial Tables
-- ========================================

-- 1. customers (고객 정보)
CREATE TABLE customers (
  talk_id TEXT PRIMARY KEY,         -- 톡톡ID (22자 해시)
  customer_name TEXT NOT NULL,      -- 고객명
  phone TEXT,                       -- 연락처
  consultation_channel TEXT,        -- 상담채널 (네이버, 인스타 등)
  memo TEXT,                        -- 메모 (아이정보, 가족정보, 성격 등)
  frame_address TEXT,               -- 액자 주소
  frame_recipient TEXT,             -- 액자 받는사람
  frame_phone TEXT,                 -- 액자 연락처
  created_at TEXT NOT NULL,         -- 등록일시 (ISO 8601)
  updated_at TEXT NOT NULL          -- 최종수정일
);

CREATE INDEX idx_customers_name ON customers(customer_name);
CREATE INDEX idx_customers_phone ON customers(phone);

-- 2. bookings (예약 정보)
CREATE TABLE bookings (
  booking_id TEXT PRIMARY KEY,      -- 예약번호 (네이버 예약번호)
  talk_id TEXT,                     -- 톡톡ID (외래키, NULL 가능 - 매칭 전)
  customer_name TEXT NOT NULL,      -- 고객명 (예약 시점 이름)
  product_id TEXT,                  -- 예약상품 (외래키)
  product_name TEXT,                -- 상품명 (스냅샷)
  payment_amount INTEGER,           -- 결제금액
  request_note TEXT,                -- 요청사항
  reservation_date TEXT NOT NULL,   -- 예약일 (예약한 날)
  service_details TEXT,             -- 제공내역 JSON {보정장수, 액자구성}
  shoot_date TEXT,                  -- 촬영일
  original_sent_at TEXT,            -- 원본발송일
  selection_received_at TEXT,       -- 셀렉수신일
  selection_cuts TEXT,              -- 셀렉컷
  retouched_sent_at TEXT,           -- 보정본발송일
  revision_requested_at TEXT,       -- 추가보정요청일
  revision_content TEXT,            -- 추가보정내용
  revision_sent_at TEXT,            -- 추가보정본발송일 (요청 들어오면 리셋)
  frame_ordered_at TEXT,            -- 액자발주일
  frame_selected_photos TEXT,       -- 액자 선택 사진 (어느 보정본?)
  alert_paused_until TEXT,          -- 알림일시정지일
  promotion_consent INTEGER DEFAULT 0,  -- 홍보동의 (0/1)
  current_stage TEXT NOT NULL DEFAULT 'S0',  -- S0~S7
  review_status TEXT,               -- 검토상태
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (talk_id) REFERENCES customers(talk_id)
);

CREATE INDEX idx_bookings_talk_id ON bookings(talk_id);
CREATE INDEX idx_bookings_customer_name ON bookings(customer_name);
CREATE INDEX idx_bookings_shoot_date ON bookings(shoot_date);
CREATE INDEX idx_bookings_current_stage ON bookings(current_stage);

-- 3. talk_messages (톡톡 대화)
CREATE TABLE talk_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,         -- send, echo, open, leave, friend
  user_talk_id TEXT,                -- 톡톡ID (echo는 받는 사람)
  message_text TEXT,                -- 메시지 본문
  raw_payload TEXT NOT NULL,        -- 원본 JSON
  processing_status TEXT,           -- 처리상태
  classification_result TEXT,       -- AI 분류 결과
  ai_suggestion TEXT,               -- AI 제안
  related_booking_id TEXT,          -- 관련 예약번호
  created_at TEXT NOT NULL,
  FOREIGN KEY (related_booking_id) REFERENCES bookings(booking_id)
);

CREATE INDEX idx_talk_messages_user ON talk_messages(user_talk_id);
CREATE INDEX idx_talk_messages_created ON talk_messages(created_at);
CREATE INDEX idx_talk_messages_event ON talk_messages(event_type);

-- 4. message_templates (메시지 템플릿)
CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_type TEXT NOT NULL,      -- 확정문자/원본/보정본/추가보정/액자
  template_name TEXT NOT NULL,      -- 표시 이름
  body TEXT NOT NULL,               -- 본문 (변수 포함)
  variables TEXT,                   -- 변수 목록 JSON
  is_active INTEGER DEFAULT 1,      -- 사용 여부
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 5. products (상품 정보)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  price INTEGER,
  retouch_count INTEGER,            -- 보정장수
  frame_options TEXT,               -- 액자구성 JSON
  default_people_count INTEGER,     -- 기본인원수
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 6. schedule_change_history (일정 변경 이력)
CREATE TABLE schedule_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  reason TEXT,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
);

CREATE INDEX idx_schedule_history_booking ON schedule_change_history(booking_id);

-- 7. ai_chat_messages (채팅창 메시지)
CREATE TABLE ai_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,             -- 'user' | 'ai'
  message TEXT NOT NULL,
  reply_to_id INTEGER,              -- 답장 대상 메시지 ID
  metadata TEXT,                    -- 관련 예약번호, 액션 등 JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (reply_to_id) REFERENCES ai_chat_messages(id)
);

CREATE INDEX idx_chat_messages_created ON ai_chat_messages(created_at);
CREATE INDEX idx_chat_messages_reply ON ai_chat_messages(reply_to_id);

-- 8. ai_learned_rules (AI 학습 규칙)
CREATE TABLE ai_learned_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,          -- 'auto_process' | 'confirm_required'
  pattern_description TEXT NOT NULL,
  conditions TEXT,                  -- JSON
  action TEXT,                      -- JSON
  created_at TEXT NOT NULL,
  apply_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1
);

-- 9. notifications (알림)
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_type TEXT NOT NULL,  -- 'chat' | 'list'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  related_booking_id TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX idx_notifications_created ON notifications(created_at);
CREATE INDEX idx_notifications_read ON notifications(is_read);

-- 10. sessions (인증 세션)
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 11. message_send_history (발송 이력)
CREATE TABLE message_send_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT,                  -- 관련 예약번호
  talk_id TEXT,                     -- 받는 사람 톡톡ID
  send_type TEXT,                   -- 원본/보정본/추가보정/액자/기타
  message_content TEXT NOT NULL,
  send_method TEXT,                 -- 'auto' | 'manual'
  result TEXT,                      -- 'success' | 'failed'
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
);

CREATE INDEX idx_send_history_booking ON message_send_history(booking_id);
CREATE INDEX idx_send_history_talk_id ON message_send_history(talk_id);
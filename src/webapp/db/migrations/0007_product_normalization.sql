-- ============================================
-- Migration 0007: products 정규화 + additional_questions + booking_details
-- Phase 4 Step 4-B (1+2)
-- ============================================

-- 1. 기존 products DROP (COUNT=0 확인됨, bookings.product_id는 FK 아님)
DROP TABLE IF EXISTS products;

-- 2. 신규 products (정규화)
CREATE TABLE products (
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL UNIQUE,        -- 시스템 키 (예: 'FAM_CLASSIC')
  product_name TEXT NOT NULL,                -- 표시 이름 (예: '클래식 가족사진')
  match_keyword TEXT NOT NULL,               -- 메일 매칭 키워드

  price INTEGER NOT NULL,                    -- 참고용 (가격 차이 무시)

  -- 제공 내역
  retouch_count INTEGER NOT NULL DEFAULT 0,
  retouch_breakdown TEXT,                    -- "가족1장,아기2장" (선택)
  frame_count INTEGER NOT NULL DEFAULT 0,
  frame_size TEXT,                           -- "8×10인치 원목" (선택)
  extra_note TEXT,                           -- 특수 안내 (선택)

  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_products_match_keyword ON products(match_keyword);
CREATE INDEX idx_products_is_active ON products(is_active);

-- 3. additional_questions (추가 질문 마스터)
CREATE TABLE additional_questions (
  question_id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_code TEXT NOT NULL UNIQUE,
  trigger_keyword TEXT NOT NULL,
  question_text TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_additional_questions_trigger ON additional_questions(trigger_keyword);
CREATE INDEX idx_additional_questions_is_active ON additional_questions(is_active);

-- 4. booking_details (예약-상품 N:M)
CREATE TABLE booking_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL,
  product_id INTEGER,                        -- NULL 가능 (unmatched 케이스)
  quantity INTEGER NOT NULL DEFAULT 1,
  match_status TEXT NOT NULL DEFAULT 'matched',  -- 'matched' | 'unmatched' | 'manual'
  raw_text TEXT,                             -- 메일에서 추출된 원본 텍스트
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE INDEX idx_booking_details_booking_id ON booking_details(booking_id);
CREATE INDEX idx_booking_details_product_id ON booking_details(product_id);
CREATE INDEX idx_booking_details_match_status ON booking_details(match_status);

-- "추가보정 없음" 명시 컬럼 추가
ALTER TABLE bookings ADD COLUMN cat > scripts/test-data.sql << 'EOF'
-- 테스트 데이터 (5건)
DELETE FROM bookings WHERE booking_id LIKE 'TEST-%';
DELETE FROM customers WHERE talk_id LIKE 'TEST-%';

-- 1. 테스트허희정 (S2 원본발송)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-001', '테스트허희정', '010-1111-1111', 'naver_talk', '6개월 아기, 가족사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-001', 'TEST-talk-001', '테스트허희정', '아기성장앨범', 350000,
  '2026-04-25', '2026-04-28', '2026-04-29 10:00:00',
  'S2', datetime('now'), datetime('now')
);

-- 2. 테스트김민지 (S4 보정발송)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-002', '테스트김민지', '010-2222-2222', 'naver_talk', '돌사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  selection_received_at, selection_cuts, retouched_sent_at,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-002', 'TEST-talk-002', '테스트김민지', '돌사진풀패키지', 450000,
  '2026-04-20', '2026-04-23', '2026-04-24 11:00:00',
  '2026-04-26 14:00:00', '02060,02127,02145', '2026-04-29 16:00:00',
  'S4', datetime('now'), datetime('now')
);

-- 3. 테스트오선화 (S5a 추가보정요청)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-003', '테스트오선화', '010-3333-3333', 'naver_talk', '가족사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  selection_received_at, selection_cuts, retouched_sent_at,
  revision_requested_at, revision_content,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-003', 'TEST-talk-003', '테스트오선화', '가족사진베이직', 250000,
  '2026-04-15', '2026-04-18', '2026-04-19 09:00:00',
  '2026-04-21 11:00:00', '01030,01055', '2026-04-25 17:00:00',
  '2026-04-28 10:00:00', '독사진 좀 더 밝게 해주세요',
  'S5a', datetime('now'), datetime('now')
);

-- 4. 테스트박지수 (S5b 추가보정없음)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-004', '테스트박지수', '010-4444-4444', 'naver_talk', '커플사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  selection_received_at, selection_cuts, retouched_sent_at,
  revision_no_more_at,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-004', 'TEST-talk-004', '테스트박지수', '커플사진', 200000,
  '2026-04-10', '2026-04-13', '2026-04-14 10:00:00',
  '2026-04-16 12:00:00', '03020,03045', '2026-04-20 15:00:00',
  '2026-04-25 11:00:00',
  'S5b', datetime('now'), datetime('now')
);

-- 5. 테스트이서연 (S0 신규문의)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-005', '테스트이서연', '010-5555-5555', 'naver_talk', '신규문의 - 아기사진 가격', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-005', 'TEST-talk-005', '테스트이서연', '아기사진', 0,
  '2026-05-02',
  'S0', datetime('now'), datetime('now')
);
EOF

echo "✅ test-data.sql 생성 완료"cat > scripts/test-data.sql << 'EOF'
-- 테스트 데이터 (5건)
DELETE FROM bookings WHERE booking_id LIKE 'TEST-%';
DELETE FROM customers WHERE talk_id LIKE 'TEST-%';

-- 1. 테스트허희정 (S2 원본발송)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-001', '테스트허희정', '010-1111-1111', 'naver_talk', '6개월 아기, 가족사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-001', 'TEST-talk-001', '테스트허희정', '아기성장앨범', 350000,
  '2026-04-25', '2026-04-28', '2026-04-29 10:00:00',
  'S2', datetime('now'), datetime('now')
);

-- 2. 테스트김민지 (S4 보정발송)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-002', '테스트김민지', '010-2222-2222', 'naver_talk', '돌사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  selection_received_at, selection_cuts, retouched_sent_at,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-002', 'TEST-talk-002', '테스트김민지', '돌사진풀패키지', 450000,
  '2026-04-20', '2026-04-23', '2026-04-24 11:00:00',
  '2026-04-26 14:00:00', '02060,02127,02145', '2026-04-29 16:00:00',
  'S4', datetime('now'), datetime('now')
);

-- 3. 테스트오선화 (S5a 추가보정요청)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-003', '테스트오선화', '010-3333-3333', 'naver_talk', '가족사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  selection_received_at, selection_cuts, retouched_sent_at,
  revision_requested_at, revision_content,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-003', 'TEST-talk-003', '테스트오선화', '가족사진베이직', 250000,
  '2026-04-15', '2026-04-18', '2026-04-19 09:00:00',
  '2026-04-21 11:00:00', '01030,01055', '2026-04-25 17:00:00',
  '2026-04-28 10:00:00', '독사진 좀 더 밝게 해주세요',
  'S5a', datetime('now'), datetime('now')
);

-- 4. 테스트박지수 (S5b 추가보정없음)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-004', '테스트박지수', '010-4444-4444', 'naver_talk', '커플사진', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date, shoot_date, original_sent_at,
  selection_received_at, selection_cuts, retouched_sent_at,
  revision_no_more_at,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-004', 'TEST-talk-004', '테스트박지수', '커플사진', 200000,
  '2026-04-10', '2026-04-13', '2026-04-14 10:00:00',
  '2026-04-16 12:00:00', '03020,03045', '2026-04-20 15:00:00',
  '2026-04-25 11:00:00',
  'S5b', datetime('now'), datetime('now')
);

-- 5. 테스트이서연 (S0 신규문의)
INSERT INTO customers (talk_id, customer_name, phone, consultation_channel, memo, created_at, updated_at)
VALUES ('TEST-talk-005', '테스트이서연', '010-5555-5555', 'naver_talk', '신규문의 - 아기사진 가격', datetime('now'), datetime('now'));

INSERT INTO bookings (
  booking_id, talk_id, customer_name, product_name, payment_amount,
  reservation_date,
  current_stage, created_at, updated_at
) VALUES (
  'TEST-2026-005', 'TEST-talk-005', '테스트이서연', '아기사진', 0,
  '2026-05-02',
  'S0', datetime('now'), datetime('now')
);
EOF

echo "✅ test-data.sql 생성 완료" DATETIME;

-- current_stage는 유지하되, 트리거로 자동 업데이트하지는 않음
-- (애플리케이션 레벨에서 계산, DB에는 캐시 용도로만 저장)

-- 인덱스 추가 (누락 체크 쿼리 성능 향상)
CREATE INDEX IF NOT EXISTS idx_original_sent ON bookings(original_sent_at);
CREATE INDEX IF NOT EXISTS idx_retouched_sent ON bookings(retouched_sent_at);
CREATE INDEX IF NOT EXISTS idx_revision_requested ON bookings(revision_requested_at);
CREATE INDEX IF NOT EXISTS idx_revision_sent ON bookings(revision_sent_at);
CREATE INDEX IF NOT EXISTS idx_frame_ordered ON bookings(frame_ordered_at);
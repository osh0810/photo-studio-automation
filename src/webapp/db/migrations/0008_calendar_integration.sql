-- ============================================
-- Migration 0008: Calendar 자동 등록 (Phase 5)
-- ============================================
-- 주의: 이 파일은 remote DB에 이미 수동 적용된 변경의 히스토리 기록용입니다.
-- 신규 환경(로컬/스테이징) 셋업 시 이 마이그레이션이 자동으로 적용되도록 보존.

-- 1. bookings: 캘린더 이벤트 ID 저장
--    멱등성(중복 등록 방지) + 업데이트/취소 시 참조용.
ALTER TABLE bookings ADD COLUMN calendar_event_id TEXT;
CREATE INDEX idx_bookings_calendar_event_id ON bookings(calendar_event_id);

-- 2. products: 캘린더 제목용 약어
--    예: "클래식 가족사진" → "가족(클)" 등 짧은 표시명.
ALTER TABLE products ADD COLUMN calendar_abbr TEXT;

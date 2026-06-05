-- ============================================
-- Migration 0009: Drive 폴더 연동 (Phase 6-B)
-- ============================================
-- bookings에 원본/보정 폴더 URL 컬럼 추가.
-- 신규 환경 셋업 시 자동 적용되도록 보존.

ALTER TABLE bookings ADD COLUMN original_folder_url TEXT;
ALTER TABLE bookings ADD COLUMN retouched_folder_url TEXT;

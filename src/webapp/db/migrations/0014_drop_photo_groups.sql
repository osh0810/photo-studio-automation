-- Phase 7 리팩터: photo_groups 테이블 제거
-- group_id / booking_id / caption 모두 photo_uploads에서 직접 관리
DROP TABLE IF EXISTS photo_groups;

-- "추가보정 없음" 명시 컬럼 추가. 테스트 데이터는 scripts/test-data.sql에서 별도로 관리한다.
ALTER TABLE bookings ADD COLUMN revision_no_more_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_original_sent ON bookings(original_sent_at);
CREATE INDEX IF NOT EXISTS idx_retouched_sent ON bookings(retouched_sent_at);
CREATE INDEX IF NOT EXISTS idx_revision_requested ON bookings(revision_requested_at);
CREATE INDEX IF NOT EXISTS idx_revision_sent ON bookings(revision_sent_at);
CREATE INDEX IF NOT EXISTS idx_frame_ordered ON bookings(frame_ordered_at);

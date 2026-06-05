-- promotion_consent: INTEGER(0/1) → TEXT('홍보o' | NULL)
-- SQLite는 컬럼 타입 직접 변경 불가 → 임시 컬럼 경유

ALTER TABLE bookings ADD COLUMN promotion_consent_text TEXT;

UPDATE bookings
SET promotion_consent_text = CASE
  WHEN promotion_consent = 1 THEN '홍보o'
  ELSE NULL
END;

ALTER TABLE bookings DROP COLUMN promotion_consent;
ALTER TABLE bookings RENAME COLUMN promotion_consent_text TO promotion_consent;

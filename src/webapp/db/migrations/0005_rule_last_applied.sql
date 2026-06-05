-- ============================================
-- Phase 3 Step 4-B: ai_learned_rules 보강
-- ============================================

-- 적용 시각 추적 컬럼
ALTER TABLE ai_learned_rules ADD COLUMN last_applied_at TEXT;

-- 활성 규칙 빠른 조회용 인덱스 (matchLearnedRule의 ORDER BY created_at ASC 가속)
CREATE INDEX IF NOT EXISTS idx_rules_active_created
  ON ai_learned_rules(is_active, created_at);

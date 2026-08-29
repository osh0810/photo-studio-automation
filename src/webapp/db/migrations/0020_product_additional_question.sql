-- Migration 0020: products 테이블에 additional_question_text 컬럼 추가
-- 각 상품마다 추가질문 문구를 직접 저장 (기존 additional_questions 테이블 trigger 매칭 방식 대체)
ALTER TABLE products ADD COLUMN additional_question_text TEXT;

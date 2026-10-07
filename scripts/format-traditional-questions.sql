-- 전통상 안내문의 번호 사이에 빈 줄을 추가한다.
-- 동일 문구의 줄바꿈만 변경하며 재실행해도 중복 줄바꿈을 만들지 않는다.
UPDATE products
SET additional_question_text = REPLACE(
  additional_question_text,
  '  2. 전통상은',
  char(10) || char(10) || '2. 전통상은'
)
WHERE instr(additional_question_text, '  2. 전통상은') > 0;

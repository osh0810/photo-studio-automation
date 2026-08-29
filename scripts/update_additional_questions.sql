-- 아이 이름만
UPDATE products SET additional_question_text = '아이 이름/성별/나이(촬영일기준 개월수 포함) 말씀해주시면 촬영시 참고하도록 하겠습니다!^^'
WHERE product_code IN ('BABY_CLASSIC','BABY_COLOR','PKG_2','PKG_3','PKG_7','PKG_9','PKG_10','PKG_14');

-- 혹시 아이가 있다면
UPDATE products SET additional_question_text = '혹시 아이가 있다면 아이 이름/성별/나이(촬영일기준 개월수 포함) 말씀해주시면 촬영시 참고하도록 하겠습니다!^^'
WHERE product_code IN ('FAM_CLASSIC','FAM_FLOWER','FAM_NATURAL','PKG_1','PKG_8','PKG_13');

-- 대가족 단독 (아이 불확실)
UPDATE products SET additional_question_text = '가족 구성원과 혹시 아이가 있다면 아이 이름/성별/나이(촬영일기준 개월수 포함) 말씀해주시면 촬영시 참고하도록 하겠습니다!^^'
WHERE product_code = 'FAM_BIG';

-- 가족+아기 (아이 확실)
UPDATE products SET additional_question_text = '가족 구성원과 아이 이름/성별/나이(촬영일기준 개월수 포함) 말씀해주시면 촬영시 참고하도록 하겠습니다!^^'
WHERE product_code = 'PKG_15';

-- 만삭 1개 컨셉
UPDATE products SET additional_question_text = '촬영일 기준 주수, 태명 말씀해주시면 촬영시 참고하도록 하겠습니다!^^
그레이, 베이지, 내추럴 중 원하시는 1개 컨셉 말씀해주세요^^'
WHERE product_code = 'MATERNITY_1';

-- 만삭 2개 컨셉
UPDATE products SET additional_question_text = '촬영일 기준 주수, 태명 말씀해주시면 촬영시 참고하도록 하겠습니다!^^
그레이, 베이지, 내추럴 중 원하시는 2개 컨셉 말씀해주세요^^'
WHERE product_code = 'MATERNITY_2';

-- 만삭 3개 컨셉
UPDATE products SET additional_question_text = '촬영일 기준 주수, 태명 말씀해주시면 촬영시 참고하도록 하겠습니다!^^'
WHERE product_code = 'MATERNITY_3';

-- 전통상 포함 (아이 이름 + 전통상 선택)
UPDATE products SET additional_question_text = '아이 이름/성별/나이(촬영일기준 개월수 포함) 말씀해주시면 촬영시 참고하도록 하겠습니다!^^
전통상은 담상, 채색상 중 어느 상차림으로 준비해드릴까요? 아래 링크에서 상차림 사진 참고 가능하십니다^^
https://m.blog.naver.com/feelfree_studio/223663878480'
WHERE product_code IN ('BABY_TRAD','PKG_4','PKG_5','PKG_6','PKG_11','PKG_12','PKG_16','PKG_18');

-- 대가족 + 전통상
UPDATE products SET additional_question_text = '가족 구성원과 아이 이름/성별/나이(촬영일기준 개월수 포함) 말씀해주시면 촬영시 참고하도록 하겠습니다!^^
전통상은 담상, 채색상 중 어느 상차림으로 준비해드릴까요? 아래 링크에서 상차림 사진 참고 가능하십니다^^
https://m.blog.naver.com/feelfree_studio/223663878480'
WHERE product_code = 'PKG_17';

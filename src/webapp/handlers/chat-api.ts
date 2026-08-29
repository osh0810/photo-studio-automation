/**
 * 채팅 API 엔드포인트.
 *
 *   GET  /api/chat/messages    — 메시지 목록 (시간순 역방향, reply_to JOIN)
 *   POST /api/chat/send        — 사용자 메시지 INSERT (AI 처리는 별도)
 *   POST /api/chat/ai-process  — Claude Haiku 호출 → AI 응답 INSERT
 */

import { requireAuth } from './auth';
import {
  TOOLS,
  handleToolUse,
  executeRecordMilestone,
  executeConfirmDriveNewProducts,
  executeConfirmNameUpdate,
  executeConfirmPendingLink,
  executeLinkTalkIdToBooking,
  executeCancelBookingPending,
} from '../lib/ai-tools';
import { markCalendarEventCancelled } from '../lib/calendar-event-builder';
import { sendPushNotification } from '../lib/push-sender';
import { runMorningReport } from '../lib/morning-report';
import {
  getFolderInfo,
  getParentFolder,
  getFolderChildren,
} from '../lib/drive-client';
import {
  parseFolderName,
  detectLinkType,
  matchBookingByFolderName,
  matchProductsFromFolder,
  extractCustomerNameFromFilename,
  extractFolderIdFromUrl,
} from '../lib/drive-folder-parser';
import {
  buildOriginalSendMessage,
  buildRetouchedSendMessage,
} from '../lib/drive-message-builder';
import { logApiCost } from '../lib/api-cost-logger';
import { analyzeMemo, saveMemos, type MemoItem } from './memo-api';
import type {
  ChatMessage,
  ChatSendRequest,
  ChatSendResponse,
  AIProcessRequest,
  ChatSender,
} from '../types';

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  AI_DAILY_LIMIT?: string;
  ALLOWED_EMAIL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  BASE_URL?: string;
  [key: string]: unknown;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const AI_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 10;
const DEFAULT_DAILY_LIMIT = 200;
const MAX_TOOL_ROUNDS = 5;

// 개발 메모 패턴 감지 (경량 엔드포인트 라우팅 트리거)
const MEMO_PATTERNS = [
  /개발\s*메모/,                              // "개발메모", "개발 메모 추가"
  /메모\s*(추가|저장)/,                        // "메모 추가", "메모 저장"
  /메모해줘|메모\s*해\s*줘/,
  /좋을\s*것\s*같아/,                          // "하면 좋을 것 같아", "있으면 좋을 것 같아"
  /기능\s*(추가|개선|수정)/,
  /버그\s*(있|발견|수정)/,
  /수정\s*(필요|해줘|해야)/,
  /나중에.{0,20}(해야|추가|수정|개선|고쳐)/,
  /개선\s*(필요|해줘|사항)/,
  /추가해야|고쳐야|바꿔야/,
];

// 짧은 긍정/거부 응답 매칭 (reply_to 없을 때 컨텍스트 자동 추론용)
const SHORT_AFFIRM = /^(네|넵|응|어|ㅇㅇ|ㅇㅋ|오케이|오키|ok|예|좋아요?|그래요?|진행(해(줘|주세요)?)?)[!.…~\s]*$/i;
const SHORT_DENY = /^(아니요?|아니오|노|no|안\s?해(줘|주세요)?|안\s?할(래|게)|취소|그만(해|둬|두자)?)[!.…~\s]*$/i;
const CONFIRM_MARKER = /\[✅[^\]]*\]|\[❌[^\]]*\]/;

// 데이터 질문 키워드 — 첫 라운드에서 도구 호출 강제 (환각 방지)
const DATA_QUERY_KEYWORDS = [
  '원본', '셀렉', '보정', '추가보정', '액자',
  '고객', '예약', '단계', '촬영',
  '안 한', '안한', '못한', '대기', '필요', '발송',
  '몇 명', '몇명', '얼마나', '누구', '있나', '있어',
  '보여', '알려', '찾아', '검색', '조회',
  '오늘', '어제', '경과', '지났', '늦었',
];

const SYSTEM_PROMPT = `당신은 사진관 "마음껏스튜디오"의 업무 비서입니다.
작가님과 대화하며 사진관 업무 흐름을 도와줍니다.

## 🚨 절대 규칙 (반드시 준수)

### 도구 호출 필수

다음 질문에는 **반드시 search_customers 도구를 먼저 호출**하세요. 도구 호출 없이는 답변하지 마세요.

- 고객 검색 ("XX님 정보", "XX 찾아줘")
- 누락 검색 ("원본 안 한 사람", "보정 발송할 사람", "셀렉 안 온 사람")
- 단계별 조회 ("S4 단계", "촬영 끝난 사람")
- 통계 ("몇 명", "전체 고객")
- 시간 기반 검색 ("오래된", "N일 경과")

### 환각 절대 금지

- 도구 결과 없이 구체적 고객 정보(이름, 예약번호, 날짜)를 답변하지 마세요.
- **존재하지 않는 고객명/예약번호를 만들어내지 마세요.** "테스트박준호" 같은 가짜 이름 절대 금지.
- 모르면 도구 호출 후 답변. 도구 결과가 0건이면 "해당하는 고객이 없습니다" 답변.

### 🚨 이름 불일치 시 반드시 먼저 확인 (절대 규칙)

작가님이 "OOO님 ~~~" 이라고 요청했을 때, 도구 결과의 customer_name이 OOO와 **다르면**:
- **데이터 변경을 절대 실행하지 말 것**
- 먼저 불일치 사실을 알리고 작가님 확인을 받은 후에만 진행

예시:
- 작가님: "권단비님 원본발송 완료"
- search_customers 결과: customer_name="이유미"
- ❌ 잘못된 행동: "권단비님 정보를 찾았습니다 [→ record_milestone 실행]"
- ✅ 올바른 행동: "검색 결과가 '이유미'(예약번호 XXX)인데, 권단비님과 이름이 다릅니다. 이 예약이 맞나요?"
  → 작가님이 확인해줘야 record_milestone 실행

record_milestone의 auto_resolved=true인 경우도 동일: customer_name이 요청한 이름과 다르면 실행 전 확인 필수.

### 답변 검증 (답변 전 자문)

1. 이 답변에 구체적 고객 정보가 있는가?
2. 그 정보는 도구 결과에서 왔는가?
3. 도구 결과의 고객명이 작가님이 요청한 고객명과 일치하는가?

→ 1·2 YES + 3 YES면 OK. 3이 NO면 먼저 불일치를 알리고 확인 요청 후 진행.

### 자연어 → missing 매핑

- "원본 안 한", "원본 발송 안 한", "원본 보낼" → missing="original"
- "셀렉 안 온", "셀렉 안 받은" → missing="selection"
- "보정 발송할", "보정 보낼", "보정 대기" → missing="retouched_pending"
- "보정 후 응답 없는" → missing="revision_response"
- "액자 발주할" → missing="frame"

## 핵심 원칙

사진관은 "단계"보다 "날짜(milestone)"로 관리합니다.
각 고객마다 다음 날짜들을 기록합니다:

- shoot_date: 촬영일
- original_sent_at: 원본 발송일
- selection_received_at: 셀렉 수신일
- retouched_sent_at: 보정본 발송일
- revision_requested_at: 추가보정 요청일
- revision_no_more_at: 추가보정 없음 확정일
- revision_sent_at: 추가보정 발송일
- frame_ordered_at: 액자 발주일

단계(S0~S7)는 이 날짜들로부터 자동 계산됩니다.
사용자에게는 단계로 표시하지만, 당신은 날짜만 기록하면 됩니다.

## 채팅창은 모든 업무가 모이는 단일 공간

대화 컨텍스트에는 3종류의 메시지가 있습니다:

- sender='user': 작가님이 직접 입력한 메시지 (즉시 응답 필요)
- sender='ai': 당신(AI)의 이전 응답
- sender='system': 시스템 자동 알림
  (예: 톡톡 도착 🔔, 예약 메일 📧, 일일점검 📋)

system 메시지는 자동 발생한 알림이며, 작가님이 그 알림에 답장하거나
언급하면 그 컨텍스트로 처리합니다. 예:

  system: "🔔 허희정님 새 메시지: '독사진 밝게'"
  user (system 메시지에 답장): "기록해줘"
  → 답장 컨텍스트의 메시지 내용을 보고 record_milestone 사용

## 🚨 작업 범위 가드레일 (절대 규칙)

작가님이 요청한 작업의 **명시적 범위 안에서만** 도구를 호출하세요.

❌ 절대 금지:
- 작가님이 묻지 않은 작업을 "도움이 될까봐" 임의로 추가하기
- "혹시 X도 함께 하시겠어요?"라고 묻기는 OK, 하지만 OK 받기 전 실행 X
- 단답 "응"/"네"를 직전 메시지의 **마지막 질문에만** 적용
  (직전 메시지가 여러 제안을 포함했다면 작가님이 명시적으로 어느 것에 동의하는지 확인)
- 시스템 알림(system 메시지)에 표시된 정보를 사실로 단정하고 도구 호출
- **작가님이 특정 작업을 요청했는데 관련 없는 system 알림들을 요약·정리해서 보여주기**
  (예: "촬영일 변경해줘" 요청 시 다른 고객 알림 요약은 금지 — 요청한 작업만 처리)

✅ 올바른 행동:
- 작가님 요청에 필요한 도구가 없으면 "그 작업은 직접 SQL로 처리해야 합니다" 안내
- 추가 작업이 필요해 보이면 별도로 명확히 물어보고 OK 받기
- 한 번에 여러 작업이 필요하면 각각 따로 확인

## 신규 도구 안내 (Phase 6-A)

### register_customer
- 사용 시점: 작가님이 "고객 등록해줘", "customers에 추가해줘" 등 명시적으로 요청할 때
- talk_id와 customer_name은 반드시 작가님에게 확인 후 호출
- 동명이인 허용 — 중복 체크 없이 INSERT

### update_customer_name
- 사용 시점: "고객명 바꿔줘", "풀네임 등록해줘" 등 이름 변경 명시 요청 시
- 호출 시 바로 변경하지 않고 확인 카드만 표시됨 (pending 저장)
- 이전에 같은 요청을 한 적 있어도 반드시 도구 호출할 것
- 마스킹명(*) → 풀네임으로 정정하는 용도

### confirm_name_update
- '[NAME_UPDATE_YES]' 메시지 수신 시에만 호출 (채팅창 버튼이 전송)
- customers + bookings customer_name 갱신 + 캘린더 이벤트 제목 자동 패치
- 파라미터 없음 — 그냥 호출만 하면 됨
- AI가 직접 '[NAME_UPDATE_YES]' 등 sentinel을 생성하거나 수동으로 confirm_name_update를 호출하지 말 것

### save_frame_address
- 사용 시점: 고객 톡톡 메시지에 배송 주소가 포함되어 있을 때 자동 호출
  - 도로명/지번 주소 패턴 (시/군/구/동/로/길 등)
  - "지난번 동일 주소", "이전 주소로" → frame_address = '[이전주소동일]' 저장
- talk_id는 현재 대화 상대의 톡톡 ID (시스템 알림에서 확인)
- 받는사람(frame_recipient)이 메시지에 없으면 customer_name 자동 사용
- 연락처가 포함되어 있으면 frame_phone 함께 저장
- 작가님 확인 불필요 — 감지 즉시 자동 저장

### link_talk_id_to_booking
- 연결 요청 시 항상 먼저 호출
- 충돌 없으면 바로 완료
- 충돌 있으면 안내 메시지 표시 후 작가님 응답 대기
- 절대 UPDATE 없음

**booking_id 자동 조회 흐름 (중요)**:
작가님이 고객명만 말하고 booking_id를 주지 않은 경우:
1. search_customers(query=고객명) 호출
2. 결과가 1건이면 → 해당 booking_id로 link_talk_id_to_booking 즉시 호출
3. 결과가 여러 건이면 → show_link_candidates(new_talk_id=XXX, candidates=[...]) 호출 (버튼 표시)
4. 결과가 0건이면 → "해당 고객을 찾을 수 없습니다" 안내

예시: "임은총님 talk_id를 XXX로 바꿔줘"
→ search_customers(query="임은총") → 1건: link_talk_id_to_booking / 여러건: show_link_candidates

### show_link_candidates
- search_customers 결과가 2건 이상일 때만 호출
- new_talk_id: 연결하려는 talk_id
- candidates: search_customers 결과의 booking_id, customer_name, shoot_date 배열 (최대 5건)
- 호출 후 채팅창에 선택 버튼이 뜨면 AI는 추가 메시지 없이 대기

### confirm_pending_link
- 작가님이 충돌 안내를 보고 승인('응', '네', 'ok', '덮어써' 등) 시 호출
- 파라미터 없음 — 그냥 호출만 하면 됨
- 승인 텍스트를 받으면 다른 판단 없이 즉시 이 도구 호출

### confirm_drive_new_products
- ⚠️ AI가 직접 호출하지 마세요. 채팅창 [✅ 추가] 버튼이 보내는 '[DRIVE_CONFIRM_ADD]' 메시지에 대해 chat-api 서버가 직접 트리거합니다.
- '추가', '응', '네' 등 일반 텍스트로는 절대 이 도구를 호출하지 말 것.
- 작가님이 자연어로 "추가해줘"라고 해도 AI는 도구를 호출하지 말고, "카드의 [✅ 추가] 버튼을 눌러주세요" 안내만 하세요.

### link_talk_id_to_booking_force
- 직접 호출 금지. confirm_pending_link가 내부적으로 처리함
- AI가 직접 호출하는 것은 절대 금지

#### 주의사항
- talk_id는 작가님이 명시한 값만 사용. 임의로 추측하거나 다른 고객 talk_id 사용 금지
- 위 도구로 해결 안 되는 작업(대량 수정, 복잡한 조건 등)은
  "SQL로 직접 처리가 필요합니다. 쿼리를 안내해드릴까요?" 로 안내

## 🚨 수행 불가능한 작업 안내

다음 작업은 현재 AI 도구로 처리 불가능합니다. 요청 시 안내만 하고 도구 호출 X:

- 캘린더 이벤트 직접 열기/삭제/공유 설정 변경 등 캘린더 앱 수준 조작

⚠️ 혼동 주의: **촬영일(shoot_date) 변경은 불가 아닙니다.**
"OOO님 촬영일 N월 N일 N시로 변경해줘" → record_milestone(shoot) 도구 호출 (캘린더 자동 동기화 포함)

이런 요청이 오면:
"현재 AI 도구로는 처리할 수 없는 작업입니다. SQL로 직접 처리 부탁드려요.
필요하시면 SQL 쿼리 예시를 보여드릴 수 있습니다."

## 작가님 단축 표현 → milestone 매핑

작가님이 아래 표현을 사용할 때 record_milestone을 기록하세요.

**⚠️ 이름 불일치 처리 (중요)**
- record_milestone 결과 customer_name이 OOO와 다르면:
  → 처리 후 즉시 "⚠️ 처리했지만 찾은 고객명은 '실제이름'이며, 말씀하신 'OOO'과 다릅니다. 맞는 예약인가요?"
- 잘못된 경우 작가님이 확인 후 되돌릴 수 있도록 안내하세요.

| 표현 | milestone_type |
|------|---------------|
| "OOO님 보정", "OOO 보정", "OOO님 보정하기" | selection_received |
| "OOO님 원본 발송", "OOO 원본 보냈어", "OOO 원본 줬어" | original_sent |
| "OOO님 보정본 발송", "OOO 보정 발송", "OOO 보정 줬어", "OOO 보정 보냈어" | retouched_sent |
| "OOO님 추가보정 발송", "OOO 추가보정 보냈어" | revision_sent |

예시: "최윤하님 보정" → record_milestone(booking_id=최윤하 예약, milestone_type=selection_received)

## 🚨 record_milestone 입력 형식 (절대 규칙)

shoot_date를 record_milestone으로 기록할 때:

✅ 올바른 형식: "2026-06-14 11:00:00" (날짜 + 시간, SQLite 형식)
❌ 잘못된 형식: "2026-06-14" (시간 누락), "2026-06-14T11:00:00.000Z" (ISO 형식)

작가님이 시간을 명시하지 않은 경우:
- ❌ 임의로 추측 금지 ("아마 오전 11시일 거예요" 같은 추론 X)
- ✅ "촬영일이 6월 14일 몇 시인가요?" 물어보기

### 연도 추론 규칙 (연도를 명시하지 않은 경우)

기존 shoot_date의 연도를 기준으로 추론합니다.

1. 기존 연도 + 변경하려는 월/일로 날짜를 구성
2. 구성한 날짜가 기존 shoot_date보다 **과거**이면 → 연도 +1
3. 같거나 미래이면 → 기존 연도 그대로 사용

예시:
- 기존 2026-12-20, "1월 3일로 변경" → 2026-01-03은 기존보다 과거 → **2027-01-03**
- 기존 2026-05-23, "6월 1일로 변경" → 2026-06-01은 기존보다 미래 → **2026-06-01**
- 기존 2026-05-23, "11시로 변경" (날짜 그대로, 시간만) → 월/일 유지, **2026-05-23 11:00:00**

다른 milestone (original_sent_at 등)은 시간 없이도 OK — datetime('now') 자동 사용.

## 🚨 시스템 알림(system) 메시지 신중 해석

system 메시지에 표시된 정보는 **요약/마스킹된 정보**입니다.
실제 데이터와 다를 수 있으니, 다음 정보는 system 메시지만 보고 사실로 단정하지 마세요:

- 마스킹된 고객명 (예: "김*재" → 실제 풀네임 모름)
- 부분 정보로 보이는 날짜·시간

이런 정보가 필요하면 **search_customers 도구로 정확한 값을 조회**하세요.

## 호칭 규칙 (중요)

- 사용자를 항상 "작가님"이라고 부릅니다.
- 이전 대화에서 다른 호칭이 사용되었더라도 무시하고 "작가님"으로 통일.

## 사용 가능한 도구

- record_milestone: 예약의 milestone 날짜 기록 (단계는 자동 계산, S6까지만)
- search_customers: 고객/누락 단계 검색
- update_customer_memo: 고객 메모 한 줄 추가
- add_learned_rule: 반복 패턴을 학습 규칙으로 저장
- register_product / update_product / list_products: 상품 등록·수정·목록
- register_question / list_questions: 추가 질문(상품별 추가 안내문) 등록·목록
- manual_match_booking_detail: 메일 매칭 실패한 예약 항목을 수동으로 상품에 연결
- save_frame_address: 고객 배송 주소 자동 감지·저장 (확인 불필요, 즉시 호출)
- cancel_booking: 예약 취소 처리 (확인 카드 표시 후 작가님 승인 시 실행)

## 도구 사용 가이드

작가님이 "단계 변경" "S4로 바꿔줘" 같은 표현을 쓰면 milestone 기록으로 변환:

- "S2 원본발송" 의미 → record_milestone(original_sent)
- "S3 셀렉수신" 의미 → record_milestone(selection_received, content="셀렉컷")
- "S4 보정발송" 의미 → record_milestone(retouched_sent)
- "S5a 추가보정요청" 의미 → record_milestone(revision_requested, content="요청내용")
- "S5b 추가보정없음" 의미 → record_milestone(revision_no_more)
- "S6 추가보정발송" 의미 → record_milestone(revision_sent)
- "S7 액자발주" → ⚠️ **AI 처리 불가. 아뜨레 발주 시스템에서 자동 처리됨**

상품/질문 관리 표현 매핑:

- "클래식 가족사진 등록해줘. 코드 FAM_CLASSIC, 가격 150000, 보정 1장, 8×10인치 원목액자 1개"
  → register_product(product_code="FAM_CLASSIC", product_name="클래식 가족사진",
                     match_keyword="클래식 가족", price=150000, retouch_count=1,
                     frame_count=1, frame_size="8×10인치 원목")
- "products 목록 보여줘" / "상품 목록"
  → list_products()
- "FAM_CLASSIC 가격 180000원으로 바꿔줘"
  → update_product(identifier="FAM_CLASSIC", updates={price:180000})
- "FAM_CLASSIC 비활성화해줘"
  → update_product(identifier="FAM_CLASSIC", updates={is_active:0})
- "BABY_INFO 질문 등록해줘. 트리거 '아기사진', 내용 '아이 이름/성별/나이...'"
  → register_question(question_code="BABY_INFO", trigger_keyword="아기사진",
                      question_text="아이 이름/성별/나이...")
- "추가 질문 목록"
  → list_questions()
- "booking_detail #N을 FAM_CLASSIC으로 매칭해줘"
  → manual_match_booking_detail(booking_detail_id=N, product_identifier="FAM_CLASSIC")

자연어도 적절히 변환:

- "원본 보냈어" → record_milestone(original_sent)
- "셀렉 받았어, 02060,02127번이래" → record_milestone(selection_received, content="02060,02127")
- "독사진 더 밝게 해달래" → record_milestone(revision_requested, content="독사진 더 밝게")

검색/조회 시 부가 정보:

- retouched_pending 결과의 각 행은 pending_reason 필드를 갖습니다:
  "first_retouch"(첫 보정 대기) 또는 "revision_retouch"(추가보정 발송 대기).

**중요**: 위 record_milestone 매핑 중 shoot 관련 변경 시,
이전 shoot_date 값이 SQLite 형식("YYYY-MM-DD HH:MM:SS")이 아닌 경우
시스템이 입력을 거부합니다. 형식 확인 후 호출하세요.

예약 취소 표현 매핑:

- "OOO님 예약 취소해줘" / "OOO님 취소 처리" / "OOO 취소"
  → cancel_booking(booking_id="OOO") 즉시 호출
  → 도구가 확인 카드를 채팅창에 표시하므로 작가님에게 따로 묻지 말고 바로 호출

## 🚨 frame_ordered_at (S7 액자발주) 절대 규칙

**frame_ordered_at은 아뜨레 발주 프로그램 webhook에서만 자동 설정됩니다.**
- 고객이 "액자는 이거로 할게요", "액자 2장으로 해주세요" 등 어떤 말을 해도 **절대 frame_ordered_at 변경 금지**
- 작가님이 "액자 발주했어", "액자 주문했어" 등 말해도 **AI가 직접 변경 불가**
- 아뜨레에서 실제 발주가 완료되면 시스템이 자동으로 처리함
- 이 항목에 관한 요청이 오면: "S7 액자발주는 아뜨레 프로그램에서 발주 시 자동으로 기록됩니다."라고 안내

## 안전 장치

- record_milestone 같은 중요 동작은 실행 전 작가님 확인:
  "허희정님 보정본 발송 기록할까요? [✅ 네] [❌ 아니오]"
  작가님이 "네" 답변한 후에만 도구 호출.
- 도구 실행 후에는 결과를 자연스럽게 한국어로 보고.

## 사용자 응답 해석 규칙 (중요)

작가님이 짧은 줄임말로 답할 때 다음과 같이 해석합니다.

다음 응답은 모두 **"네/긍정"**으로 해석:
- 네, 응, ㅇㅇ, ㅇㅋ, 오케이, 오키, ok, OK, Ok, 예, 좋아, 그래, 진행

다음 응답은 모두 **"아니오/거부"**로 해석:
- 아니, 아니오, 노, no, NO, 안 해, 안해, 취소, 그만

긍정 응답을 받으면 직전 컨텍스트의 동작을 즉시 도구 호출로 진행합니다.
거부 응답을 받으면 도구 호출 없이 "알겠습니다, 진행하지 않을게요." 같이 안내합니다.

## 도구 호출 강제 규칙 (가장 중요)

"완료!", "기록했습니다", "처리됐습니다", "저장했어요", "반영했어요" 같은 표현을
사용하려면 **반드시 그 직전에 실제 도구 호출(record_milestone 등)이 있어야 합니다.**

도구 호출 없이 완료 표현을 사용하는 것은 환각이며 절대 금지입니다.

만약 도구를 호출해야 하는 상황인데 호출하지 않은 상태라면,
"기록하시려면 [✅ 네] 답변 부탁드려요" 같이 다시 확인을 요청해야 합니다.

체크리스트 (도구 호출 전 자가 검증):
- 어떤 milestone을 기록할지 명확한가? (booking_id, milestone_type)
- 작가님 긍정 응답을 받았는가?
- 위 두 조건을 만족하면 즉시 record_milestone 호출, 그 결과를 받아 자연어로 보고

## booking_id 확정 규칙 (필수)

**record_milestone, update_customer_memo 등 booking_id/talk_id가 필요한 도구를 호출하기 전에,
booking_id를 확실히 알지 못한다면 반드시 search_customers를 먼저 호출하여 정확한
booking_id를 확인한 후 사용해야 합니다.** 절대로 booking_id를 추측하거나 임의로 만들지 마세요.

확실하다고 판단할 수 있는 경우:
- 동일 대화 안에서 직전에 search_customers를 호출하여 결과로 받은 booking_id
- 직전 시스템/도구 응답이 명시적으로 booking_id를 포함한 경우
- 작가님이 이번 메시지에서 booking_id를 직접 입력한 경우

위에 해당하지 않으면 **불확실**한 상태이며, search_customers를 먼저 호출:
- 작가님이 고객명을 말했으면 → search_customers(query="고객명")
- 검색 결과가 1건이면 그 booking_id를 사용
- 여러 건이면 작가님에게 어느 예약인지 다시 확인 요청
- 0건이면 "해당 고객을 찾을 수 없습니다" 안내

예시:
  user: "허희정님 보정본 발송 기록해줘"
  → AI: search_customers(query="허희정") 먼저 호출
  → 결과로 booking_id 확보 후 record_milestone(booking_id=..., milestone_type="retouched_sent")

## update_customer_memo talk_id 규칙 (절대 금지)

update_customer_memo 호출 시 talk_id는 반드시 customers 테이블의 talk_id 값을 사용해야 합니다.

- talk_id 형식: 영문+숫자+특수문자 조합, 22자 내외 (예: "2TQb895EgMn9-1lSDBERmg")
- booking_id(숫자 10자리, 예: "1242415271")를 talk_id 자리에 넣는 것은 **절대 금지**
- 고객 컨텍스트(search_customers 결과 등)에서 talk_id를 확인한 후 호출할 것
- talk_id가 확보되지 않은 상태에서 booking_id를 대신 사용하지 말 것

## record_milestone 응답 처리

record_milestone 도구는 booking_id가 일치하지 않으면 자동으로 고객명 검색을 수행합니다.
응답 처리 가이드:

- **success=true, auto_resolved=true**: booking_id 대신 고객명을 넣었지만 자동으로 1건이
  찾혀서 기록되었음. "{customer_name}님의 booking_id를 자동으로 찾아서 기록했습니다"
  같이 자연스럽게 안내.
- **success=true, auto_resolved=false**: 정상 기록.
- **error="여러 고객이 매칭됩니다", matches=[...]**: 후보를 작가님께 보여주고 선택 요청.
  예: "여러 분이 매칭됩니다. 어느 분일까요?\n
       - 허희정 (TEST-2026-001) — S2 원본발송\n
       - 허희정민 (TEST-2026-007) — S4 보정발송"
  작가님 선택을 받은 뒤 정확한 booking_id로 다시 record_milestone 호출.
- **error="고객을 찾을 수 없습니다: ..."**: 검색어를 다르게 입력해 달라고 요청 또는
  search_customers를 다른 키워드로 시도.

## 답장 컨텍스트 활용

작가님이 짧은 답변(네, ㅇㅋ, 응 등)만 보냈을 때 처리 순서:
1. **reply_to가 있으면** 그 메시지의 컨텍스트를 기준으로 동작
   (예: 직전 AI 메시지 "허희정님 보정본 발송 기록할까요?"에 답장으로 "ㅇㅋ" → record_milestone 호출)
2. **reply_to가 없으면** 직전 AI 메시지를 컨텍스트로 사용
   (대화 히스토리의 마지막 assistant 메시지가 확인 요청이었다면 그것을 처리)
3. **컨텍스트가 불명확하면** 도구 호출하지 말고 "어떤 작업 진행할까요?" 재확인

## 현재일정 조회

- "현재일정", "일정확인", "현황", "리포트" 키워드가 포함된 메시지는 시스템이 자동으로 처리합니다.
- AI가 별도로 도구를 호출하거나 답변을 생성하지 않아도 됩니다.

## 답변 원칙

- 간결하고 친근한 한국어
- 확실하지 않으면 작가님에게 확인 요청
- 작가님이 단계로 말해도 (예: "S4로 바꿔줘") 적절한 milestone 기록으로 변환
- "완료" 표현은 도구 호출 결과를 받은 후에만 사용`;

// ─── helpers ────────────────────────────────────────────────────────────

interface ChatRow {
  id: number;
  sender: string;
  message: string;
  reply_to_id: number | null;
  metadata: string | null;
  created_at: string;
}

function parseMetadata(raw: string | null): Record<string, any> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToMessage(row: ChatRow, replyTo: ChatMessage | null = null): ChatMessage {
  return {
    id: row.id,
    sender: row.sender as ChatSender,
    message: row.message,
    reply_to_id: row.reply_to_id,
    reply_to: replyTo,
    metadata: parseMetadata(row.metadata),
    created_at: row.created_at,
  };
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// ─── GET /api/chat/messages ─────────────────────────────────────────────

export async function handleGetMessages(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200);
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw ? parseInt(beforeRaw) : null;

  const sql = `
    SELECT
      m.id, m.sender, m.message, m.reply_to_id, m.metadata, m.created_at,
      r.id AS r_id, r.sender AS r_sender, r.message AS r_message,
      r.reply_to_id AS r_reply_to_id, r.metadata AS r_metadata, r.created_at AS r_created_at
    FROM ai_chat_messages m
    LEFT JOIN ai_chat_messages r ON r.id = m.reply_to_id
    WHERE (?1 IS NULL OR m.id < ?1)
    ORDER BY m.id DESC
    LIMIT ?2
  `;

  const result = await env.DB.prepare(sql).bind(before, limit).all<any>();

  const messages: ChatMessage[] = (result.results || []).map((r) => {
    const reply: ChatMessage | null = r.r_id
      ? rowToMessage({
          id: r.r_id,
          sender: r.r_sender,
          message: r.r_message,
          reply_to_id: r.r_reply_to_id,
          metadata: r.r_metadata,
          created_at: r.r_created_at,
        })
      : null;
    return rowToMessage(
      {
        id: r.id,
        sender: r.sender,
        message: r.message,
        reply_to_id: r.reply_to_id,
        metadata: r.metadata,
        created_at: r.created_at,
      },
      reply
    );
  });

  // photo_upload 메시지에 현재 그룹 상태 enrichment
  // 다른 메시지의 사진도 같은 그룹이면 primary 메시지에 모아서 표시
  const photoMsgs = messages.filter(
    (m) => m.metadata && (m.metadata as any).type === 'photo_upload'
  );
  if (photoMsgs.length > 0) {
    const allPhotoIds: number[] = photoMsgs.flatMap(
      (m) => ((m.metadata as any).photo_ids as number[]) || []
    );
    if (allPhotoIds.length > 0) {
      // 1. 현재 메시지들의 사진 → group_id 조회
      const ph = allPhotoIds.map((_, i) => `?${i + 1}`).join(',');
      const rows = await env.DB.prepare(
        `SELECT id, group_id, group_order, file_name, created_at FROM photo_uploads WHERE id IN (${ph})`
      )
        .bind(...allPhotoIds)
        .all<{ id: number; group_id: string | null; group_order: number; file_name: string; created_at: string }>();

      const groupMap = new Map<number, { group_id: string | null; group_order: number }>();
      const photoInfoMap = new Map<number, { file_name: string; created_at: string }>();
      for (const row of rows.results ?? []) {
        groupMap.set(row.id, { group_id: row.group_id, group_order: row.group_order });
        photoInfoMap.set(row.id, { file_name: row.file_name, created_at: row.created_at });
      }

      // 2. 발견된 그룹 ID 목록 → 그룹에 속한 모든 사진 조회 (다른 메시지 사진 포함)
      const groupIds = [...new Set(
        [...groupMap.values()].map(v => v.group_id).filter(Boolean) as string[]
      )];
      const allGroupPhotoMap = new Map<string, number[]>(); // group_id → 전체 photo_ids
      if (groupIds.length > 0) {
        const gph = groupIds.map((_, i) => `?${i + 1}`).join(',');
        const gRows = await env.DB.prepare(
          `SELECT id, group_id, file_name, created_at FROM photo_uploads WHERE group_id IN (${gph}) ORDER BY group_order, id`
        )
          .bind(...groupIds)
          .all<{ id: number; group_id: string; file_name: string; created_at: string }>();
        for (const r of gRows.results ?? []) {
          if (!allGroupPhotoMap.has(r.group_id)) allGroupPhotoMap.set(r.group_id, []);
          allGroupPhotoMap.get(r.group_id)!.push(r.id);
          if (!photoInfoMap.has(r.id)) photoInfoMap.set(r.id, { file_name: r.file_name, created_at: r.created_at });
        }
      }

      // 3. 각 그룹의 primary 메시지 결정 — 그룹 사진을 가장 먼저(낮은 id) 포함한 메시지
      // messages는 DESC 순서이므로 reverse해서 ASC로 순회
      const groupPrimaryMsg = new Map<string, number>(); // group_id → msg.id
      for (const msg of [...photoMsgs].sort((a, b) => a.id - b.id)) {
        const photoIds: number[] = (msg.metadata as any).photo_ids || [];
        for (const pid of photoIds) {
          const gid = groupMap.get(pid)?.group_id;
          if (gid && !groupPrimaryMsg.has(gid)) groupPrimaryMsg.set(gid, msg.id);
        }
      }

      // 4. 각 메시지에 enriched 그룹 정보 주입
      for (const msg of photoMsgs) {
        const photoIds: number[] = (msg.metadata as any).photo_ids || [];
        const seenGroups = new Set<string>();
        const groups: Array<{ group_id: string; photo_ids: number[]; is_primary: boolean }> = [];
        const ungrouped: number[] = [];

        for (const pid of photoIds) {
          const info = groupMap.get(pid);
          if (!info) continue; // 삭제된 사진은 건너뜀
          if (info.group_id) {
            if (!seenGroups.has(info.group_id)) {
              seenGroups.add(info.group_id);
              const isPrimary = groupPrimaryMsg.get(info.group_id) === msg.id;
              groups.push({
                group_id: info.group_id,
                // primary 메시지에는 그룹 전체 사진, non-primary는 빈 배열
                photo_ids: isPrimary ? (allGroupPhotoMap.get(info.group_id) ?? []) : [],
                is_primary: isPrimary,
              });
            }
          } else {
            ungrouped.push(pid);
          }
        }

        (msg.metadata as any).groups = groups;
        (msg.metadata as any).ungrouped = ungrouped;

        // 이 메시지에서 실제 렌더되는 photo_id → {file_name, created_at} 맵
        const visibleIds = [
          ...ungrouped,
          ...groups.filter(g => g.is_primary).flatMap(g => g.photo_ids),
        ];
        const photo_info: Record<string, { file_name: string; created_at: string }> = {};
        for (const pid of visibleIds) {
          const info = photoInfoMap.get(pid);
          if (info) photo_info[String(pid)] = info;
        }
        (msg.metadata as any).photo_info = photo_info;
      }
    }
  }

  return Response.json({ messages, hasMore: messages.length >= limit });
}

// ─── POST /api/chat/send ────────────────────────────────────────────────

export async function handleSend(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: ChatSendRequest;
  try {
    body = await request.json<ChatSendRequest>();
  } catch {
    return jsonError(400, '잘못된 JSON 본문');
  }

  const message = (body.message || '').trim();
  if (!message) {
    return jsonError(400, 'message 필드가 비어 있습니다');
  }
  const replyToId =
    typeof body.reply_to_id === 'number' && Number.isInteger(body.reply_to_id)
      ? body.reply_to_id
      : null;

  const result = await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
     VALUES ('user', ?1, ?2, NULL, datetime('now'))
     RETURNING id, created_at`
  )
    .bind(message, replyToId)
    .first<{ id: number; created_at: string }>();

  if (!result) {
    return jsonError(500, '메시지 저장 실패');
  }

  console.log(`[chat] user message saved id=${result.id}`);

  // Phase 6-B: Drive 폴더 링크 감지 → AI 호출 전 처리
  if (message.includes('drive.google.com/drive/folders/')) {
    try {
      await processDriveLinkInMessage(env, message);
    } catch (e) {
      console.error('[chat] Drive 링크 처리 실패:', e);
      await insertDriveSystemMessage(
        env,
        `⚠️ Drive 링크 처리 실패: ${e instanceof Error ? e.message : String(e)}`,
        { type: 'drive_error', error: e instanceof Error ? e.message : String(e) },
      );
    }
  }

  const response: ChatSendResponse = {
    id: result.id,
    created_at: result.created_at,
  };
  return Response.json(response);
}

// ─── Phase 6-B: Drive 링크 처리 ─────────────────────────────────────────

async function insertDriveSystemMessage(
  env: Env,
  body: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  )
    .bind(body, JSON.stringify(metadata))
    .run();
}

async function processDriveLinkInMessage(env: Env, message: string): Promise<void> {
  const folderId = extractFolderIdFromUrl(message);
  if (!folderId) {
    await insertDriveSystemMessage(
      env,
      '⚠️ Drive 링크에서 folder ID를 추출할 수 없습니다.',
      { type: 'drive_parse_failed', reason: 'folder_id_missing' },
    );
    return;
  }

  const current = await getFolderInfo(env as any, folderId);
  const linkType = detectLinkType(current.name);

  if (linkType === 'unknown') {
    await insertDriveSystemMessage(
      env,
      `⚠️ 폴더명에서 원본/보정본을 구분할 수 없습니다.\n폴더명이 '원본' 또는 '보정본'을 포함하는지 확인해주세요.\n현재 폴더명: ${current.name}`,
      {
        type: 'drive_unknown_link_type',
        folder_id: folderId,
        folder_name: current.name,
      },
    );
    return;
  }

  const parent = await getParentFolder(env as any, folderId);
  if (!parent) {
    await insertDriveSystemMessage(
      env,
      '⚠️ 상위 폴더 정보를 가져올 수 없습니다.',
      { type: 'drive_no_parent', folder_id: folderId },
    );
    return;
  }

  const parsed = parseFolderName(parent.name);
  if (!parsed) {
    await insertDriveSystemMessage(
      env,
      `⚠️ 상위 폴더명 형식을 인식할 수 없습니다.\n형식: yyyyMMdd 고객명님(상품1,상품2)\n현재 상위 폴더명: ${parent.name}`,
      {
        type: 'drive_parent_parse_failed',
        parent_folder_id: parent.id,
        parent_folder_name: parent.name,
      },
    );
    return;
  }

  const matchResult = await matchBookingByFolderName(env.DB, parsed);

  // 오발송 체크 (zip 파일명에서 고객명 추출 → 폴더명 고객명과 비교, "님" 제거 후 비교)
  const normalizeCustomer = (s: string) => s.replace(/님$/, '').trim();
  let mismatched = false;
  let mismatchFileName: string | null = null;
  let mismatchCustomer: string | null = null;
  try {
    const childrenResult = await getFolderChildren(env as any, folderId);
    const zips = (childrenResult.files || []).filter((f) =>
      /\.zip$/i.test(f.name),
    );
    for (const zip of zips) {
      const extracted = extractCustomerNameFromFilename(zip.name);
      if (
        extracted &&
        normalizeCustomer(extracted) !== normalizeCustomer(parsed.customerName)
      ) {
        mismatched = true;
        mismatchFileName = zip.name;
        mismatchCustomer = extracted;
        break;
      }
    }
  } catch (e) {
    console.warn('[chat] Drive children 조회 실패 (오발송 체크 스킵):', e);
  }

  if (mismatched) {
    await insertDriveSystemMessage(
      env,
      `🚨 오발송 주의!\n폴더명 고객: ${parsed.customerName}\n파일명 고객: ${mismatchCustomer}\n파일명: ${mismatchFileName}\n다른 고객님의 사진을 보내려고 합니다. 확인하시기 바랍니다.`,
      {
        type: 'drive_mismatch_alert',
        folder_customer: parsed.customerName,
        file_customer: mismatchCustomer,
        file_name: mismatchFileName,
        folder_id: folderId,
      },
    );
  }

  // booking 매칭 + URL UPDATE
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  if (matchResult.booking) {
    const column =
      linkType === 'original' ? 'original_folder_url' : 'retouched_folder_url';
    await env.DB.prepare(
      `UPDATE bookings SET ${column} = ?1, updated_at = datetime('now')
       WHERE booking_id = ?2`,
    )
      .bind(folderUrl, matchResult.booking.booking_id)
      .run();
    console.log(
      `[chat] Drive link 저장 booking=${matchResult.booking.booking_id} type=${linkType}`,
    );
  }

  const summary = [
    `🔗 Drive 폴더 감지 — ${linkType === 'original' ? '원본' : '보정본'}`,
    `폴더명: ${current.name}`,
    `상위 폴더: ${parent.name}`,
    `파싱: ${parsed.date} / ${parsed.customerName} / 상품: ${parsed.products.join(', ') || '(없음)'}`,
    matchResult.booking
      ? `✅ 예약 매칭: ${matchResult.booking.booking_id} (${matchResult.booking.customer_name})${matchResult.booking.shoot_date ? ' / 촬영 ' + matchResult.booking.shoot_date : ''}`
      : `⚠️ 예약 매칭 실패: ${matchResult.reason}`,
    mismatched ? '🚨 오발송 의심 — 위 경보 메시지 참고' : '',
  ]
    .filter(Boolean)
    .join('\n');

  await insertDriveSystemMessage(env, summary, {
    type: 'drive_link_processed',
    link_type: linkType,
    folder_id: folderId,
    folder_name: current.name,
    parent_folder_name: parent.name,
    parsed,
    matched_booking_id: matchResult.booking?.booking_id ?? null,
    match_reason: matchResult.reason,
    is_mismatched: mismatched,
    drive_link: folderUrl,
  });

  // Step 4: 보정본 폴더는 현장 추가 매칭 건너뛰고 바로 발송 문구 생성
  if (matchResult.booking && linkType === 'retouched') {
    try {
      await buildRetouchedSendMessage(env.DB, matchResult.booking.booking_id, folderUrl, env.BASE_URL);
    } catch (e) {
      console.error('[chat] buildRetouchedSendMessage 실패:', e);
    }
    return;
  }

  // Step 3: 현장 추가 상품 감지 (booking 매칭 + 원본 폴더 + 폴더에 상품 토큰 있을 때)
  if (matchResult.booking && linkType === 'original' && parsed.products.length === 0) {
    // 폴더에 상품 토큰이 아예 없으면 → 바로 원본 발송 문구
    try {
      await buildOriginalSendMessage(env.DB, matchResult.booking.booking_id, folderUrl, env.BASE_URL);
    } catch (e) {
      console.error('[chat] buildOriginalSendMessage 실패:', e);
    }
    return;
  }

  if (matchResult.booking && linkType === 'original' && parsed.products.length > 0) {
    try {
      const productMatch = await matchProductsFromFolder(
        env.DB,
        parsed.products,
        matchResult.booking.booking_id,
      );

      if (
        productMatch.newProducts.length === 0 &&
        productMatch.unmatched.length === 0
      ) {
        await insertDriveSystemMessage(
          env,
          '✅ 폴더명의 모든 상품이 기존 예약과 일치합니다.',
          {
            type: 'drive_products_all_covered',
            booking_id: matchResult.booking.booking_id,
            already_covered: productMatch.alreadyCovered,
          },
        );
      }

      // 카드 순서: ℹ️ 메모(unmatched) 먼저 → 🛍️ 현장 추가(newProducts) 마지막
      if (productMatch.unmatched.length > 0) {
        // bookings.request_note에 [현장메모] append (booking 매칭된 경우에만)
        const memoLine = `[현장메모] ${productMatch.unmatched.join(', ')}`;
        const noteRow = await env.DB.prepare(
          `SELECT request_note FROM bookings WHERE booking_id = ?1`,
        )
          .bind(matchResult.booking.booking_id)
          .first<{ request_note: string | null }>();
        const existing = noteRow?.request_note?.trim();
        const newNote = existing ? `${existing}\n${memoLine}` : memoLine;
        await env.DB.prepare(
          `UPDATE bookings
           SET request_note = ?1, updated_at = datetime('now')
           WHERE booking_id = ?2`,
        )
          .bind(newNote, matchResult.booking.booking_id)
          .run();

        const body =
          `아래 항목은 상품으로 인식되지 않아 예약 메모에 저장되었습니다:\n` +
          productMatch.unmatched.map((u) => `- ${u}`).join('\n');
        await insertDriveSystemMessage(env, body, {
          type: 'drive_unknown_tokens',
          booking_id: matchResult.booking.booking_id,
          tokens: productMatch.unmatched,
          icon: 'ℹ️',
        });
      }

      if (productMatch.newProducts.length > 0) {
        const coveredList =
          productMatch.alreadyCovered.length > 0
            ? productMatch.alreadyCovered.join(', ')
            : '없음';
        const newList = productMatch.newProducts
          .map((p) => `${p.product_name} (← ${p.matchedKeywords.join(', ')})`)
          .join('\n - ');
        const body =
          `🛍️ 현장 추가 상품이 감지되었습니다.\n\n` +
          `예약번호: ${matchResult.booking.booking_id} (${matchResult.booking.customer_name})\n` +
          `기존 예약 상품: ${coveredList}\n` +
          `추가 감지 상품:\n - ${newList}\n\n` +
          `booking_details에 추가할까요?`;
        await insertDriveSystemMessage(env, body, {
          type: 'drive_new_products_detected',
          booking_id: matchResult.booking.booking_id,
          customer_name: matchResult.booking.customer_name,
          newProducts: productMatch.newProducts,
          alreadyCovered: productMatch.alreadyCovered,
          actions: [
            { label: '✅ 추가', prompt: '추가', style: 'primary' },
            { label: '❌ 건너뛰기', prompt: '건너뛰기', style: 'secondary' },
          ],
        });
      }

      // 마지막: 원본 폴더 + 현장 추가 없음 → 원본 발송 문구 생성
      // (현장 추가 있으면 confirm_drive_new_products가 처리)
      if (productMatch.newProducts.length === 0) {
        try {
          await buildOriginalSendMessage(
            env.DB,
            matchResult.booking.booking_id,
            folderUrl,
            env.BASE_URL,
          );
        } catch (e) {
          console.error('[chat] buildOriginalSendMessage 실패:', e);
        }
      }
    } catch (e) {
      console.error('[chat] 상품 매칭 실패:', e);
    }
  }
}


// ─── POST /api/chat/ai-process ──────────────────────────────────────────

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicResponse {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * 오늘(KST) AI 호출 횟수를 metadata.kind='ai_call' 인 ai 메시지로 카운트.
 * KST 기준 오늘 00:00 = UTC 어제 15:00.
 */
export async function countTodayAICalls(db: D1Database): Promise<number> {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 3600 * 1000;
  const kst = new Date(kstMs);
  const startUtcMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600 * 1000;
  const startUtc = new Date(startUtcMs).toISOString();

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM ai_chat_messages
       WHERE sender = 'ai'
         AND created_at >= ?1
         AND metadata IS NOT NULL
         AND json_extract(metadata, '$.kind') = 'ai_call'`
    )
    .bind(startUtc)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

export async function handleAIProcess(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: AIProcessRequest;
  try {
    body = await request.json<AIProcessRequest>();
  } catch {
    return jsonError(400, '잘못된 JSON 본문');
  }

  if (!body.user_message_id || !Number.isInteger(body.user_message_id)) {
    return jsonError(400, 'user_message_id 필요');
  }

  // 1. 한도 체크
  const dailyLimit = parseInt(env.AI_DAILY_LIMIT || '') || DEFAULT_DAILY_LIMIT;
  const todayCount = await countTodayAICalls(env.DB);
  if (todayCount >= dailyLimit) {
    console.log(`[chat] AI 호출 한도 초과 (today=${todayCount}/${dailyLimit})`);
    return jsonError(429, `AI 호출 한도 초과 (오늘 ${todayCount}/${dailyLimit})`);
  }

  // 2. user 메시지 + reply_to 조회
  const userRow = await env.DB.prepare(
    `SELECT m.id, m.sender, m.message, m.reply_to_id, m.metadata, m.created_at,
            r.id AS r_id, r.sender AS r_sender, r.message AS r_message,
            r.reply_to_id AS r_reply_to_id, r.metadata AS r_metadata, r.created_at AS r_created_at
     FROM ai_chat_messages m
     LEFT JOIN ai_chat_messages r ON r.id = m.reply_to_id
     WHERE m.id = ?1`
  )
    .bind(body.user_message_id)
    .first<any>();

  if (!userRow) {
    return jsonError(404, '메시지를 찾을 수 없습니다');
  }

  // Phase 6-B Step 3: 사용자 메시지에 Drive 폴더 링크가 있으면 AI 일반 처리 차단.
  // 별도 ai 말풍선도 만들지 않음 — Drive 처리 결과는 system 메시지 카드로만 표시.
  if (
    typeof userRow.message === 'string' &&
    userRow.message.includes('drive.google.com/drive/folders/')
  ) {
    return Response.json({ skipped: true, reason: 'drive_link' });
  }

  // Drive 확정 버튼 sentinel — AI 우회. confirm_drive_new_products 직접 실행 또는 skip 처리.
  const userText = typeof userRow.message === 'string' ? userRow.message : '';

  // ── Phase 7: photo_booking_candidates sentinel ──────────────────────────────
  const photoLinkMatch = /^\[PHOTO_LINK_SELECT_(\d+)\]$/.exec(userText);
  if (photoLinkMatch) {
    const idx = parseInt(photoLinkMatch[1], 10);
    const candidatesMsg = await env.DB.prepare(
      `SELECT id, metadata FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'photo_booking_candidates'
       ORDER BY id DESC LIMIT 1`
    ).first<{ id: number; metadata: string }>();

    let resultMessage = '';
    if (!candidatesMsg) {
      resultMessage = '선택할 후보 목록을 찾을 수 없습니다.';
    } else {
      let meta: { photo_ids?: number[]; candidates?: Array<{ index: number; booking_id: string; customer_name: string }> } = {};
      try { meta = JSON.parse(candidatesMsg.metadata); } catch { /* empty */ }
      const candidate = (meta.candidates ?? []).find((c) => c.index === idx);
      if (!candidate || !meta.photo_ids?.length) {
        resultMessage = `${idx}번 후보를 찾을 수 없습니다.`;
      } else {
        const placeholders = meta.photo_ids.map((_, i) => `?${i + 2}`).join(',');
        await env.DB.prepare(
          `UPDATE photo_uploads SET booking_id = ?1 WHERE id IN (${placeholders})`
        ).bind(candidate.booking_id, ...meta.photo_ids).run();
        await env.DB.prepare(
          `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'photo_booking_candidates_used') WHERE id = ?1`
        ).bind(candidatesMsg.id).run();
        resultMessage = `✅ ${candidate.customer_name} 예약에 연결했습니다.`;
      }
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`
    ).bind(
      resultMessage,
      body.user_message_id,
      JSON.stringify({ kind: 'ai_call', source: 'photo_link_select' }),
    ).first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  // 현재일정 키워드 → runMorningReport(force=true) 즉시 실행, AI 우회
  const REPORT_KEYWORDS = ['현재일정', '현재 일정', '일정확인', '리포트', '현황'];
  if (REPORT_KEYWORDS.some((kw) => userText.includes(kw))) {
    try {
      await runMorningReport(env as any, true);
    } catch (e) {
      console.error('[chat-api] runMorningReport 실패:', e);
    }
    return Response.json({ skipped: true, reason: 'morning_report' });
  }
  if (userText === '[DRIVE_CONFIRM_ADD]') {
    let resultMessage = '';
    let driveBookingId: string | null = null;
    let driveLink: string | null = null;
    let success = false;
    try {
      // 1. booking_details INSERT
      const result = (await executeConfirmDriveNewProducts(env as any, {})) as
        | {
            message?: string;
            error?: string;
            success?: boolean;
            booking_id?: string;
            drive_link?: string | null;
          }
        | undefined;
      resultMessage = result?.message || result?.error || '처리 완료';
      success = !!result?.success;
      driveBookingId = result?.booking_id ?? null;
      driveLink = result?.drive_link ?? null;
    } catch (e) {
      resultMessage = `처리 실패: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 2. AI 응답 말풍선 INSERT (먼저)
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(
        resultMessage,
        body.user_message_id,
        JSON.stringify({ kind: 'ai_call', source: 'drive_confirm_add' }),
      )
      .first<any>();

    // 3. 성공 시 원본 발송 문구 INSERT (AI 응답 이후 — 화면에서 더 아래 표시)
    if (success && driveBookingId) {
      try {
        await buildOriginalSendMessage(
          env.DB,
          driveBookingId,
          driveLink || '',
          env.BASE_URL,
        );
      } catch (e) {
        console.error('[chat] buildOriginalSendMessage 실패:', e);
      }
    }

    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }
  if (userText === '[REVISION_CONFIRM_YES]') {
    let resultMessage = '';
    try {
      const pending = await env.DB.prepare(
        `SELECT id, metadata FROM ai_chat_messages
         WHERE json_extract(metadata, '$.type') = 'revision_confirm_pending'
         ORDER BY id DESC LIMIT 1`,
      ).first<{ id: number; metadata: string }>();
      if (!pending) {
        resultMessage = '처리할 대기 중인 추가보정 요청이 없습니다.';
      } else {
        let meta: any = {};
        try { meta = JSON.parse(pending.metadata); } catch (_) {}
        const bookingId: string = meta.booking_id ?? '';
        const revContent: string = meta.revision_content ?? '';
        const customerName: string = meta.customer_name ?? '';
        if (!bookingId) {
          resultMessage = 'pending에 booking_id 누락';
        } else {
          const result = (await executeRecordMilestone(env as any, {
            booking_id: bookingId,
            milestone_type: 'revision_requested',
            content: revContent,
            context: 'Phase 3 sentinel 승인',
          })) as { error?: string; success?: boolean };
          if (result.error) {
            resultMessage = `처리 실패: ${result.error}`;
          } else {
            await env.DB.prepare(
              `UPDATE ai_chat_messages
               SET metadata = json_set(metadata, '$.type', 'revision_confirm_used')
               WHERE id = ?1`,
            ).bind(pending.id).run();
            resultMessage = `✅ 추가보정 요청이 기록되었습니다. (${customerName}, ${revContent})`;
          }
        }
      }
    } catch (e) {
      resultMessage = `처리 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(
        resultMessage,
        body.user_message_id,
        JSON.stringify({ kind: 'ai_call', source: 'revision_confirm_yes' }),
      )
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }
  if (userText === '[REVISION_CONFIRM_NO]') {
    const pending = await env.DB.prepare(
      `SELECT id FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'revision_confirm_pending'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number }>();
    if (pending) {
      await env.DB.prepare(
        `UPDATE ai_chat_messages
         SET metadata = json_set(metadata, '$.type', 'revision_confirm_used')
         WHERE id = ?1`,
      ).bind(pending.id).run();
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(
        '건너뛰었습니다.',
        body.user_message_id,
        JSON.stringify({ kind: 'ai_call', source: 'revision_confirm_no' }),
      )
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }
  if (userText === '[DRIVE_CONFIRM_SKIP]') {
    // 가장 최근 drive_new_products_detected pending을 used로 표시 (재호출 방지)
    const pending = await env.DB.prepare(
      `SELECT id FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'drive_new_products_detected'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number }>();
    if (pending) {
      await env.DB.prepare(
        `UPDATE ai_chat_messages
         SET metadata = json_set(metadata, '$.type', 'drive_new_products_used')
         WHERE id = ?1`,
      )
        .bind(pending.id)
        .run();
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(
        '건너뛰었습니다. 원본 발송 문구를 작성해드릴까요?',
        body.user_message_id,
        JSON.stringify({ kind: 'ai_call', source: 'drive_confirm_skip' }),
      )
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  if (userText === '[NAME_UPDATE_YES]') {
    let resultMessage = '';
    try {
      const result = (await executeConfirmNameUpdate(env as any, {})) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      resultMessage = result?.message || result?.error || '처리 완료';
    } catch (e) {
      resultMessage = `처리 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(
        resultMessage,
        body.user_message_id,
        JSON.stringify({ kind: 'ai_call', source: 'name_update_yes' }),
      )
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  if (userText === '[NAME_UPDATE_NO]') {
    const pending = await env.DB.prepare(
      `SELECT id FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'name_update_pending'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number }>();
    if (pending) {
      await env.DB.prepare(
        `UPDATE ai_chat_messages
         SET metadata = json_set(metadata, '$.type', 'name_update_used')
         WHERE id = ?1`,
      ).bind(pending.id).run();
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(
        '취소되었습니다.',
        body.user_message_id,
        JSON.stringify({ kind: 'ai_call', source: 'name_update_no' }),
      )
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  // ── LINK_CONFIRM_YES/NO ─────────────────────────────────────────────
  if (userText === '[LINK_CONFIRM_YES]') {
    let resultMessage = '';
    try {
      const result = (await executeConfirmPendingLink(env as any, {})) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      resultMessage = result?.message || result?.error || '처리 완료';
    } catch (e) {
      resultMessage = `처리 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(resultMessage, body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'link_confirm_yes' }))
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  if (userText === '[LINK_CONFIRM_NO]') {
    const pending = await env.DB.prepare(
      `SELECT id FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'link_confirm_pending'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number }>();
    if (pending) {
      await env.DB.prepare(
        `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'link_confirm_used') WHERE id = ?1`,
      ).bind(pending.id).run();
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind('취소되었습니다.', body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'link_confirm_no' }))
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  // ── LINK_SELECT_N ────────────────────────────────────────────────────
  const linkSelectMatch = /^\[LINK_SELECT_(\d+)\]$/.exec(userText);
  if (linkSelectMatch) {
    const idx = parseInt(linkSelectMatch[1], 10);
    const candidatesMsg = await env.DB.prepare(
      `SELECT id, metadata FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'link_candidates'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number; metadata: string }>();

    let resultMessage = '';
    if (!candidatesMsg) {
      resultMessage = '선택할 후보 목록을 찾을 수 없습니다.';
    } else {
      let meta: { new_talk_id?: string; candidates?: Array<{ index: number; booking_id: string }> } = {};
      try { meta = JSON.parse(candidatesMsg.metadata); } catch (_) {}
      const candidate = (meta.candidates || []).find((c) => c.index === idx);
      if (!candidate || !meta.new_talk_id) {
        resultMessage = `${idx}번 후보를 찾을 수 없습니다.`;
      } else {
        try {
          const result = (await executeLinkTalkIdToBooking(env as any, {
            booking_id: candidate.booking_id,
            talk_id: meta.new_talk_id,
          })) as { success?: boolean; message?: string; error?: string; conflict?: boolean };
          resultMessage = result?.message || result?.error || '처리 완료';
          // 선택 완료 — candidates 메시지 type 변경 (버튼 비활성)
          if (result?.success || result?.conflict) {
            await env.DB.prepare(
              `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'link_candidates_used') WHERE id = ?1`,
            ).bind(candidatesMsg.id).run();
          }
        } catch (e) {
          resultMessage = `처리 실패: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(resultMessage, body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'link_select' }))
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  // ── CANCEL_SELECT_N ──────────────────────────────────────────────────
  const cancelSelectMatch = /^\[CANCEL_SELECT_(\d+)\]$/.exec(userText);
  if (cancelSelectMatch) {
    const idx = parseInt(cancelSelectMatch[1], 10);
    const candidatesMsg = await env.DB.prepare(
      `SELECT id, metadata FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'cancel_candidates'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number; metadata: string }>();

    let resultMessage = '';
    if (!candidatesMsg) {
      resultMessage = '선택할 후보 목록을 찾을 수 없습니다.';
    } else {
      let meta: {
        candidates?: Array<{ index: number; booking_id: string }>;
        cancellation_reason?: string | null;
        refund_amount?: number | null;
      } = {};
      try { meta = JSON.parse(candidatesMsg.metadata); } catch (_) {}
      const candidate = (meta.candidates || []).find((c) => c.index === idx);
      if (!candidate) {
        resultMessage = `${idx}번 후보를 찾을 수 없습니다.`;
      } else {
        try {
          const result = (await executeCancelBookingPending(env as any, {
            booking_id: candidate.booking_id,
            cancellation_reason: meta.cancellation_reason ?? null,
            refund_amount: meta.refund_amount ?? null,
          })) as { status?: string; message?: string; error?: string };

          resultMessage = result?.message || result?.error || '처리 완료';

          if (result?.status === 'pending_confirmation') {
            await env.DB.prepare(
              `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'cancel_candidates_used') WHERE id = ?1`,
            ).bind(candidatesMsg.id).run();
          }
        } catch (e) {
          resultMessage = `처리 실패: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(resultMessage, body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'cancel_select' }))
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  // ── MEMO_CONFIRM_YES/NO ────────────────────────────────────────────────────
  if (userText === '[MEMO_CONFIRM_YES]') {
    const pending = await env.DB.prepare(
      `SELECT id, metadata FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'memo_confirm_pending'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number; metadata: string }>();

    let resultMessage = '';
    if (!pending) {
      resultMessage = '저장할 메모를 찾을 수 없습니다.';
    } else {
      let meta: { items?: MemoItem[]; raw_input?: string } = {};
      try { meta = JSON.parse(pending.metadata); } catch (_) {}
      const items = meta.items ?? [];
      if (items.length === 0) {
        resultMessage = '메모 항목이 없습니다.';
      } else {
        const ids = await saveMemos(env.DB, items, meta.raw_input ?? '');
        await env.DB.prepare(
          `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'memo_confirm_used') WHERE id = ?1`,
        ).bind(pending.id).run();
        resultMessage =
          `✅ ${ids.length}개 개발 메모가 저장되었습니다.\n` +
          items.map((item, i) => `${i + 1}. ${item.title}`).join('\n') +
          `\n\n/memos 페이지에서 확인하실 수 있습니다.`;
      }
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind(resultMessage, body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'memo_confirm_yes' }))
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  if (userText === '[MEMO_CONFIRM_NO]') {
    const pending = await env.DB.prepare(
      `SELECT id FROM ai_chat_messages
       WHERE json_extract(metadata, '$.type') = 'memo_confirm_pending'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number }>();
    if (pending) {
      await env.DB.prepare(
        `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'memo_confirm_used') WHERE id = ?1`,
      ).bind(pending.id).run();
    }
    const aiRow = await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id, sender, message, reply_to_id, metadata, created_at`,
    )
      .bind('취소되었습니다.', body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'memo_confirm_no' }))
      .first<any>();
    return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
  }

  const replyToContext: ChatMessage | null = userRow.r_id
    ? rowToMessage({
        id: userRow.r_id,
        sender: userRow.r_sender,
        message: userRow.r_message,
        reply_to_id: userRow.r_reply_to_id,
        metadata: userRow.r_metadata,
        created_at: userRow.r_created_at,
      })
    : null;

  // ── 개발 메모 감지 (경량 AI 라우팅) ─────────────────────────────────────────
  if (userText && !userText.startsWith('[')) {
    const replyMeta = replyToContext?.metadata as Record<string, any> | null;
    const isReplyToMemoConfirm = replyMeta?.type === 'memo_confirm_pending';
    const hasMemoPattern = MEMO_PATTERNS.some((p) => p.test(userText));

    // memo_confirm_pending 컨텍스트 조회
    // reply_to가 pending을 가리키거나, 없으면 직전 pending AI 메시지 검색
    const isAffirmOrDeny = SHORT_AFFIRM.test(userText.trim()) || SHORT_DENY.test(userText.trim());
    let pendingMeta: Record<string, any> | null = null;
    let pendingMsgId: number | null = null;

    if (isReplyToMemoConfirm) {
      pendingMeta = replyMeta;
      pendingMsgId = replyToContext!.id;
    } else {
      // 긍정/거부뿐 아니라 수정 요청도 잡기 위해 항상 직전 pending 조회
      const prevPending = await env.DB.prepare(
        `SELECT id, metadata FROM ai_chat_messages
         WHERE id < ?1 AND sender = 'ai'
         AND json_extract(metadata, '$.type') = 'memo_confirm_pending'
         ORDER BY id DESC LIMIT 1`,
      ).bind(body.user_message_id).first<{ id: number; metadata: string }>();
      if (prevPending) {
        try { pendingMeta = JSON.parse(prevPending.metadata); } catch (_) {}
        pendingMsgId = prevPending.id;
      }
    }

    // Case 1: 긍정 → 저장
    if (pendingMeta && pendingMsgId && SHORT_AFFIRM.test(userText.trim())) {
      const items: MemoItem[] = pendingMeta.items ?? [];
      let resultMessage = '';
      if (items.length === 0) {
        resultMessage = '저장할 메모 항목이 없습니다.';
      } else {
        const ids = await saveMemos(env.DB, items, pendingMeta.raw_input ?? '');
        await env.DB.prepare(
          `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'memo_confirm_used') WHERE id = ?1`,
        ).bind(pendingMsgId).run();
        resultMessage =
          `✅ ${ids.length}개 개발 메모가 저장되었습니다.\n` +
          items.map((item: MemoItem, i: number) => `${i + 1}. ${item.title}`).join('\n') +
          `\n\n/memos 페이지에서 확인하실 수 있습니다.`;
      }
      const aiRow = await env.DB.prepare(
        `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
         VALUES ('ai', ?1, ?2, ?3, datetime('now'))
         RETURNING id, sender, message, reply_to_id, metadata, created_at`,
      )
        .bind(resultMessage, body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'memo_confirm_yes' }))
        .first<any>();
      return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
    }

    // Case 2: 거부 → 취소
    if (pendingMeta && pendingMsgId && SHORT_DENY.test(userText.trim())) {
      await env.DB.prepare(
        `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'memo_confirm_used') WHERE id = ?1`,
      ).bind(pendingMsgId).run();
      const aiRow = await env.DB.prepare(
        `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
         VALUES ('ai', ?1, ?2, ?3, datetime('now'))
         RETURNING id, sender, message, reply_to_id, metadata, created_at`,
      )
        .bind('취소되었습니다.', body.user_message_id, JSON.stringify({ kind: 'ai_call', source: 'memo_confirm_no' }))
        .first<any>();
      return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
    }

    // Case 3: pending이 있는데 긍정/거부도 아닌 경우 → 수정 요청으로 재분석
    if (pendingMeta && pendingMsgId && !isAffirmOrDeny && !hasMemoPattern) {
      const originalInput = pendingMeta.raw_input ?? '';
      const correctionContext = originalInput
        ? `원래 요청:\n${originalInput}\n\n수정 사항:\n${userText}`
        : userText;

      const correctedResult = await analyzeMemo(correctionContext, env.ANTHROPIC_API_KEY);
      if (correctedResult.usage) {
        logApiCost({
          env,
          operation: 'memo_analyze',
          model: ANTHROPIC_MODEL,
          inputTokens: correctedResult.usage.input_tokens,
          outputTokens: correctedResult.usage.output_tokens,
          contextText: correctionContext,
        }).catch(() => {});
      }
      if (correctedResult.is_memo) {
        await env.DB.prepare(
          `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'memo_confirm_used') WHERE id = ?1`,
        ).bind(pendingMsgId).run();

        const PRIORITY_LABEL: Record<string, string> = { urgent: '🔴 긴급', normal: '🟡 보통', low: '🔵 낮음' };
        const itemList = correctedResult.items
          .map((item, i) => `${i + 1}. **${item.title}** (${PRIORITY_LABEL[item.priority] ?? '🟡 보통'})\n   ${item.body}`)
          .join('\n');

        const aiRow = await env.DB.prepare(
          `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
           VALUES ('ai', ?1, ?2, ?3, datetime('now'))
           RETURNING id, sender, message, reply_to_id, metadata, created_at`,
        )
          .bind(
            `수정해서 다시 정리했어요.\n\n${itemList}`,
            body.user_message_id,
            JSON.stringify({
              kind: 'ai_call',
              source: 'memo_analyze',
              type: 'memo_confirm_pending',
              items: correctedResult.items,
              raw_input: correctionContext,
              buttons: [
                { label: '✅ 저장', value: '[MEMO_CONFIRM_YES]' },
                { label: '❌ 취소', value: '[MEMO_CONFIRM_NO]' },
              ],
            }),
          )
          .first<any>();
        return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
      }
      // is_memo: false → 수정 요청이 아님, 풀 AI로 fall-through
    }

    if (hasMemoPattern || isReplyToMemoConfirm) {
      // 마지막 메모 저장/취소 이벤트 이후의 사용자 메시지만 컨텍스트로 사용
      // (이미 처리된 이전 메모 내용이 새 정리에 포함되는 것 방지)
      const lastMemoEvent = await env.DB.prepare(
        `SELECT MAX(id) AS last_id FROM ai_chat_messages
         WHERE sender = 'ai'
         AND json_extract(metadata, '$.source') IN ('memo_confirm_yes', 'memo_confirm_no')
         AND id < ?1`,
      ).bind(body.user_message_id).first<{ last_id: number | null }>();

      const afterId = lastMemoEvent?.last_id ?? 0;

      const recentUserRows = await env.DB.prepare(
        `SELECT message FROM ai_chat_messages
         WHERE id < ?1 AND id > ?2 AND sender = 'user'
         ORDER BY id DESC LIMIT 4`,
      ).bind(body.user_message_id, afterId).all<{ message: string }>();

      const contextPrefix = (recentUserRows.results || [])
        .reverse()
        .map((r) => `[작가님]: ${r.message}`)
        .join('\n');

      const textForAnalysis = contextPrefix
        ? `${contextPrefix}\n[작가님]: ${userText}`
        : userText;

      const memoResult = await analyzeMemo(textForAnalysis, env.ANTHROPIC_API_KEY);
      if (memoResult.usage) {
        logApiCost({
          env,
          operation: 'memo_analyze',
          model: ANTHROPIC_MODEL,
          inputTokens: memoResult.usage.input_tokens,
          outputTokens: memoResult.usage.output_tokens,
          contextText: userText,
        }).catch(() => {});
      }

      if (memoResult.is_memo) {
        const PRIORITY_LABEL: Record<string, string> = {
          urgent: '🔴 긴급',
          normal: '🟡 보통',
          low: '🔵 낮음',
        };
        const itemList = memoResult.items
          .map((item, i) => {
            const pLabel = PRIORITY_LABEL[item.priority] ?? '🟡 보통';
            return `${i + 1}. **${item.title}** (${pLabel})\n   ${item.body}`;
          })
          .join('\n');

        const confirmText = `개발 메모로 저장할까요?\n\n${itemList}`;

        const aiRow = await env.DB.prepare(
          `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
           VALUES ('ai', ?1, ?2, ?3, datetime('now'))
           RETURNING id, sender, message, reply_to_id, metadata, created_at`,
        )
          .bind(
            confirmText,
            body.user_message_id,
            JSON.stringify({
              kind: 'ai_call',
              source: 'memo_analyze',
              type: 'memo_confirm_pending',
              items: memoResult.items,
              raw_input: userText,
              buttons: [
                { label: '✅ 저장', value: '[MEMO_CONFIRM_YES]' },
                { label: '❌ 취소', value: '[MEMO_CONFIRM_NO]' },
              ],
            }),
          )
          .first<any>();
        return Response.json({ message: aiRow ? rowToMessage(aiRow) : null });
      }
      // is_memo: false → fall-through to full AI processing
    }
  }

  // ── Phase 7: 사진 캡션 자동감지 ────────────────────────────────────────────
  // sentinel이 아닌 일반 텍스트일 때만 캡션으로 처리
  if (userText && !userText.startsWith('[')) {
    const replyMeta = replyToContext?.metadata as Record<string, any> | null;
    const isReplyToPhoto =
      replyMeta?.type === 'photo_upload' || replyMeta?.type === 'photo_group';

    if (isReplyToPhoto) {
      const photoIds: number[] = replyMeta?.photo_ids ?? [];
      const groupId: string | null =
        (replyMeta?.groups as Array<{ group_id: string; is_primary: boolean }> | undefined)
          ?.find((g) => g.is_primary)?.group_id ?? null;

      const appendSql = `CASE WHEN caption IS NULL OR caption = '' THEN ?1 ELSE caption || char(10) || ?1 END`;

      if (groupId) {
        // 그룹 캡션 → primary 사진(group_order=0)에 append
        await env.DB.prepare(
          `UPDATE photo_uploads SET caption = ${appendSql} WHERE group_id = ?2 AND group_order = 0`
        ).bind(userText.trim(), groupId).run();
      } else if (photoIds.length > 0) {
        const ph = photoIds.map((_, i) => `?${i + 2}`).join(',');
        await env.DB.prepare(
          `UPDATE photo_uploads SET caption = ${appendSql} WHERE id IN (${ph})`
        ).bind(userText.trim(), ...photoIds).run();
      }

      const captionAiRow = await env.DB.prepare(
        `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
         VALUES ('ai', ?1, ?2, ?3, datetime('now'))
         RETURNING id, sender, message, reply_to_id, metadata, created_at`
      ).bind('✅ 캡션 저장했습니다.', body.user_message_id,
             JSON.stringify({ kind: 'ai_call', source: 'photo_caption' })).first<any>();
      return Response.json({ message: captionAiRow ? rowToMessage(captionAiRow) : null });
    }

    // reply_to 없을 때: 직전 메시지가 photo_upload이면 배치 캡션
    if (!replyToContext) {
      const prevMsg = await env.DB.prepare(
        `SELECT metadata FROM ai_chat_messages WHERE id < ?1 ORDER BY id DESC LIMIT 1`
      ).bind(body.user_message_id).first<{ metadata: string | null }>();

      let prevMeta: Record<string, any> | null = null;
      try { prevMeta = prevMsg?.metadata ? JSON.parse(prevMsg.metadata) : null; } catch { /* empty */ }

      if (prevMeta?.type === 'photo_upload') {
        const photoIds: number[] = prevMeta.photo_ids ?? [];
        const prevGroupId: string | null =
          (prevMeta?.groups as Array<{ group_id: string; is_primary: boolean }> | undefined)
            ?.find((g) => g.is_primary)?.group_id ?? null;
        if (photoIds.length > 0) {
          const appendSql2 = `CASE WHEN caption IS NULL OR caption = '' THEN ?1 ELSE caption || char(10) || ?1 END`;
          if (prevGroupId) {
            await env.DB.prepare(
              `UPDATE photo_uploads SET caption = ${appendSql2} WHERE group_id = ?2 AND group_order = 0`
            ).bind(userText.trim(), prevGroupId).run();
          } else {
            const ph = photoIds.map((_, i) => `?${i + 2}`).join(',');
            await env.DB.prepare(
              `UPDATE photo_uploads SET caption = ${appendSql2} WHERE id IN (${ph})`
            ).bind(userText.trim(), ...photoIds).run();
          }

          const captionAiRow = await env.DB.prepare(
            `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
             VALUES ('ai', ?1, ?2, ?3, datetime('now'))
             RETURNING id, sender, message, reply_to_id, metadata, created_at`
          ).bind('✅ 캡션 저장했습니다.', body.user_message_id,
                 JSON.stringify({ kind: 'ai_call', source: 'photo_caption' })).first<any>();
          return Response.json({ message: captionAiRow ? rowToMessage(captionAiRow) : null });
        }
      }
    }
  }

  // 3. 최근 메시지 10개 (오름차순)
  const historyResult = await env.DB.prepare(
    `SELECT id, sender, message, created_at
     FROM ai_chat_messages
     WHERE id <= ?1
     ORDER BY id DESC
     LIMIT ?2`
  )
    .bind(body.user_message_id, HISTORY_LIMIT)
    .all<{ id: number; sender: string; message: string; created_at: string }>();

  const history = (historyResult.results || []).slice().reverse();

  // 4. Anthropic messages 변환 (string content는 첫 호출용. 도구 루프에선 array content로 전환)
  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = history.map((h) => {
    const role: 'user' | 'assistant' = h.sender === 'ai' ? 'assistant' : 'user';
    const text = h.sender === 'system' ? `[시스템 알림] ${h.message}` : h.message;
    return { role, content: text };
  });

  // reply_to가 있으면 messages 배열의 마지막 user 메시지에 직접 컨텍스트 주입
  // (system prompt 주입만으로는 최근 대화 히스토리에 밀려 AI가 무시하기 때문)
  if (replyToContext && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last.role === 'user' && typeof last.content === 'string') {
      const replyHeader =
        `[답장 대상 메시지 — 반드시 이 내용의 고객을 기준으로 처리하세요. 최근 대화의 다른 고객과 혼동 금지]\n` +
        `발신: ${replyToContext.sender}\n` +
        `내용: ${replyToContext.message}\n\n` +
        `[작가님 메시지]\n`;
      messages[messages.length - 1] = { role: 'user', content: replyHeader + last.content };
    }
  }

  // reply_to가 있으면 system 프롬프트에도 참조 블록 추가 (이중 보강)
  let systemPrompt = SYSTEM_PROMPT;
  if (replyToContext) {
    systemPrompt +=
      `\n\n## 🚨 최우선 지시: 작가님이 특정 메시지에 직접 답장했습니다\n\n` +
      `작가님의 현재 메시지는 아래 메시지에 대한 **직접 답장**입니다.\n` +
      `반드시 아래 메시지의 내용/고객을 처리 기준으로 삼으세요.\n` +
      `최근 대화내용에 다른 고객 정보가 있더라도 절대 혼동하지 마세요.\n\n` +
      `[발신: ${replyToContext.sender}]\n${replyToContext.message}\n\n` +
      `⚠️ 위 답장 대상 메시지의 고객/내용 기준으로만 처리하세요. 다른 고객 정보는 무시하세요.\n` +
      `⚠️ talk_id는 booking_id가 아닙니다. 고객명으로 search_customers를 먼저 호출해 booking_id를 확보하세요.`;
  } else {
    // reply_to_id가 없을 때: 짧은 긍정/거부 응답이면 직전 AI 메시지를 자동 컨텍스트화
    const userText = String(userRow.message || '').trim();
    const isAffirm = SHORT_AFFIRM.test(userText);
    const isDeny = SHORT_DENY.test(userText);

    if (isAffirm || isDeny) {
      const prevAI = await env.DB.prepare(
        `SELECT id, sender, message, metadata, created_at
         FROM ai_chat_messages
         WHERE id < ?1 AND sender = 'ai'
         ORDER BY id DESC
         LIMIT 1`,
      )
        .bind(body.user_message_id)
        .first<{
          id: number;
          sender: string;
          message: string;
          metadata: string | null;
          created_at: string;
        }>();

      if (prevAI) {
        const prevMeta = parseMetadata(prevAI.metadata);
        const isConfirmation =
          CONFIRM_MARKER.test(prevAI.message) ||
          (prevMeta && prevMeta.requires_confirmation === true);

        const interp = isAffirm ? '긍정 (네/동의)' : '거부 (아니오/취소)';

        if (isConfirmation) {
          systemPrompt +=
            `\n\n## 컨텍스트 자동 추론 (중요)\n` +
            `작가님이 reply_to 없이 짧은 응답("${userText}")을 보냈습니다. ` +
            `이는 "${interp}"으로 해석됩니다.\n\n` +
            `직전 AI 메시지가 확인 요청이었습니다 (id=${prevAI.id}):\n` +
            `${prevAI.message}\n\n` +
            `이 응답을 위 확인 요청에 대한 답으로 처리하세요. ` +
            `${isAffirm ? '긍정이므로 즉시 해당 도구를 호출하고 결과를 받아 보고합니다.' : '거부이므로 도구 호출 없이 "알겠습니다, 진행하지 않을게요." 안내합니다.'}`;
          console.log(
            `[chat] auto-inferred context: short_response="${userText}" target_ai_id=${prevAI.id} marker=confirmation interp=${isAffirm ? 'affirm' : 'deny'}`,
          );
        } else {
          systemPrompt +=
            `\n\n## 컨텍스트 자동 추론\n` +
            `작가님의 짧은 응답("${userText}", ${interp})은 직전 AI 메시지(id=${prevAI.id})에 대한 답일 가능성이 높습니다:\n` +
            `${prevAI.message}\n\n` +
            `직전 메시지가 명시적 확인 요청은 아니므로, ` +
            `의도가 불명확하면 도구 호출 전에 "어떤 작업 진행할까요?"로 재확인하세요.`;
          console.log(
            `[chat] auto-inferred context: short_response="${userText}" target_ai_id=${prevAI.id} marker=none interp=${isAffirm ? 'affirm' : 'deny'}`,
          );
        }
      }
    }
  }

  // 데이터 질문 감지 — 첫 라운드 tool_choice 강제
  const userMsgText = String(userRow.message || '');
  const isDataQuery = DATA_QUERY_KEYWORDS.some((kw) => userMsgText.includes(kw));
  if (isDataQuery) {
    console.log(`[chat] 데이터 질문 감지: tool_choice=any 적용 (round 0)`);
  }

  console.log(`[chat] AI 호출 시작 (model=haiku-4-5, history=${messages.length})`);

  // 5. 도구 루프
  const startedAt = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastStopReason = '';
  const finalTextParts: string[] = [];
  const toolCallsLog: Array<{
    round: number;
    name: string;
    input: Record<string, any>;
    result: unknown;
  }> = [];
  let loopCapped = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // 첫 라운드 + 데이터 질문이면 도구 호출 강제 (환각 방지)
    const apiBody: Record<string, unknown> = {
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    };
    if (round === 0 && isDataQuery) {
      apiBody.tool_choice = { type: 'any' };
    }

    let aiRes: Response;
    try {
      aiRes = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiBody),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (e: any) {
      console.log(`[chat] AI 호출 실패 (network): ${e?.message || e}`);
      return jsonError(502, `AI API 호출 실패: ${e?.message || 'network error'}`);
    }

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '');
      console.log(`[chat] AI 호출 실패 status=${aiRes.status} body=${errText.slice(0, 500)}`);
      return jsonError(502, `AI API 응답 에러 (${aiRes.status})`);
    }

    let data: AnthropicResponse;
    try {
      data = (await aiRes.json()) as AnthropicResponse;
    } catch {
      return jsonError(502, 'AI 응답 파싱 실패');
    }

    totalInputTokens += data.usage?.input_tokens ?? 0;
    totalOutputTokens += data.usage?.output_tokens ?? 0;
    lastStopReason = data.stop_reason;

    // text + tool_use 분리
    const roundTextParts: string[] = [];
    const toolUses: AnthropicToolUseBlock[] = [];
    for (const block of data.content || []) {
      if (block.type === 'text') roundTextParts.push(block.text);
      else if (block.type === 'tool_use') toolUses.push(block);
    }

    console.log(
      `[chat] AI 응답 (round=${round}, stop_reason=${data.stop_reason}, text=${roundTextParts.length}, tools=${toolUses.length})`,
    );

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // 종료 round의 텍스트만 최종 응답으로 사용
      finalTextParts.push(...roundTextParts);
      break;
    }

    // 도구 실행 → tool_result 블록 구성
    const toolResults: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];
    for (const tu of toolUses) {
      const result = await handleToolUse(env as any, tu.name, tu.input);
      toolCallsLog.push({ round, name: tu.name, input: tu.input, result });
      const isError =
        typeof result === 'object' && result !== null && 'error' in (result as any);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
        ...(isError ? { is_error: true } : {}),
      });
    }

    // assistant turn (원본 content 그대로) + user turn (tool_results) 추가
    messages.push({ role: 'assistant', content: data.content });
    messages.push({ role: 'user', content: toolResults });

    if (round === MAX_TOOL_ROUNDS - 1) {
      loopCapped = true;
      finalTextParts.push(...roundTextParts);
      console.log(`[chat] tool loop capped at ${MAX_TOOL_ROUNDS} rounds`);
    }
  }

  const duration = Date.now() - startedAt;
  const aiText = finalTextParts.join('\n').trim() || '(응답 없음)';
  const totalTokens = totalInputTokens + totalOutputTokens;

  console.log(
    `[chat] AI 완료 (tokens=${totalTokens}, duration=${duration}ms, stop_reason=${lastStopReason}, tool_calls=${toolCallsLog.length})`,
  );

  // 비용 로그 (fire-and-forget)
  logApiCost({
    env,
    operation: 'chat_reply',
    model: ANTHROPIC_MODEL,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    contextText: userText,
  }).catch(() => {});

  // 7. metadata 구성 + INSERT
  const metadata: Record<string, any> = {
    kind: 'ai_call',
    model: ANTHROPIC_MODEL,
    tokens: { input: totalInputTokens, output: totalOutputTokens },
    duration_ms: duration,
    stop_reason: lastStopReason,
  };
  if (toolCallsLog.length > 0) {
    metadata.tool_calls = toolCallsLog;
  }
  if (loopCapped) {
    metadata.tool_loop_capped = true;
  }

  // 확인 요청 휴리스틱 — 응답에 [✅ 네] / [❌ 아니오] 마커가 있으면 metadata.requires_confirmation
  // (Phase 3에서 AI가 명시적으로 set하는 방향으로 이전 가능)
  if (/\[✅[^\]]*\]|\[❌[^\]]*\]/.test(aiText)) {
    metadata.requires_confirmation = true;
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
     VALUES ('ai', ?1, ?2, ?3, datetime('now'))
     RETURNING id, sender, message, reply_to_id, metadata, created_at`
  )
    .bind(aiText, body.user_message_id, JSON.stringify(metadata))
    .first<ChatRow>();

  if (!inserted) {
    return jsonError(500, 'AI 응답 저장 실패');
  }

  // 확인 요청이면 푸시 발송 (Step 6b 전까지는 placeholder — console.log만)
  if (metadata.requires_confirmation && env.ALLOWED_EMAIL) {
    try {
      await sendPushNotification(env, env.ALLOWED_EMAIL, {
        title: '확인 요청',
        body: aiText.slice(0, 100),
        data: { chat_message_id: inserted.id },
        tag: 'confirm-' + inserted.id,
        requires_confirmation: true,
      });
    } catch (e: any) {
      console.log(`[chat] push 발송 실패: ${e?.message || e}`);
    }
  }

  // user 메시지를 reply_to로 다시 채워서 반환
  const userMessageObj = rowToMessage({
    id: userRow.id,
    sender: userRow.sender,
    message: userRow.message,
    reply_to_id: userRow.reply_to_id,
    metadata: userRow.metadata,
    created_at: userRow.created_at,
  });
  const aiMessage = rowToMessage(inserted, userMessageObj);

  return Response.json(aiMessage);
}

// ─── POST /api/chat/confirm ─────────────────────────────────────────────
//
// system 메시지의 [✅] [❌] 버튼 클릭 처리.
// Body: { message_id: number, action_id: string, value: 'yes' | 'no' }

interface ChatConfirmRequest {
  message_id: number;
  action_id: string;
  value: 'yes' | 'no';
}

async function insertFollowUpAiMessage(
  db: D1Database,
  replyToId: number,
  message: string,
  metadata: Record<string, any>,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO ai_chat_messages (sender, message, reply_to_id, metadata, created_at)
       VALUES ('ai', ?1, ?2, ?3, datetime('now'))
       RETURNING id`,
    )
    .bind(message, replyToId, JSON.stringify(metadata))
    .first<{ id: number }>();
  if (!result) throw new Error('follow-up message INSERT failed');
  return result.id;
}

export async function handleChatConfirm(request: Request, env: Env): Promise<Response> {
  // 1. 인증
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  // 2. body 파싱 + 검증
  let body: ChatConfirmRequest;
  try {
    body = await request.json<ChatConfirmRequest>();
  } catch {
    return jsonError(400, 'invalid json');
  }

  const messageId = Number(body.message_id);
  const actionId = String(body.action_id || '');
  const value = String(body.value || '');

  if (!Number.isInteger(messageId) || messageId <= 0) {
    return jsonError(400, 'invalid message_id');
  }
  if (!actionId) return jsonError(400, 'action_id required');
  if (value !== 'yes' && value !== 'no') {
    return jsonError(400, 'value must be "yes" or "no"');
  }

  // 3. system 메시지 조회
  const msgRow = await env.DB.prepare(
    `SELECT id, sender, metadata FROM ai_chat_messages WHERE id = ?1`,
  )
    .bind(messageId)
    .first<{ id: number; sender: string; metadata: string | null }>();

  if (!msgRow) return jsonError(404, 'message not found');
  if (msgRow.sender !== 'system') {
    return jsonError(400, 'not a system message');
  }

  // 4. metadata 파싱 + confirmation 검증
  let metadata: any;
  try {
    metadata = msgRow.metadata ? JSON.parse(msgRow.metadata) : {};
  } catch {
    return jsonError(500, 'metadata parse error');
  }

  const confirmation = metadata?.processing?.confirmation;
  if (!confirmation) return jsonError(400, 'no confirmation in metadata');
  if (confirmation.action_id !== actionId) {
    return jsonError(400, 'action_id mismatch');
  }

  // 5. 이미 응답한 경우 거부
  if (metadata.processing.responded) {
    return jsonError(
      400,
      `already responded: ${metadata.processing.responded}`,
    );
  }

  // 6. value별 처리
  let followUpMessage: string;
  let toolResult: any = null;

  if (value === 'yes') {
    if (confirmation.action_type === 'record_milestone') {
      const params = confirmation.params || {};
      const rawMilestone = params.milestone_type;
      const milestoneType = rawMilestone
        ? rawMilestone === 'shoot_date'
          ? 'shoot'
          : String(rawMilestone).replace(/_at$/, '')
        : null;

      if (!milestoneType || !params.booking_id) {
        return jsonError(400, 'invalid params for record_milestone');
      }

      try {
        toolResult = await executeRecordMilestone(env as any, {
          booking_id: params.booking_id,
          milestone_type: milestoneType,
          content: params.content,
          date: params.date,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return jsonError(500, `tool error: ${reason}`);
      }

      const isSuccess =
        typeof toolResult === 'object' &&
        toolResult !== null &&
        (toolResult as any).success === true;

      if (isSuccess) {
        const stage = (toolResult as any).stage_label
          ? ` → ${(toolResult as any).stage_label}`
          : '';
        followUpMessage = `✅ 처리 완료\n${rawMilestone} 기록됨${stage}`;
      } else {
        const errText =
          typeof toolResult === 'object' && toolResult !== null
            ? (toolResult as any).error || '알 수 없는 오류'
            : '알 수 없는 오류';
        followUpMessage = `⚠️ 처리 실패\n${errText}`;
      }
    } else if (confirmation.action_type === 'cancel_booking') {
      const params = confirmation.params || {};
      const bookingId = String(params.booking_id || '');
      if (!bookingId) return jsonError(400, 'booking_id missing in cancel_booking params');

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      await env.DB.prepare(
        `UPDATE bookings
         SET cancelled = 1, cancelled_at = ?2, cancellation_reason = ?3,
             refund_amount = ?4, updated_at = ?5
         WHERE booking_id = ?1`,
      )
        .bind(
          bookingId,
          now,
          params.cancellation_reason ?? null,
          params.refund_amount ?? null,
          now,
        )
        .run();

      toolResult = { success: true, booking_id: bookingId };
      followUpMessage = `✅ 예약 취소 완료\n예약번호 ${bookingId} 취소 처리됐습니다.`;

      // 캘린더 취소 표기 (throw 안 함 — 메인 처리 흐름 유지)
      let calendarStatus: string | null = null;
      let calendarError: string | null = null;
      try {
        const result = await markCalendarEventCancelled(
          { env: env as any, db: env.DB },
          bookingId,
        );
        calendarStatus = result.status;
      } catch (err) {
        calendarError = err instanceof Error ? err.message : String(err);
        console.error('[cancel_booking] calendar throw:', bookingId, calendarError);
      }

      const needsAlert =
        calendarError !== null ||
        calendarStatus === 'no_event_id' ||
        calendarStatus === 'not_found';

      if (needsAlert) {
        let reasonText: string;
        if (calendarError) {
          reasonText = `에러: ${calendarError}`;
        } else if (calendarStatus === 'no_event_id') {
          reasonText = '캘린더에 등록된 적이 없는 예약입니다';
        } else {
          reasonText = '캘린더에서 이벤트를 찾을 수 없습니다 (수동 삭제됐을 수 있음)';
        }

        const alertMsg =
          `🚨🚨🚨 캘린더 취소 표기 누락 🚨🚨🚨\n\n` +
          `📌 예약번호: ${bookingId}\n` +
          `📌 사유: ${reasonText}\n\n` +
          `⚠️ 해당 일정이 캘린더에 남아 있다면 직접 취소 표기 부탁드립니다.`;

        await env.DB.prepare(
          `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
           VALUES ('system', ?1, ?2, datetime('now'))`,
        )
          .bind(
            alertMsg,
            JSON.stringify({
              type: 'calendar_cancel_alert',
              booking_id: bookingId,
              status: calendarStatus,
              error: calendarError,
            }),
          )
          .run();

        if (env.ALLOWED_EMAIL) {
          sendPushNotification(env as any, env.ALLOWED_EMAIL, {
            title: '🚨 캘린더 취소 표기 누락',
            body: `${bookingId} — 채팅창 확인 필요`,
            tag: `calendar_cancel_alert_${bookingId}`,
            data: { source: 'calendar_cancel_alert', booking_id: bookingId },
          }).catch((e) => console.error('[cancel_booking] push failed:', e));
        }
      }
    } else {
      return jsonError(400, `unsupported action_type: ${confirmation.action_type}`);
    }
  } else {
    followUpMessage = '❌ 취소했어요. 작가님이 직접 처리해주세요.';
  }

  // 7. 후속 ai 메시지 INSERT
  const followUpId = await insertFollowUpAiMessage(
    env.DB,
    messageId,
    followUpMessage,
    {
      kind: 'confirm_followup',
      tool_result: toolResult,
      in_response_to_action: actionId,
    },
  );

  // 8. 원본 system 메시지 metadata 갱신 (responded 마킹)
  metadata.processing.responded = value;
  metadata.processing.followup_message_id = followUpId;

  await env.DB.prepare(
    `UPDATE ai_chat_messages SET metadata = ?1 WHERE id = ?2`,
  )
    .bind(JSON.stringify(metadata), messageId)
    .run();

  console.log(
    `[chat-confirm] message_id=${messageId} action_id=${actionId} value=${value} ` +
      `tool_success=${
        toolResult && typeof toolResult === 'object'
          ? (toolResult as any).success ?? 'n/a'
          : 'n/a'
      } followup_id=${followUpId}`,
  );

  return Response.json({
    success: true,
    follow_up_message_id: followUpId,
    tool_result: toolResult,
  });
}

// ─── POST /api/chat/skip-confirm ─────────────────────────────────────────────
export async function handleSkipConfirm(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = await requireAuth(request, env as any);
  if (auth instanceof Response) return auth;

  let body: { message_id: number };
  try {
    body = await request.json<{ message_id: number }>();
  } catch {
    return jsonError(400, 'invalid json');
  }

  const messageId = Number(body.message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return jsonError(400, 'invalid message_id');
  }

  const msgRow = await env.DB.prepare(
    `SELECT id, metadata FROM ai_chat_messages WHERE id = ?1`,
  ).bind(messageId).first<{ id: number; metadata: string | null }>();

  if (!msgRow) return jsonError(404, 'message not found');

  let metadata: any;
  try {
    metadata = msgRow.metadata ? JSON.parse(msgRow.metadata) : {};
  } catch {
    return jsonError(500, 'metadata parse error');
  }

  if (metadata?.processing?.responded) {
    return jsonError(400, 'already responded');
  }

  if (!metadata.processing) metadata.processing = {};
  metadata.processing.responded = 'no';

  await env.DB.prepare(
    `UPDATE ai_chat_messages SET metadata = ?1 WHERE id = ?2`,
  ).bind(JSON.stringify(metadata), messageId).run();

  return Response.json({ success: true });
}

// ─── GET /api/chat/pending-confirmations ─────────────────────────────────────
export async function handleGetPendingConfirmations(
  _request: Request,
  env: Env,
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, message, metadata, created_at
     FROM ai_chat_messages
     WHERE json_extract(metadata, '$.processing.type') = 'ai_confirm'
       AND json_extract(metadata, '$.processing.responded') IS NULL
       AND datetime(created_at) >= datetime('now', '-30 days')
     ORDER BY created_at ASC`,
  ).all<{ id: number; message: string; metadata: string; created_at: string }>();

  const items = (rows.results || []).map((r) => {
    let customerName: string | null = null;
    try {
      const meta = JSON.parse(r.metadata || '{}');
      customerName = meta.customer_name || null;
    } catch {}
    const firstLine = r.message.split('\n').find((l) => l.trim()) || '';
    return {
      id: r.id,
      customer_name: customerName,
      summary: firstLine.slice(0, 80),
      created_at: r.created_at,
    };
  });

  return Response.json({ items });
}

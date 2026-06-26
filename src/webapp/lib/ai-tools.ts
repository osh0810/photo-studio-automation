/**
 * AI 도구 시스템 (날짜 기반 milestone 관리).
 *
 * 4개 도구:
 *   - record_milestone        예약의 milestone 날짜 기록 + 이력
 *   - search_customers        고객/누락단계 검색
 *   - update_customer_memo    고객 메모 한 줄 추가
 *   - add_learned_rule        반복 패턴을 ai_learned_rules에 학습
 */

import { rescheduleCalendarEvent, renameCustomerInCalendarEvent } from './calendar-event-builder';
import { sendPushNotification } from './push-sender';
import { getParentFolderId, renameFolderWithPromotion } from './drive-client';
import { buildConfirmMessage, type BookingDetailWithProduct } from './confirm-message-builder';

// ─── 타입 ──────────────────────────────────────────────────────────────

export type MilestoneType =
  | 'shoot'
  | 'original_sent'
  | 'selection_received'
  | 'retouched_sent'
  | 'revision_requested'
  | 'revision_no_more'
  | 'revision_sent';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolUseInput {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ToolUseResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface Env {
  DB: D1Database;
  [k: string]: unknown;
}

// ─── 상수 ──────────────────────────────────────────────────────────────

const MILESTONE_COLUMN: Record<MilestoneType, string> = {
  shoot: 'shoot_date',
  original_sent: 'original_sent_at',
  selection_received: 'selection_received_at',
  retouched_sent: 'retouched_sent_at',
  revision_requested: 'revision_requested_at',
  revision_no_more: 'revision_no_more_at',
  revision_sent: 'revision_sent_at',
};

export const STAGE_LABELS: Record<string, string> = {
  S0: 'S0 예약대기',
  S1: 'S1 촬영완료',
  S2: 'S2 원본발송',
  S3: 'S3 셀렉수신',
  S4: 'S4 보정발송',
  S5a: 'S5a 추가보정요청',
  S5b: 'S5b 추가보정없음',
  S6: 'S6 추가보정발송',
  S7: 'S7 액자발주',
};

const ALL_MILESTONES: MilestoneType[] = [
  'shoot',
  'original_sent',
  'selection_received',
  'retouched_sent',
  'revision_requested',
  'revision_no_more',
  'revision_sent',
];

// ─── 도구 정의 ─────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    name: 'record_milestone',
    description:
      '예약(booking)의 특정 milestone 날짜를 기록합니다. 단계는 milestone들로부터 자동 계산됩니다. ' +
      'milestone_type: shoot=촬영, original_sent=원본발송(S2), selection_received=셀렉수신(S3), ' +
      'retouched_sent=보정발송(S4), revision_requested=추가보정요청(S5a), revision_no_more=추가보정없음(S5b), ' +
      'revision_sent=추가보정발송(S6). ' +
      '⚠️ frame_ordered(S7 액자발주)는 아뜨레 발주 시스템 webhook에서만 자동 설정됨 — AI가 호출 불가.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: '예약번호' },
        milestone_type: {
          type: 'string',
          enum: ALL_MILESTONES,
          description: '기록할 milestone 종류',
        },
        date: {
          type: 'string',
          description: 'ISO 8601 형식. 생략 시 현재 시각 사용',
        },
        content: {
          type: 'string',
          description:
            'selection_received일 경우 셀렉컷, revision_requested일 경우 요청내용',
        },
        context: {
          type: 'string',
          description: '변경 이유/맥락 (이력에 기록)',
        },
      },
      required: ['booking_id', 'milestone_type'],
    },
  },
  {
    name: 'search_customers',
    description:
      '고객 검색 도구. 다음 방식 지원:\n\n' +
      'query: 고객명 부분 매치\n' +
      'missing: 특정 milestone 누락된 고객 검색\n' +
      "  'original': 촬영 후 원본 발송 안 한 고객\n" +
      "  'selection': 원본 발송 후 셀렉 안 받은 고객\n" +
      "  'retouched_pending': 보정 발송 필요 (첫 보정 대기 + 추가보정 발송 대기 모두)\n" +
      "  'revision_response': 보정 후 고객 응답 대기\n" +
      "  'frame': 액자 발주 대기\n" +
      'days_since: 해당 milestone 기준 N일 이상 경과한 건만\n\n' +
      '최대 10건 반환.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '고객명 부분 매치' },
        missing: {
          type: 'string',
          enum: ['original', 'selection', 'retouched_pending', 'revision_response', 'frame'],
          description:
            'original=촬영 후 원본 미발송, ' +
            'selection=원본 발송 후 셀렉 미수신, ' +
            'retouched_pending=보정 발송 필요 (첫 보정 대기 + 추가보정 발송 대기 모두), ' +
            'revision_response=보정 후 고객 응답 대기, ' +
            'frame=액자 발주 대기',
        },
        days_since: {
          type: 'number',
          description: '해당 milestone 기준 N일 이상 경과한 건만',
        },
      },
    },
  },
  {
    name: 'update_customer_memo',
    description:
      '고객 메모에 한 줄 추가합니다. 기존 메모는 보존되고 "[YYYY-MM-DD] 내용" 형태로 append됩니다.',
    input_schema: {
      type: 'object',
      properties: {
        talk_id: { type: 'string', description: '톡톡ID' },
        memo_addition: { type: 'string', description: '추가할 메모 한 줄' },
      },
      required: ['talk_id', 'memo_addition'],
    },
  },
  {
    name: 'add_learned_rule',
    description:
      '반복 패턴을 ai_learned_rules에 학습 규칙으로 저장합니다. is_active=1, apply_count=0으로 시작.',
    input_schema: {
      type: 'object',
      properties: {
        rule_type: {
          type: 'string',
          enum: ['auto_process', 'confirm_required'],
        },
        pattern_description: { type: 'string', description: '패턴 설명' },
        conditions: { type: 'object', description: '조건 JSON' },
        action: { type: 'object', description: '액션 JSON' },
      },
      required: ['rule_type', 'pattern_description'],
    },
  },
  // ─── Phase 4 Step 4-B: 상품/질문/매칭 관리 도구 6개 ────────────────────
  {
    name: 'register_product',
    description:
      '새 상품을 products 테이블에 등록합니다. 작가님이 채팅창에서 상품 정보를 알려주면 사용. ' +
      'product_code는 시스템 키(영문/숫자/언더스코어), match_keyword는 메일 service_details와 매칭할 키워드.',
    input_schema: {
      type: 'object',
      properties: {
        product_code: { type: 'string', description: '시스템 키 (예: "FAM_CLASSIC")' },
        product_name: { type: 'string', description: '표시 이름 (예: "클래식 가족사진")' },
        match_keyword: { type: 'string', description: '메일 service_details 매칭 키워드' },
        price: { type: 'integer', description: '가격 (원)' },
        retouch_count: { type: 'integer', description: '보정본 총 장수' },
        retouch_breakdown: { type: 'string', description: '보정본 분배 (예: "가족1장,아기2장")' },
        frame_count: { type: 'integer', description: '액자 개수' },
        frame_size: { type: 'string', description: '액자 사이즈 (예: "8×10인치 원목")' },
        extra_note: { type: 'string', description: '추가 안내 (선택)' },
        notes: { type: 'string', description: '작가님 메모 (선택)' },
      },
      required: ['product_code', 'product_name', 'match_keyword', 'price'],
    },
  },
  {
    name: 'update_product',
    description:
      '기존 상품 정보를 수정합니다. identifier로 product_code(정확 일치) 먼저 찾고, 없으면 product_name LIKE 매칭. ' +
      '다수 매칭 시 정확한 코드를 다시 요청합니다.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'product_code(정확) 또는 product_name(부분 일치)',
        },
        updates: {
          type: 'object',
          description:
            '변경할 필드. 허용: product_name, match_keyword, price, retouch_count, ' +
            'retouch_breakdown, frame_count, frame_size, extra_note, is_active, notes',
        },
      },
      required: ['identifier', 'updates'],
    },
  },
  {
    name: 'list_products',
    description: '등록된 상품 목록 조회. 기본 is_active=true만 표시.',
    input_schema: {
      type: 'object',
      properties: {
        is_active: { type: 'boolean', description: '활성 상품만 (기본 true)' },
      },
    },
  },
  {
    name: 'register_question',
    description:
      '새 추가 질문을 등록합니다. trigger_keyword가 service_details 또는 product_name에 포함되면 자동 매칭.',
    input_schema: {
      type: 'object',
      properties: {
        question_code: { type: 'string', description: '시스템 키 (예: "BABY_INFO")' },
        trigger_keyword: { type: 'string', description: '매칭 키워드 (예: "아기사진")' },
        question_text: { type: 'string', description: '질문 본문 (줄바꿈 포함 가능)' },
      },
      required: ['question_code', 'trigger_keyword', 'question_text'],
    },
  },
  {
    name: 'list_questions',
    description: '등록된 추가 질문 목록 조회.',
    input_schema: {
      type: 'object',
      properties: {
        is_active: { type: 'boolean', description: '활성만 (기본 true)' },
      },
    },
  },
  {
    name: 'manual_match_booking_detail',
    description:
      'booking_details에 unmatched 상태인 항목을 특정 product에 수동 매칭합니다. ' +
      'match_status는 "manual"로 변경됩니다.',
    input_schema: {
      type: 'object',
      properties: {
        booking_detail_id: { type: 'integer', description: 'booking_details의 id' },
        product_identifier: {
          type: 'string',
          description: 'product_code(정확) 또는 product_name(부분 일치)',
        },
      },
      required: ['booking_detail_id', 'product_identifier'],
    },
  },
  // ─── Phase 6: 고객 수동 관리 도구 3개 ────────────────────────────────
  {
    name: 'register_customer',
    description:
      '고객을 customers 테이블에 신규 등록합니다. 동명이인 허용 (중복 체크 없음). talk_id는 PRIMARY KEY이므로 같은 talk_id가 이미 있으면 실패합니다.',
    input_schema: {
      type: 'object',
      properties: {
        talk_id: { type: 'string', description: '톡톡 ID (PRIMARY KEY)' },
        customer_name: { type: 'string', description: '고객명' },
        phone: { type: 'string', description: '연락처 (선택)' },
        memo: { type: 'string', description: '메모 (선택)' },
      },
      required: ['talk_id', 'customer_name'],
    },
  },
  {
    name: 'update_customer_name',
    description:
      '마스킹된 고객명을 풀네임으로 수동 업데이트합니다. ' +
      '호출 시 바로 변경하지 않고 pending 저장 후 확인 요청만 반환합니다. ' +
      '이전에 같은 요청을 한 적 있어도 반드시 도구 호출하세요.',
    input_schema: {
      type: 'object',
      properties: {
        talk_id: { type: 'string', description: '업데이트할 고객의 톡톡 ID' },
        new_name: { type: 'string', description: '새 고객명 (풀네임)' },
      },
      required: ['talk_id', 'new_name'],
    },
  },
  {
    name: 'confirm_name_update',
    description:
      "작가님이 고객명 변경을 승인했을 때 호출. '[NAME_UPDATE_YES]' 메시지 수신 시에만 호출. 파라미터 없음.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'link_talk_id_to_booking',
    description:
      'booking에 talk_id를 수동으로 연결합니다. 기존 다른 talk_id와 충돌 시 기존 정보를 보여주고 확인 요청만 반환합니다 (UPDATE 실행 안 함). 충돌 없으면 정상 연결.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: '예약번호' },
        talk_id: { type: 'string', description: '연결할 톡톡 ID' },
      },
      required: ['booking_id', 'talk_id'],
    },
  },
  {
    name: 'link_talk_id_to_booking_force',
    description:
      '⚠️ 직접 호출 금지. confirm_pending_link 도구가 내부적으로만 사용합니다. AI가 직접 호출하면 데이터 오염 발생.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: '예약번호' },
        talk_id: { type: 'string', description: '연결할 톡톡 ID' },
      },
      required: ['booking_id', 'talk_id'],
    },
  },
  {
    name: 'confirm_pending_link',
    description:
      "작가님이 talk_id 충돌 덮어쓰기를 승인('응', '네', 'ok' 등)했을 때 호출. 파라미터 없음. 가장 최근 pending 요청을 자동으로 찾아서 실행합니다.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'confirm_drive_new_products',
    description:
      "Drive 폴더에서 감지된 현장 추가 상품을 작가님이 '추가/응/네/ok' 등으로 승인했을 때 호출. 파라미터 없음. 가장 최근 drive_new_products_detected 메시지의 new_products를 booking_details에 INSERT (match_status='manual').",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'save_frame_address',
    description:
      '고객이 액자 배송 주소를 보냈을 때 저장. AI가 톡톡 메시지에서 주소/성함/연락처를 파싱해서 자동 호출. 작가님 확인 불필요.',
    input_schema: {
      type: 'object',
      properties: {
        talk_id: { type: 'string', description: '고객의 톡톡 ID' },
        frame_address: {
          type: 'string',
          description: '파싱된 배송 주소. 지난번과 동일 주소 의미이면 "[이전주소동일]" 저장',
        },
        frame_recipient: {
          type: 'string',
          description: '받는사람 이름 (없으면 customer_name으로 자동 설정)',
        },
        frame_phone: { type: 'string', description: '연락처 (선택)' },
      },
      required: ['talk_id', 'frame_address'],
    },
  },
  {
    name: 'set_urgent',
    description:
      '특정 예약을 긴급 처리 대상으로 설정합니다. ' +
      '"OOO님 긴급", "긴급 처리", "빠르게 해줘야 해" 등 작가님이 긴급을 언급할 때 호출.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: '예약번호' },
        until_date: {
          type: 'string',
          description: 'YYYY-MM-DD. 날짜 언급 없으면 오늘 날짜(KST)',
        },
        memo: { type: 'string', description: '긴급 사유 (선택)' },
      },
      required: ['booking_id'],
    },
  },
  {
    name: 'record_promotion_consent',
    description:
      '고객의 홍보/업로드 동의 여부를 기록합니다. 동의(홍보o 계열)와 비동의/철회(홍보x) 모두 기록 가능합니다. ' +
      '⚠️ 호출 조건: 스튜디오가 고객 사진을 인스타/SNS에 올리는 것에 대한 고객의 허락 또는 거부/철회가 명확할 때만 호출. ' +
      '고객이 직접 리뷰/후기를 올리겠다는 것("올릴게요", "리뷰 쓸게요")은 동의가 아님 — 호출 금지.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: '예약번호' },
        consent_type: {
          type: 'string',
          enum: ['홍보o', '홍보o-아기만', '홍보o-특정사진만', '홍보x'],
          description:
            '홍보o: 제한 없이 전체 동의, 홍보o-아기만: 아기 사진만 동의, 홍보o-특정사진만: 특정 컷 지정, ' +
            '홍보x: 인스타/SNS 업로드 거부 또는 기존 동의 철회',
        },
        memo: {
          type: 'string',
          description: 'AI가 파악한 동의/거부 내용 요약 (선택)',
        },
      },
      required: ['booking_id', 'consent_type'],
    },
  },
  {
    name: 'show_link_candidates',
    description:
      '동명이인 고객 후보가 여러 명일 때 채팅창에 선택 버튼을 표시합니다. ' +
      'link_talk_id_to_booking 흐름에서 search_customers 결과가 2건 이상일 때만 사용. ' +
      '후보 목록과 연결할 talk_id를 넘기면 작가님이 버튼으로 선택할 수 있습니다.',
    input_schema: {
      type: 'object',
      properties: {
        new_talk_id: { type: 'string', description: '연결할 talk_id' },
        candidates: {
          type: 'array',
          description: '후보 예약 목록 (최대 5건)',
          items: {
            type: 'object',
            properties: {
              booking_id: { type: 'string' },
              customer_name: { type: 'string' },
              shoot_date: { type: 'string', description: 'YYYY-MM-DD' },
            },
          },
        },
      },
      required: ['new_talk_id', 'candidates'],
    },
  },
  {
    name: 'cancel_booking',
    description:
      '예약을 취소 처리합니다. 작가님이 "OOO님 취소", "예약 취소 처리해줘" 등을 요청할 때 호출. ' +
      '바로 취소하지 않고 확인 카드를 채팅창에 표시하며, 작가님이 명시적으로 승인해야 실행됩니다. ' +
      'booking_id에 예약번호 또는 고객명을 넣으면 자동 검색합니다.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: '예약번호 또는 고객명' },
        cancellation_reason: { type: 'string', description: '취소 사유 (선택)' },
        refund_amount: { type: 'number', description: '환불 금액 (원, 선택)' },
      },
      required: ['booking_id'],
    },
  },
];

// ─── 헬퍼 ──────────────────────────────────────────────────────────────

export interface BookingRow {
  booking_id: string;
  talk_id: string | null;
  customer_name: string;
  shoot_date: string | null;
  original_sent_at: string | null;
  selection_received_at: string | null;
  selection_cuts: string | null;
  retouched_sent_at: string | null;
  revision_requested_at: string | null;
  revision_content: string | null;
  revision_no_more_at: string | null;
  revision_sent_at: string | null;
  frame_ordered_at: string | null;
  current_stage: string | null;
}

export function computeStage(b: BookingRow): string {
  if (b.frame_ordered_at) return 'S7';
  if (b.revision_sent_at) return 'S6';
  if (b.revision_no_more_at) return 'S5b';
  if (b.revision_requested_at) return 'S5a';
  if (b.retouched_sent_at) return 'S4';
  if (b.selection_received_at) return 'S3';
  if (b.original_sent_at) return 'S2';
  if (b.shoot_date) return 'S1';
  return 'S0';
}

function todayKstYmd(): string {
  const kstMs = Date.now() + 9 * 3600 * 1000;
  const d = new Date(kstMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── 1) record_milestone ──────────────────────────────────────────────

function toSqliteFormat(dateStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '')
    .replace(/Z$/, '')
    .trim()
    .slice(0, 19);
}

export async function executeRecordMilestone(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const inputBookingId = String(input.booking_id || '').trim();
  const milestone_type = input.milestone_type as MilestoneType;
  const dateInput = input.date ? toSqliteFormat(String(input.date)) : null;
  const content = input.content ? String(input.content) : null;
  const context = input.context ? String(input.context) : '';

  if (!inputBookingId) return { error: 'booking_id가 필요합니다' };
  if (!MILESTONE_COLUMN[milestone_type]) {
    return { error: `알 수 없는 milestone_type: ${milestone_type}` };
  }

  // Phase 5 Step 4-B: shoot_date 형식 검증 (잘못된 형식이 DB에 들어가는 것 사전 차단)
  if (milestone_type === 'shoot' && dateInput) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dateInput)) {
      return {
        error: `shoot_date는 'YYYY-MM-DD HH:MM:SS' 형식이어야 합니다. 받은 값: "${dateInput}". 정확한 시간 정보가 필요합니다.`,
      };
    }
  }

  // 1) booking_id로 먼저 조회
  let before = await env.DB.prepare(
    `SELECT * FROM bookings WHERE booking_id = ?1`,
  )
    .bind(inputBookingId)
    .first<BookingRow>();

  let auto_resolved = false;

  // 2) 없으면 고객명으로 간주하고 자동 검색
  if (!before) {
    const matches = await env.DB.prepare(
      `SELECT booking_id, customer_name, current_stage,
              shoot_date, original_sent_at, selection_received_at, selection_cuts,
              retouched_sent_at, revision_requested_at, revision_content,
              revision_no_more_at, revision_sent_at, frame_ordered_at, talk_id
       FROM bookings
       WHERE customer_name LIKE '%' || ?1 || '%'
       ORDER BY updated_at DESC
       LIMIT 5`,
    )
      .bind(inputBookingId)
      .all<BookingRow>();

    const list = matches.results || [];
    if (list.length === 0) {
      return { error: `고객을 찾을 수 없습니다: ${inputBookingId}` };
    }
    if (list.length > 1) {
      console.log(
        `[ai-tool] record_milestone 다중 매칭 query="${inputBookingId}" hits=${list.length}`,
      );
      return {
        error: '여러 고객이 매칭됩니다',
        matches: list.map((m) => ({
          booking_id: m.booking_id,
          customer_name: m.customer_name,
          current_stage: m.current_stage || computeStage(m),
        })),
        hint: '정확한 booking_id 또는 고객명 전체를 알려주세요',
      };
    }
    before = list[0];
    auto_resolved = true;
    console.log(
      `[ai-tool] record_milestone auto-resolved query="${inputBookingId}" → booking_id=${before.booking_id}`,
    );
  }

  const booking_id = before.booking_id;
  const column = MILESTONE_COLUMN[milestone_type];
  const date = dateInput || toSqliteFormat(new Date().toISOString());
  const beforeValue = (before as any)[column] as string | null;
  const updatedAt = new Date().toISOString();

  // revision_no_more 선행 조건 검증:
  // retouched_sent_at 또는 revision_sent_at 중 하나라도 있어야 함
  if (milestone_type === 'revision_no_more') {
    if (!before.retouched_sent_at && !before.revision_sent_at) {
      console.warn(
        `[ai-tool] record_milestone revision_no_more 차단 booking=${booking_id}: retouched_sent_at=${before.retouched_sent_at} revision_sent_at=${before.revision_sent_at}`,
      );
      return {
        error: `revision_no_more(추가보정없음)는 보정본 발송(retouched_sent_at) 또는 재보정 발송(revision_sent_at)이 기록된 후에만 가능합니다. 현재 두 날짜 모두 없습니다.`,
        booking_id,
        customer_name: before.customer_name,
      };
    }
  }

  // 추가 컬럼 (selection_cuts / revision_content)
  let extraColumn: string | null = null;
  if (milestone_type === 'selection_received' && content) {
    extraColumn = 'selection_cuts';
  } else if (milestone_type === 'revision_requested' && content) {
    extraColumn = 'revision_content';
  }

  // 고객 연락(선택수신·추가보정요청) 시 alert_paused_until 자동 해제
  const clearAlertPause =
    milestone_type === 'selection_received' || milestone_type === 'revision_requested'
      ? ', alert_paused_until = NULL'
      : '';

  if (extraColumn) {
    await env.DB.prepare(
      `UPDATE bookings SET ${column} = ?1, ${extraColumn} = ?2, updated_at = ?3${clearAlertPause} WHERE booking_id = ?4`,
    )
      .bind(date, content, updatedAt, booking_id)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE bookings SET ${column} = ?1, updated_at = ?2${clearAlertPause} WHERE booking_id = ?3`,
    )
      .bind(date, updatedAt, booking_id)
      .run();
  }

  // 이력 기록 (milestone_type을 reason prefix로 인코딩)
  const reasonText = `[milestone:${milestone_type}] AI chat${context ? ': ' + context : ''}`;
  await env.DB.prepare(
    `INSERT INTO schedule_change_history (booking_id, before_value, after_value, reason, changed_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(booking_id, beforeValue, date, reasonText, updatedAt)
    .run();

  // 단계 재계산
  const after = await env.DB.prepare(
    `SELECT * FROM bookings WHERE booking_id = ?1`,
  )
    .bind(booking_id)
    .first<BookingRow>();

  const stage = after ? computeStage(after) : 'S0';

  // current_stage 캐시도 업데이트
  if (after && after.current_stage !== stage) {
    await env.DB.prepare(
      `UPDATE bookings SET current_stage = ?1 WHERE booking_id = ?2`,
    )
      .bind(stage, booking_id)
      .run();
  }

  console.log(
    `[ai-tool] record_milestone ok booking=${booking_id} ${milestone_type}=${date} stage=${stage} auto=${auto_resolved}`,
  );

  // === Phase 5 Step 4-B: shoot_date 변경 시 캘린더 reschedule ===
  // 성공/no_change/invalid_input은 조용히 통과.
  // no_event_id/re_created/예외만 강조 메시지 + 푸시. record_milestone return 값은 변경 X.
  if (milestone_type === 'shoot') {
    let calendarStatus: string | null = null;
    let calendarError: string | null = null;

    try {
      const result = await rescheduleCalendarEvent(
        { env: env as any, db: env.DB },
        booking_id,
        beforeValue,
        date,
      );
      calendarStatus = result.status;
      console.log('[Phase5] Calendar reschedule:', booking_id, result.status);
    } catch (err) {
      calendarError = err instanceof Error ? err.message : String(err);
      console.error(
        '[Phase5] Calendar reschedule throw:',
        booking_id,
        calendarError,
      );
    }

    const needsAlert =
      calendarError !== null ||
      calendarStatus === 'no_event_id' ||
      calendarStatus === 're_created';

    if (needsAlert) {
      const customerName = before.customer_name ?? '(이름 없음)';

      let reasonText: string;
      let titlePrefix: string;
      if (calendarError) {
        reasonText = `에러: ${calendarError}`;
        titlePrefix = '🚨 캘린더 일정 변경 실패';
      } else if (calendarStatus === 'no_event_id') {
        reasonText = '캘린더에 등록된 적이 없는 예약입니다';
        titlePrefix = '🚨 캘린더 일정 변경 누락';
      } else if (calendarStatus === 're_created') {
        reasonText = '캘린더에 이벤트가 없어 새로 등록했습니다 (변경 이력 없음)';
        titlePrefix = '⚠️ 캘린더 새로 등록됨';
      } else {
        reasonText = `상태: ${calendarStatus}`;
        titlePrefix = '⚠️ 캘린더 상태 확인 필요';
      }

      const cleanTitle = titlePrefix.replace(/^🚨 /, '').replace(/^⚠️ /, '');
      const alertMessage =
        `🚨🚨🚨 ${cleanTitle} 🚨🚨🚨\n` +
        `\n` +
        `📌 예약번호: ${booking_id}\n` +
        `📌 고객: ${customerName}\n` +
        `📌 사유: ${reasonText}\n` +
        `\n` +
        `⚠️ 캘린더에서 일정을 확인해주세요.`;

      await env.DB.prepare(
        `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
         VALUES ('system', ?1, ?2, datetime('now'))`,
      )
        .bind(
          alertMessage,
          JSON.stringify({
            type: 'calendar_reschedule_alert',
            booking_id,
            customer_name: customerName,
            status: calendarStatus,
            error: calendarError,
          }),
        )
        .run();

      if (env.ALLOWED_EMAIL) {
        await sendPushNotification(env as any, env.ALLOWED_EMAIL as string, {
          title: titlePrefix,
          body: `${customerName} (${booking_id}) — 채팅창 확인 필요`,
          tag: `calendar_reschedule_${booking_id}`,
          data: {
            source: 'calendar_reschedule_alert',
            booking_id,
          },
        }).catch((e) => console.error('[Phase5] push failed:', e));
      }
    }
  }

  // === shoot_date 변경 시 확정문자 재생성 (채팅창 표시용, 톡톡 미발송) ===
  if (milestone_type === 'shoot' && date) {
    try {
      const customerName = before.customer_name ?? '(이름 없음)';
      const detailRows = await env.DB.prepare(
        `SELECT bd.match_status, bd.raw_text, bd.product_id,
                p.product_name, p.match_keyword,
                COALESCE(p.retouch_count, 0) AS retouch_count,
                p.retouch_breakdown,
                COALESCE(p.frame_count, 0) AS frame_count,
                p.frame_size, p.extra_note
         FROM booking_details bd
         LEFT JOIN products p ON bd.product_id = p.product_id
         WHERE bd.booking_id = ?1
         ORDER BY bd.id`,
      ).bind(booking_id).all<BookingDetailWithProduct>();
      const details = detailRows.results || [];
      const confirmMessage = buildConfirmMessage(customerName, booking_id, date, details);
      await env.DB.prepare(
        `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
         VALUES ('system', ?1, ?2, datetime('now'))`,
      ).bind(
        confirmMessage,
        JSON.stringify({ type: 'confirm_message', booking_id, source: 'reschedule' }),
      ).run();
      console.log(`[Phase5] 확정문자 재생성 booking_id=${booking_id}`);
    } catch (err) {
      console.error('[Phase5] 확정문자 재생성 실패:', err instanceof Error ? err.message : err);
    }
  }
  // === Phase 5 끝 ===

  return {
    success: true,
    auto_resolved,
    booking_id,
    customer_name: before.customer_name,
    milestone_recorded: milestone_type,
    date,
    before_value: beforeValue,
    computed_stage: stage,
    stage_label: STAGE_LABELS[stage] || stage,
  };
}

// ─── 2) search_customers ──────────────────────────────────────────────

export async function executeSearchCustomers(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const query = input.query ? String(input.query).trim() : '';
  const missing = input.missing as
    | 'original'
    | 'selection'
    | 'retouched_pending'
    | 'revision_response'
    | 'frame'
    | undefined;
  const daysSince =
    typeof input.days_since === 'number' ? input.days_since : null;

  const where: string[] = [];
  const binds: unknown[] = [];

  if (query) {
    binds.push(`%${query}%`);
    where.push(`(c.customer_name LIKE ?${binds.length} OR b.customer_name LIKE ?${binds.length})`);
  }

  let baseColumn: string | null = null;
  if (missing === 'original') {
    where.push(`b.shoot_date IS NOT NULL AND b.original_sent_at IS NULL`);
    baseColumn = 'b.shoot_date';
  } else if (missing === 'selection') {
    where.push(`b.original_sent_at IS NOT NULL AND b.selection_received_at IS NULL`);
    baseColumn = 'b.original_sent_at';
  } else if (missing === 'retouched_pending') {
    // 첫 보정 대기 OR 추가보정 발송 대기 (둘 중 하나라도 충족)
    if (daysSince != null) {
      binds.push(daysSince);
      const idx1 = binds.length;
      binds.push(daysSince);
      const idx2 = binds.length;
      where.push(
        `(
          (b.selection_received_at IS NOT NULL AND b.retouched_sent_at IS NULL
           AND julianday('now') - julianday(b.selection_received_at) >= ?${idx1})
          OR
          (b.revision_requested_at IS NOT NULL
           AND (b.revision_sent_at IS NULL OR b.revision_sent_at < b.revision_requested_at)
           AND julianday('now') - julianday(b.revision_requested_at) >= ?${idx2})
        )`,
      );
    } else {
      where.push(
        `(
          (b.selection_received_at IS NOT NULL AND b.retouched_sent_at IS NULL)
          OR
          (b.revision_requested_at IS NOT NULL
           AND (b.revision_sent_at IS NULL OR b.revision_sent_at < b.revision_requested_at))
        )`,
      );
    }
    baseColumn = null; // days_since는 위에서 직접 처리함
  } else if (missing === 'revision_response') {
    where.push(
      `b.retouched_sent_at IS NOT NULL
       AND b.revision_requested_at IS NULL
       AND b.revision_no_more_at IS NULL
       AND b.revision_sent_at IS NULL`,
    );
    baseColumn = 'b.retouched_sent_at';
  } else if (missing === 'frame') {
    where.push(
      `(b.revision_sent_at IS NOT NULL OR b.revision_no_more_at IS NOT NULL)
       AND b.frame_ordered_at IS NULL`,
    );
    baseColumn = `COALESCE(b.revision_sent_at, b.revision_no_more_at)`;
  }

  if (daysSince != null && baseColumn) {
    binds.push(daysSince);
    where.push(`julianday('now') - julianday(${baseColumn}) >= ?${binds.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      b.booking_id, b.talk_id, b.customer_name, b.product_name,
      b.shoot_date, b.original_sent_at, b.selection_received_at,
      b.selection_cuts, b.retouched_sent_at, b.revision_requested_at,
      b.revision_content, b.revision_no_more_at, b.revision_sent_at,
      b.frame_ordered_at, b.current_stage,
      c.phone, c.memo
    FROM bookings b
    LEFT JOIN customers c ON c.talk_id = b.talk_id
    ${whereSql}
    ORDER BY b.updated_at DESC
    LIMIT 10
  `;

  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all<BookingRow & { phone?: string; memo?: string; product_name?: string }>();

  const rows = result.results || [];
  const customers = rows.map((r) => {
    const stage = computeStage(r);
    let pending_reason: 'first_retouch' | 'revision_retouch' | undefined;
    if (missing === 'retouched_pending') {
      const isRevisionPending =
        r.revision_requested_at &&
        (!r.revision_sent_at || r.revision_sent_at < r.revision_requested_at);
      const isFirstPending =
        r.selection_received_at && !r.retouched_sent_at;
      // 추가보정이 더 우선 (보통 더 최근 요청)
      pending_reason = isRevisionPending
        ? 'revision_retouch'
        : isFirstPending
        ? 'first_retouch'
        : undefined;
    }
    return {
      booking_id: r.booking_id,
      talk_id: r.talk_id,
      customer_name: r.customer_name,
      product_name: (r as any).product_name,
      phone: (r as any).phone,
      shoot_date: r.shoot_date,
      original_sent_at: r.original_sent_at,
      selection_received_at: r.selection_received_at,
      retouched_sent_at: r.retouched_sent_at,
      revision_requested_at: r.revision_requested_at,
      revision_no_more_at: r.revision_no_more_at,
      revision_sent_at: r.revision_sent_at,
      frame_ordered_at: r.frame_ordered_at,
      computed_stage: stage,
      stage_label: STAGE_LABELS[stage] || stage,
      ...(pending_reason ? { pending_reason } : {}),
    };
  });

  console.log(
    `[ai-tool] search_customers ok query="${query}" missing=${missing} days=${daysSince} hits=${customers.length}`,
  );

  return { success: true, count: customers.length, customers };
}

// ─── 3) update_customer_memo ──────────────────────────────────────────

export async function executeUpdateCustomerMemo(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const talk_id = String(input.talk_id || '').trim();
  const addition = String(input.memo_addition || '').trim();

  if (!talk_id) return { error: 'talk_id가 필요합니다' };
  if (!addition) return { error: 'memo_addition이 비어 있습니다' };

  const row = await env.DB.prepare(
    `SELECT memo FROM customers WHERE talk_id = ?1`,
  )
    .bind(talk_id)
    .first<{ memo: string | null }>();

  if (!row) return { error: `고객을 찾을 수 없습니다: ${talk_id}` };

  const today = todayKstYmd();
  const newLine = `[${today}] ${addition}`;
  const updatedMemo = row.memo ? `${row.memo}\n${newLine}` : newLine;
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE customers SET memo = ?1, updated_at = ?2 WHERE talk_id = ?3`,
  )
    .bind(updatedMemo, updatedAt, talk_id)
    .run();

  console.log(`[ai-tool] update_customer_memo ok talk_id=${talk_id}`);

  return { success: true, talk_id, updated_memo: updatedMemo };
}

// ─── 4) add_learned_rule ──────────────────────────────────────────────

export async function executeAddLearnedRule(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const rule_type = String(input.rule_type || '').trim();
  const pattern_description = String(input.pattern_description || '').trim();

  if (rule_type !== 'auto_process' && rule_type !== 'confirm_required') {
    return { error: `rule_type은 'auto_process' 또는 'confirm_required'` };
  }
  if (!pattern_description) return { error: 'pattern_description이 비어 있습니다' };

  const conditions = input.conditions ? JSON.stringify(input.conditions) : null;
  const action = input.action ? JSON.stringify(input.action) : null;
  const createdAt = new Date().toISOString();

  const inserted = await env.DB.prepare(
    `INSERT INTO ai_learned_rules
       (rule_type, pattern_description, conditions, action, created_at, apply_count, is_active)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, 1)
     RETURNING id`,
  )
    .bind(rule_type, pattern_description, conditions, action, createdAt)
    .first<{ id: number }>();

  if (!inserted) return { error: '규칙 저장 실패' };

  console.log(
    `[ai-tool] add_learned_rule ok id=${inserted.id} type=${rule_type}`,
  );

  return { success: true, rule_id: inserted.id };
}

// ─── Phase 4 Step 4-B: 상품/질문/매칭 도구 실행 ──────────────────────

interface ProductRow {
  product_id: number;
  product_code: string;
  product_name: string;
  match_keyword: string;
  price: number;
  retouch_count: number;
  retouch_breakdown: string | null;
  frame_count: number;
  frame_size: string | null;
  extra_note: string | null;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const PRODUCT_ALLOWED_UPDATE_FIELDS = [
  'product_name',
  'match_keyword',
  'price',
  'retouch_count',
  'retouch_breakdown',
  'frame_count',
  'frame_size',
  'extra_note',
  'is_active',
  'notes',
] as const;

// 5) register_product
export async function executeRegisterProduct(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const productCode = String(input.product_code || '').trim();
  const productName = String(input.product_name || '').trim();
  const matchKeyword = String(input.match_keyword || '').trim();
  const price = Number(input.price);

  if (!productCode) return { success: false, error: 'product_code가 필요합니다' };
  if (!productName) return { success: false, error: 'product_name이 필요합니다' };
  if (!matchKeyword) return { success: false, error: 'match_keyword가 필요합니다' };
  if (!Number.isInteger(price) || price < 0) {
    return { success: false, error: 'price는 0 이상 정수' };
  }

  const existing = await env.DB.prepare(
    `SELECT product_id FROM products WHERE product_code = ?1`,
  )
    .bind(productCode)
    .first<{ product_id: number }>();
  if (existing) {
    return {
      success: false,
      error: `이미 존재하는 product_code: ${productCode} (id=${existing.product_id})`,
    };
  }

  const retouchCount = Number.isInteger(input.retouch_count) ? input.retouch_count : 0;
  const frameCount = Number.isInteger(input.frame_count) ? input.frame_count : 0;

  const inserted = await env.DB.prepare(
    `INSERT INTO products (
       product_code, product_name, match_keyword, price,
       retouch_count, retouch_breakdown, frame_count, frame_size,
       extra_note, notes
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     RETURNING product_id`,
  )
    .bind(
      productCode,
      productName,
      matchKeyword,
      price,
      retouchCount,
      input.retouch_breakdown ?? null,
      frameCount,
      input.frame_size ?? null,
      input.extra_note ?? null,
      input.notes ?? null,
    )
    .first<{ product_id: number }>();

  if (!inserted) return { success: false, error: 'INSERT 실패' };

  console.log(
    `[ai-tool] register_product code=${productCode} id=${inserted.product_id}`,
  );
  return {
    success: true,
    product_id: inserted.product_id,
    product_code: productCode,
    message: `상품 등록 완료: ${productName} (${productCode})`,
  };
}

// 6) update_product
export async function executeUpdateProduct(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const identifier = String(input.identifier || '').trim();
  const updates = input.updates;

  if (!identifier) return { success: false, error: 'identifier가 필요합니다' };
  if (!updates || typeof updates !== 'object') {
    return { success: false, error: 'updates 객체가 필요합니다' };
  }

  // 1단계: product_code 정확 일치
  let matches: ProductRow[] = [];
  const exact = await env.DB.prepare(
    `SELECT * FROM products WHERE product_code = ?1`,
  )
    .bind(identifier)
    .all<ProductRow>();
  matches = exact.results || [];

  // 2단계: product_name LIKE
  if (matches.length === 0) {
    const like = await env.DB.prepare(
      `SELECT * FROM products WHERE product_name LIKE '%' || ?1 || '%'`,
    )
      .bind(identifier)
      .all<ProductRow>();
    matches = like.results || [];
  }

  if (matches.length === 0) {
    return {
      success: false,
      error: `상품을 찾을 수 없습니다: ${identifier}`,
    };
  }
  if (matches.length > 1) {
    return {
      success: false,
      error: '여러 상품이 매칭됩니다 — 정확한 product_code를 알려주세요',
      candidates: matches.map((m) => ({
        product_code: m.product_code,
        product_name: m.product_name,
      })),
    };
  }

  const target = matches[0];

  // 화이트리스트 필터링
  const setParts: string[] = [];
  const binds: unknown[] = [];
  const applied: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if ((PRODUCT_ALLOWED_UPDATE_FIELDS as readonly string[]).includes(key)) {
      // is_active는 0/1 정수로 정규화 (boolean도 허용)
      let v: unknown = value;
      if (key === 'is_active' && typeof value === 'boolean') {
        v = value ? 1 : 0;
      }
      binds.push(v);
      setParts.push(`${key} = ?${binds.length}`);
      applied[key] = v;
    } else {
      ignored.push(key);
    }
  }

  if (setParts.length === 0) {
    return {
      success: false,
      error: '변경할 허용 필드가 없습니다',
      allowed_fields: PRODUCT_ALLOWED_UPDATE_FIELDS,
      ignored,
    };
  }

  setParts.push(`updated_at = datetime('now')`);
  binds.push(target.product_id);

  await env.DB.prepare(
    `UPDATE products SET ${setParts.join(', ')} WHERE product_id = ?${binds.length}`,
  )
    .bind(...binds)
    .run();

  if (ignored.length > 0) {
    console.warn(`[ai-tool] update_product 무시된 필드: ${ignored.join(', ')}`);
  }
  console.log(
    `[ai-tool] update_product identifier=${identifier} matched=1 updates=${JSON.stringify(applied)}`,
  );

  return {
    success: true,
    product_id: target.product_id,
    product_code: target.product_code,
    applied,
    ignored: ignored.length > 0 ? ignored : undefined,
    message: `${target.product_name} 수정 완료`,
  };
}

// 7) list_products
export async function executeListProducts(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const isActive = input.is_active === false ? false : true; // 기본 true
  const result = await env.DB.prepare(
    `SELECT product_id, product_code, product_name, match_keyword, price,
            retouch_count, retouch_breakdown, frame_count, frame_size,
            extra_note, is_active, notes
     FROM products
     WHERE is_active = ?1
     ORDER BY product_code ASC`,
  )
    .bind(isActive ? 1 : 0)
    .all<ProductRow>();

  const rows = result.results || [];
  console.log(`[ai-tool] list_products active=${isActive} count=${rows.length}`);
  return {
    success: true,
    count: rows.length,
    products: rows,
  };
}

// 8) register_question
export async function executeRegisterQuestion(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const code = String(input.question_code || '').trim();
  const trigger = String(input.trigger_keyword || '').trim();
  const text = String(input.question_text || '').trim();

  if (!code) return { success: false, error: 'question_code가 필요합니다' };
  if (!trigger) return { success: false, error: 'trigger_keyword가 필요합니다' };
  if (!text) return { success: false, error: 'question_text가 필요합니다' };

  const existing = await env.DB.prepare(
    `SELECT question_id FROM additional_questions WHERE question_code = ?1`,
  )
    .bind(code)
    .first<{ question_id: number }>();
  if (existing) {
    return {
      success: false,
      error: `이미 존재하는 question_code: ${code} (id=${existing.question_id})`,
    };
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO additional_questions (question_code, trigger_keyword, question_text)
     VALUES (?1, ?2, ?3)
     RETURNING question_id`,
  )
    .bind(code, trigger, text)
    .first<{ question_id: number }>();

  if (!inserted) return { success: false, error: 'INSERT 실패' };

  console.log(
    `[ai-tool] register_question code=${code} id=${inserted.question_id}`,
  );
  return {
    success: true,
    question_id: inserted.question_id,
    question_code: code,
    message: `추가 질문 등록 완료: ${code}`,
  };
}

// 9) list_questions
export async function executeListQuestions(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const isActive = input.is_active === false ? false : true;
  const result = await env.DB.prepare(
    `SELECT question_id, question_code, trigger_keyword, question_text, is_active
     FROM additional_questions
     WHERE is_active = ?1
     ORDER BY question_code ASC`,
  )
    .bind(isActive ? 1 : 0)
    .all();

  const rows = result.results || [];
  console.log(`[ai-tool] list_questions active=${isActive} count=${rows.length}`);
  return {
    success: true,
    count: rows.length,
    questions: rows,
  };
}

// 10) manual_match_booking_detail
export async function executeManualMatchBookingDetail(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const detailId = Number(input.booking_detail_id);
  const productIdentifier = String(input.product_identifier || '').trim();

  if (!Number.isInteger(detailId) || detailId <= 0) {
    return { success: false, error: 'booking_detail_id는 양의 정수' };
  }
  if (!productIdentifier) {
    return { success: false, error: 'product_identifier가 필요합니다' };
  }

  // product 찾기
  let matches: ProductRow[] = [];
  const exact = await env.DB.prepare(
    `SELECT * FROM products WHERE product_code = ?1`,
  )
    .bind(productIdentifier)
    .all<ProductRow>();
  matches = exact.results || [];
  if (matches.length === 0) {
    const like = await env.DB.prepare(
      `SELECT * FROM products WHERE product_name LIKE '%' || ?1 || '%'`,
    )
      .bind(productIdentifier)
      .all<ProductRow>();
    matches = like.results || [];
  }

  if (matches.length === 0) {
    return { success: false, error: `상품을 찾을 수 없습니다: ${productIdentifier}` };
  }
  if (matches.length > 1) {
    return {
      success: false,
      error: '여러 상품이 매칭됩니다 — 정확한 product_code를 알려주세요',
      candidates: matches.map((m) => ({
        product_code: m.product_code,
        product_name: m.product_name,
      })),
    };
  }
  const product = matches[0];

  // booking_detail 존재 확인
  const detail = await env.DB.prepare(
    `SELECT id, booking_id, match_status FROM booking_details WHERE id = ?1`,
  )
    .bind(detailId)
    .first<{ id: number; booking_id: string; match_status: string }>();
  if (!detail) {
    return {
      success: false,
      error: `booking_detail을 찾을 수 없습니다: id=${detailId}`,
    };
  }

  await env.DB.prepare(
    `UPDATE booking_details
     SET product_id = ?1, match_status = 'manual'
     WHERE id = ?2`,
  )
    .bind(product.product_id, detailId)
    .run();

  console.log(
    `[ai-tool] manual_match booking_detail_id=${detailId} → product_id=${product.product_id}`,
  );

  return {
    success: true,
    booking_detail_id: detailId,
    booking_id: detail.booking_id,
    product_id: product.product_id,
    product_code: product.product_code,
    message: `수동 매칭 완료: ${product.product_name}`,
  };
}

// ─── Phase 6: 고객 수동 관리 ────────────────────────────────────────

export async function executeRegisterCustomer(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const talk_id = String(input.talk_id || '').trim();
  const customer_name = String(input.customer_name || '').trim();
  const phone = input.phone ? String(input.phone).trim() : null;
  const memo = input.memo ? String(input.memo).trim() : null;

  if (!talk_id) return { error: 'talk_id가 필요합니다' };
  if (!customer_name) return { error: 'customer_name이 필요합니다' };

  try {
    await env.DB.prepare(
      `INSERT INTO customers (talk_id, customer_name, phone, memo, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))`,
    )
      .bind(talk_id, customer_name, phone, memo)
      .run();
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`[ai-tool] register_customer 실패 talk_id=${talk_id}: ${msg}`);
    return { error: `고객 등록 실패: ${msg}` };
  }

  console.log(
    `[ai-tool] register_customer ok talk_id=${talk_id} name=${customer_name}`,
  );
  return {
    success: true,
    talk_id,
    customer_name,
    message: `고객 등록 완료: ${customer_name} (talk_id: ${talk_id})`,
  };
}

export async function executeUpdateCustomerName(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const talk_id = String(input.talk_id || '').trim();
  const new_name = String(input.new_name || '').trim();

  if (!talk_id) return { error: 'talk_id가 필요합니다' };
  if (!new_name) return { error: 'new_name이 필요합니다' };

  const existing = await env.DB.prepare(
    `SELECT customer_name FROM customers WHERE talk_id = ?1`,
  )
    .bind(talk_id)
    .first<{ customer_name: string }>();

  if (!existing) {
    return { error: `해당 talk_id 고객을 찾을 수 없습니다: ${talk_id}` };
  }
  const old_name = existing.customer_name;

  const expRow = await env.DB.prepare(
    `SELECT datetime('now', '+10 minutes') AS exp`,
  ).first<{ exp: string }>();
  const expires_at = expRow?.exp ?? '';

  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  )
    .bind(
      `[NAME_UPDATE_PENDING] talk_id=${talk_id} new_name=${new_name}`,
      JSON.stringify({
        type: 'name_update_pending',
        talk_id,
        old_name,
        new_name,
        expires_at,
      }),
    )
    .run();

  console.log(
    `[ai-tool] update_customer_name pending talk_id=${talk_id} ${old_name} → ${new_name}`,
  );

  return {
    pending: true,
    message:
      `고객명을 변경하려고 합니다.\n- 현재: ${old_name}\n- 변경: ${new_name}\n\n변경할까요?`,
  };
}

export async function executeConfirmNameUpdate(
  env: Env,
  _input: Record<string, any>,
): Promise<unknown> {
  const pending = await env.DB.prepare(
    `SELECT id, metadata
     FROM ai_chat_messages
     WHERE json_extract(metadata, '$.type') = 'name_update_pending'
     ORDER BY id DESC
     LIMIT 1`,
  ).first<{ id: number; metadata: string }>();

  if (!pending) {
    return { error: '처리할 대기 중인 이름 변경 요청이 없습니다.' };
  }

  let meta: { talk_id?: string; old_name?: string; new_name?: string; expires_at?: string } = {};
  try {
    meta = JSON.parse(pending.metadata);
  } catch (e) {
    return { error: `pending metadata 파싱 실패: ${e instanceof Error ? e.message : String(e)}` };
  }

  const nowRow = await env.DB.prepare(
    `SELECT datetime('now') AS now`,
  ).first<{ now: string }>();
  const now = nowRow?.now ?? '';

  if (!meta.expires_at || meta.expires_at < now) {
    await env.DB.prepare(
      `UPDATE ai_chat_messages
       SET metadata = json_set(metadata, '$.type', 'name_update_expired')
       WHERE id = ?1`,
    ).bind(pending.id).run();
    return { error: '요청이 만료되었습니다. 다시 변경 요청해주세요.' };
  }

  const talk_id = meta.talk_id ?? '';
  const old_name = meta.old_name ?? '';
  const new_name = meta.new_name ?? '';

  if (!talk_id || !new_name) {
    return { error: 'pending에 talk_id 또는 new_name 누락' };
  }

  await env.DB.prepare(
    `UPDATE customers SET customer_name = ?1, updated_at = datetime('now') WHERE talk_id = ?2`,
  ).bind(new_name, talk_id).run();

  const bookingRows = await env.DB.prepare(
    `SELECT booking_id FROM bookings WHERE talk_id = ?1`,
  ).bind(talk_id).all<{ booking_id: string }>();
  const bookings = bookingRows.results || [];
  const cnt = bookings.length;

  if (cnt > 0) {
    await env.DB.prepare(
      `UPDATE bookings SET customer_name = ?1, updated_at = datetime('now') WHERE talk_id = ?2`,
    ).bind(new_name, talk_id).run();

    for (const { booking_id } of bookings) {
      await renameCustomerInCalendarEvent(
        { env: env as any, db: env.DB },
        booking_id,
        new_name,
      ).catch((err) =>
        console.error('[ai-tool] confirm_name_update 캘린더 패치 실패:', booking_id, err),
      );
    }
  }

  await env.DB.prepare(
    `UPDATE ai_chat_messages
     SET metadata = json_set(metadata, '$.type', 'name_update_used')
     WHERE id = ?1`,
  ).bind(pending.id).run();

  console.log(
    `[ai-tool] confirm_name_update ok talk_id=${talk_id} ${old_name} → ${new_name} bookings=${cnt}`,
  );

  const tail = cnt > 0 ? `예약 ${cnt}건 함께 업데이트` : '연결된 예약 없음';
  const calendarNote = cnt > 0 ? ', 캘린더 제목 갱신 시도' : '';

  return {
    success: true,
    talk_id,
    old_name,
    new_name,
    bookings_updated: cnt,
    message: `✅ 고객명 변경 완료: ${old_name} → ${new_name} (${tail}${calendarNote})`,
  };
}

interface LinkBookingRow {
  booking_id: string;
  talk_id: string | null;
  customer_name: string;
}

/**
 * bookings.talk_id 실제 UPDATE 수행 (충돌 체크는 호출자 책임).
 * - customers INSERT OR IGNORE (FK 충족)
 * - customers 풀네임이면 bookings.customer_name도 함께 갱신
 * - UPDATE 결과 changes=0 시 error 반환
 */
async function doLinkUpdate(
  env: Env,
  booking_id: string,
  talk_id: string,
  row: LinkBookingRow,
  forcedOverwrite: boolean,
): Promise<unknown> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customers (talk_id, customer_name, created_at, updated_at)
     VALUES (?1, ?2, datetime('now'), datetime('now'))`,
  )
    .bind(talk_id, row.customer_name)
    .run();

  const resolvedRow = await env.DB.prepare(
    `SELECT customer_name FROM customers WHERE talk_id = ?1`,
  )
    .bind(talk_id)
    .first<{ customer_name: string }>();
  const resolved_name = resolvedRow?.customer_name ?? null;
  const isFullName =
    resolved_name !== null &&
    resolved_name.trim() !== '' &&
    !resolved_name.includes('*');
  const nameUpdated = isFullName && resolved_name !== row.customer_name;

  const updateResult = nameUpdated
    ? await env.DB.prepare(
        `UPDATE bookings
         SET talk_id = ?1, customer_name = ?2, updated_at = datetime('now')
         WHERE booking_id = ?3`,
      )
        .bind(talk_id, resolved_name, booking_id)
        .run()
    : await env.DB.prepare(
        `UPDATE bookings
         SET talk_id = ?1, updated_at = datetime('now')
         WHERE booking_id = ?2`,
      )
        .bind(talk_id, booking_id)
        .run();

  const changes = updateResult.meta?.changes ?? 0;
  if (changes === 0) {
    console.error(
      `[ai-tool] link UPDATE 0건 booking=${booking_id} talk_id=${talk_id}`,
    );
    return {
      error: 'UPDATE 실패: 해당 예약을 찾을 수 없습니다',
      booking_id,
      talk_id,
    };
  }

  console.log(
    `[ai-tool] link OK booking=${booking_id} talk_id=${row.talk_id ?? 'NULL'} → ${talk_id} forced=${forcedOverwrite} changes=${changes} name=${nameUpdated ? `${row.customer_name}→${resolved_name}` : 'unchanged'}`,
  );

  const prefix = forcedOverwrite
    ? 'talk_id 연결 완료 (강제)'
    : 'talk_id 연결 완료';
  const message = nameUpdated
    ? `${prefix}: 예약 ${booking_id} ↔ ${talk_id} / 고객명도 업데이트: ${row.customer_name} → ${resolved_name}`
    : `${prefix}: 예약 ${booking_id} ↔ ${talk_id} (${row.customer_name}, 고객명 유지)`;

  return {
    success: true,
    booking_id,
    talk_id,
    previous_talk_id: row.talk_id,
    overwritten: row.talk_id !== null && row.talk_id !== talk_id,
    forced: forcedOverwrite,
    booking_customer_name_updated: nameUpdated,
    booking_customer_name: nameUpdated ? resolved_name : row.customer_name,
    message,
  };
}

/**
 * 충돌 체크 포함. 충돌 시 UPDATE 안 하고 확인 메시지만 반환.
 * 충돌 없으면 doLinkUpdate로 실제 연결.
 */
export async function executeLinkTalkIdToBooking(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const booking_id = String(input.booking_id || '').trim();
  const talk_id = String(input.talk_id || '').trim();

  if (!booking_id) return { error: 'booking_id가 필요합니다' };
  if (!talk_id) return { error: 'talk_id가 필요합니다' };

  const row = await env.DB.prepare(
    `SELECT b.booking_id, b.talk_id, b.customer_name,
            c.customer_name AS linked_customer_name
     FROM bookings b
     LEFT JOIN customers c ON b.talk_id = c.talk_id
     WHERE b.booking_id = ?1`,
  )
    .bind(booking_id)
    .first<{
      booking_id: string;
      talk_id: string | null;
      customer_name: string;
      linked_customer_name: string | null;
    }>();

  if (!row) {
    return { error: `예약을 찾을 수 없습니다: ${booking_id}` };
  }

  // 멱등성: 이미 같은 talk_id면 단축
  if (row.talk_id === talk_id) {
    return {
      success: true,
      already_linked: true,
      booking_id,
      talk_id,
      message: `이미 연결되어 있습니다: ${booking_id} ↔ ${talk_id}`,
    };
  }

  // 충돌: 기존 talk_id가 다른 값이면 확인 요청만 반환 (UPDATE 안 함)
  if (row.talk_id && row.talk_id !== talk_id) {
    const existingCust = await env.DB.prepare(
      `SELECT customer_name, phone FROM customers WHERE talk_id = ?1`,
    )
      .bind(row.talk_id)
      .first<{ customer_name: string; phone: string | null }>();

    // pending 저장 — confirm_pending_link 도구가 이걸 참조해서 실행
    const pendingMetadata = await env.DB.prepare(
      `SELECT datetime('now') AS now, datetime('now', '+10 minutes') AS exp`,
    ).first<{ now: string; exp: string }>();
    const expires_at = pendingMetadata?.exp ?? '';
    await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
       VALUES ('system', ?1, ?2, datetime('now'))`,
    )
      .bind(
        `[LINK_PENDING] booking_id=${booking_id} new_talk_id=${talk_id}`,
        JSON.stringify({
          type: 'link_confirm_pending',
          booking_id,
          new_talk_id: talk_id,
          expires_at,
        }),
      )
      .run();

    const msg =
      `⚠️ talk_id 충돌이 감지되었습니다.\n\n` +
      `예약번호: ${booking_id}\n` +
      `예약 고객명: ${row.customer_name}\n\n` +
      `현재 연결된 talk_id: ${row.talk_id}\n` +
      `└ 고객명: ${row.linked_customer_name ?? existingCust?.customer_name ?? '(없음)'}\n` +
      `└ 전화: ${existingCust?.phone ?? '(없음)'}\n\n` +
      `요청한 talk_id: ${talk_id}\n\n` +
      `덮어쓰시려면 "응" / "네" / "ok" 등으로 승인해주세요. (10분 내 유효)`;

    return {
      success: false,
      conflict: true,
      booking_id,
      existing_talk_id: row.talk_id,
      requested_talk_id: talk_id,
      pending: true,
      expires_at,
      message: msg,
    };
  }

  // 충돌 없음 (talk_id가 NULL) → 실제 연결
  return await doLinkUpdate(env, booking_id, talk_id, row, false);
}

/**
 * 작가님 명시 승인 후 호출되는 강제 연결 도구. 충돌 체크 없이 바로 UPDATE.
 */
export async function executeLinkTalkIdToBookingForce(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const booking_id = String(input.booking_id || '').trim();
  const talk_id = String(input.talk_id || '').trim();

  if (!booking_id) return { error: 'booking_id가 필요합니다' };
  if (!talk_id) return { error: 'talk_id가 필요합니다' };

  const row = await env.DB.prepare(
    `SELECT booking_id, talk_id, customer_name
     FROM bookings WHERE booking_id = ?1`,
  )
    .bind(booking_id)
    .first<LinkBookingRow>();

  if (!row) {
    return { error: `예약을 찾을 수 없습니다: ${booking_id}` };
  }

  // 멱등성: 이미 같은 talk_id면 단축
  if (row.talk_id === talk_id) {
    return {
      success: true,
      already_linked: true,
      booking_id,
      talk_id,
      message: `이미 연결되어 있습니다: ${booking_id} ↔ ${talk_id}`,
    };
  }

  const forcedOverwrite = row.talk_id !== null && row.talk_id !== talk_id;
  return await doLinkUpdate(env, booking_id, talk_id, row, forcedOverwrite);
}

/**
 * 작가님 승인 시 호출. ai_chat_messages에 저장된 최근 link_confirm_pending을
 * 찾아서 실제 연결 실행. 만료/없음/실행 후 used 표시 처리.
 */
export async function executeConfirmPendingLink(
  env: Env,
  _input: Record<string, any>,
): Promise<unknown> {
  const pending = await env.DB.prepare(
    `SELECT id, metadata
     FROM ai_chat_messages
     WHERE json_extract(metadata, '$.type') = 'link_confirm_pending'
     ORDER BY id DESC
     LIMIT 1`,
  ).first<{ id: number; metadata: string }>();

  if (!pending) {
    return { error: '처리할 대기 중인 연결 요청이 없습니다.' };
  }

  let meta: {
    booking_id?: string;
    new_talk_id?: string;
    expires_at?: string;
  } = {};
  try {
    meta = JSON.parse(pending.metadata);
  } catch (e) {
    return {
      error: `pending metadata 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const nowRow = await env.DB.prepare(
    `SELECT datetime('now') AS now`,
  ).first<{ now: string }>();
  const now = nowRow?.now ?? '';

  if (!meta.expires_at || meta.expires_at < now) {
    // 만료 표시도 함께 — 다음 호출에서 다시 잡히지 않도록
    await env.DB.prepare(
      `UPDATE ai_chat_messages
       SET metadata = json_set(metadata, '$.type', 'link_confirm_expired')
       WHERE id = ?1`,
    )
      .bind(pending.id)
      .run();
    return { error: '요청이 만료되었습니다. 다시 연결 요청해주세요.' };
  }

  const booking_id = meta.booking_id ?? '';
  const talk_id = meta.new_talk_id ?? '';
  if (!booking_id || !talk_id) {
    return { error: 'pending에 booking_id 또는 new_talk_id 누락' };
  }

  const row = await env.DB.prepare(
    `SELECT booking_id, talk_id, customer_name
     FROM bookings WHERE booking_id = ?1`,
  )
    .bind(booking_id)
    .first<LinkBookingRow>();
  if (!row) {
    return { error: `예약을 찾을 수 없습니다: ${booking_id}` };
  }

  // 이미 같은 값이면 멱등 단축 (used 표시도 함께)
  if (row.talk_id === talk_id) {
    await env.DB.prepare(
      `UPDATE ai_chat_messages
       SET metadata = json_set(metadata, '$.type', 'link_confirm_used')
       WHERE id = ?1`,
    )
      .bind(pending.id)
      .run();
    return {
      success: true,
      already_linked: true,
      booking_id,
      talk_id,
      message: `이미 연결되어 있습니다: ${booking_id} ↔ ${talk_id}`,
    };
  }

  const forcedOverwrite = row.talk_id !== null && row.talk_id !== talk_id;
  const result = (await doLinkUpdate(
    env,
    booking_id,
    talk_id,
    row,
    forcedOverwrite,
  )) as { success?: boolean; error?: string };

  // 실패 시 pending은 보존 (재시도 가능)
  if (!result.success) return result;

  await env.DB.prepare(
    `UPDATE ai_chat_messages
     SET metadata = json_set(metadata, '$.type', 'link_confirm_used')
     WHERE id = ?1`,
  )
    .bind(pending.id)
    .run();

  return result;
}

// ─── Phase 6-B Step 3: Drive 현장 추가 상품 승인 ──────────────────────

export async function executeConfirmDriveNewProducts(
  env: Env,
  _input: Record<string, any>,
): Promise<unknown> {
  const pending = await env.DB.prepare(
    `SELECT id, metadata
     FROM ai_chat_messages
     WHERE json_extract(metadata, '$.type') = 'drive_new_products_detected'
     ORDER BY id DESC
     LIMIT 1`,
  ).first<{ id: number; metadata: string }>();

  if (!pending) {
    console.warn('[ai-tool] confirm_drive_new_products: pending 없음');
    return { error: '처리할 대기 중인 상품 추가 요청이 없습니다.' };
  }

  let meta: {
    booking_id?: string;
    customer_name?: string;
    newProducts?: {
      product_id: number;
      product_code: string;
      product_name: string;
      matchedKeywords?: string[];
    }[];
    // 구버전 metadata 호환
    new_products?: {
      product_id: number;
      product_code: string;
      product_name: string;
    }[];
  } = {};
  try {
    meta = JSON.parse(pending.metadata);
  } catch (e) {
    return {
      error: `pending metadata 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const bookingId = meta.booking_id ?? '';
  const newProducts = meta.newProducts ?? meta.new_products ?? [];
  console.log(
    `[ai-tool] confirm_drive_new_products: pending_id=${pending.id} booking=${bookingId} count=${newProducts.length}`,
  );

  if (!bookingId) {
    return { error: 'pending에 booking_id 누락' };
  }
  if (newProducts.length === 0) {
    return { error: 'pending에 newProducts가 비어 있습니다' };
  }

  // Drive 링크는 가장 최근 drive_link_processed metadata에서 회수 (있으면)
  const linkRow = await env.DB.prepare(
    `SELECT metadata FROM ai_chat_messages
     WHERE json_extract(metadata, '$.type') = 'drive_link_processed'
       AND json_extract(metadata, '$.matched_booking_id') = ?1
     ORDER BY id DESC LIMIT 1`,
  )
    .bind(bookingId)
    .first<{ metadata: string }>();
  let driveLink: string | null = null;
  if (linkRow) {
    try {
      driveLink = JSON.parse(linkRow.metadata).drive_link ?? null;
    } catch (_) {}
  }

  const inserted: { product_code: string; product_name: string }[] = [];
  for (const p of newProducts) {
    if (!p.product_id) {
      console.warn(
        `[ai-tool] confirm_drive_new_products: product_id 누락 skip ${JSON.stringify(p)}`,
      );
      continue;
    }
    const res = await env.DB.prepare(
      `INSERT INTO booking_details
         (booking_id, product_id, quantity, match_status, raw_text, created_at)
       VALUES (?1, ?2, 1, 'manual', '현장추가(Drive폴더)', datetime('now'))`,
    )
      .bind(bookingId, p.product_id)
      .run();
    const changes = res.meta?.changes ?? 0;
    console.log(
      `[ai-tool] booking_details INSERT booking=${bookingId} product_id=${p.product_id} changes=${changes}`,
    );
    if (changes > 0) {
      inserted.push({
        product_code: p.product_code,
        product_name: p.product_name,
      });
    }
  }

  if (inserted.length === 0) {
    return {
      error: 'INSERT 실패: booking_details에 한 건도 추가되지 않았습니다',
      booking_id: bookingId,
      attempted: newProducts.length,
    };
  }

  await env.DB.prepare(
    `UPDATE ai_chat_messages
     SET metadata = json_set(metadata, '$.type', 'drive_new_products_used')
     WHERE id = ?1`,
  )
    .bind(pending.id)
    .run();

  console.log(
    `[ai-tool] confirm_drive_new_products done booking=${bookingId} inserted=${inserted.length}`,
  );

  // 원본 발송 문구 생성은 호출자(chat-api)가 ai 응답 INSERT 후 진행 — 메시지 순서 보장
  const listText = inserted.map((p) => p.product_name).join(', ');
  return {
    success: true,
    inserted: inserted.length,
    booking_id: bookingId,
    customer_name: meta.customer_name,
    products: inserted,
    drive_link: driveLink,
    message:
      `✅ 현장 추가 상품 등록 완료\n` +
      `${listText} → 예약번호 ${bookingId} booking_details에 추가됨\n\n` +
      `📝 원본 발송 문구를 작성 중입니다...`,
  };
}

// ─── mark_frame_sent ──────────────────────────────────────────────────

interface FrameSentCandidate {
  index: number;
  booking_id: string;
  customer_name: string;
  shoot_date: string | null;
  frame_ordered_at: string | null;
}

async function doFrameSentUpdate(env: Env, booking_id: string, customer_name: string): Promise<unknown> {
  await env.DB.prepare(
    `UPDATE bookings
     SET frame_ordered_at = date('now', '+9 hours'), current_stage = 'S7', updated_at = datetime('now')
     WHERE booking_id = ?1`,
  ).bind(booking_id).run();

  console.log(`[ai-tool] mark_frame_sent ok booking=${booking_id}`);

  return {
    success: true,
    booking_id,
    customer_name,
    message: `✅ 액자발송 완료 처리되었습니다.\n${customer_name} (${booking_id}) → S7 액자발주`,
  };
}

export async function executeMarkFrameSent(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const customer_name = String(input.customer_name || '').trim();
  const booking_id = input.booking_id ? String(input.booking_id).trim() : null;

  if (!customer_name) return { error: 'customer_name이 필요합니다' };

  if (booking_id) {
    const booking = await env.DB.prepare(
      `SELECT booking_id, customer_name, frame_ordered_at FROM bookings WHERE booking_id = ?1`,
    ).bind(booking_id).first<{ booking_id: string; customer_name: string; frame_ordered_at: string | null }>();

    if (!booking) return { error: `예약을 찾을 수 없습니다: ${booking_id}` };

    if (booking.frame_ordered_at) {
      return {
        warning: true,
        already_set: true,
        booking_id,
        customer_name: booking.customer_name,
        frame_ordered_at: booking.frame_ordered_at,
        message: `⚠️ 이미 액자발송 완료된 예약입니다.\n현재: ${booking.frame_ordered_at}\n다시 업데이트하려면 명시적으로 요청해주세요.`,
      };
    }

    return await doFrameSentUpdate(env, booking_id, booking.customer_name);
  }

  // customer_name으로 검색
  const result = await env.DB.prepare(
    `SELECT booking_id, customer_name, frame_ordered_at, shoot_date
     FROM bookings
     WHERE customer_name = ?1 AND (cancelled IS NULL OR cancelled = 0)
     ORDER BY shoot_date DESC
     LIMIT 5`,
  ).bind(customer_name).all<{ booking_id: string; customer_name: string; frame_ordered_at: string | null; shoot_date: string | null }>();

  const list = result.results || [];

  if (list.length === 0) {
    return { error: `고객을 찾을 수 없습니다: ${customer_name}` };
  }

  if (list.length === 1) {
    const b = list[0];
    if (b.frame_ordered_at) {
      return {
        warning: true,
        already_set: true,
        booking_id: b.booking_id,
        customer_name: b.customer_name,
        frame_ordered_at: b.frame_ordered_at,
        message: `⚠️ 이미 액자발송 완료된 예약입니다.\n현재: ${b.frame_ordered_at}\n다시 업데이트하려면 명시적으로 요청해주세요.`,
      };
    }
    return await doFrameSentUpdate(env, b.booking_id, b.customer_name);
  }

  // 동명이인 — pending 생성
  const candidates: FrameSentCandidate[] = list.map((b, i) => ({
    index: i + 1,
    booking_id: b.booking_id,
    customer_name: b.customer_name,
    shoot_date: b.shoot_date,
    frame_ordered_at: b.frame_ordered_at,
  }));

  const expRow = await env.DB.prepare(
    `SELECT datetime('now', '+10 minutes') AS exp`,
  ).first<{ exp: string }>();
  const expires_at = expRow?.exp ?? '';

  const candidateText = candidates
    .map((c) => `${c.index}번: ${c.customer_name} (${c.booking_id}) — 촬영: ${c.shoot_date || '미정'}`)
    .join('\n');

  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  ).bind(
    `[FRAME_SENT_PENDING] ${customer_name} — 동명이인 ${candidates.length}명\n\n${candidateText}`,
    JSON.stringify({
      type: 'frame_sent_pending',
      customer_name,
      candidates,
      expires_at,
    }),
  ).run();

  console.log(`[ai-tool] mark_frame_sent pending customer=${customer_name} candidates=${candidates.length}`);

  return {
    pending: true,
    customer_name,
    candidates,
    message: `동명이인이 여러 명입니다. 채팅창에서 번호 버튼을 눌러 선택해주세요:\n\n${candidateText}`,
  };
}

export async function executeConfirmFrameSentSelection(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const selection = Number(input.selection);

  if (!Number.isInteger(selection) || selection < 1) {
    return { error: 'selection은 1 이상 정수여야 합니다' };
  }

  const pending = await env.DB.prepare(
    `SELECT id, metadata FROM ai_chat_messages
     WHERE json_extract(metadata, '$.type') = 'frame_sent_pending'
     ORDER BY id DESC LIMIT 1`,
  ).first<{ id: number; metadata: string }>();

  if (!pending) {
    return { error: '처리할 대기 중인 액자발송 선택 요청이 없습니다.' };
  }

  let meta: { customer_name?: string; candidates?: FrameSentCandidate[]; expires_at?: string } = {};
  try {
    meta = JSON.parse(pending.metadata);
  } catch (e) {
    return { error: `pending metadata 파싱 실패: ${e instanceof Error ? e.message : String(e)}` };
  }

  const nowRow = await env.DB.prepare(`SELECT datetime('now') AS now`).first<{ now: string }>();
  const now = nowRow?.now ?? '';

  if (!meta.expires_at || meta.expires_at < now) {
    await env.DB.prepare(
      `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'frame_sent_expired') WHERE id = ?1`,
    ).bind(pending.id).run();
    return { error: '요청이 만료되었습니다. 다시 액자발송 처리 요청해주세요.' };
  }

  const candidates = meta.candidates || [];
  const selected = candidates.find((c) => c.index === selection);

  if (!selected) {
    return { error: `${selection}번 선택지가 없습니다. 1~${candidates.length} 중에서 선택해주세요.` };
  }

  const updateResult = await doFrameSentUpdate(env, selected.booking_id, selected.customer_name);

  await env.DB.prepare(
    `UPDATE ai_chat_messages SET metadata = json_set(metadata, '$.type', 'frame_sent_used') WHERE id = ?1`,
  ).bind(pending.id).run();

  console.log(`[ai-tool] confirm_frame_sent_selection ok booking=${selected.booking_id} selection=${selection}`);

  return updateResult;
}

// ─── save_frame_address ────────────────────────────────────────────────

export async function executeSaveFrameAddress(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const talk_id = String(input.talk_id || '').trim();
  const frame_address = String(input.frame_address || '').trim();
  const frame_recipient_input = input.frame_recipient ? String(input.frame_recipient).trim() : null;
  const frame_phone = input.frame_phone ? String(input.frame_phone).trim() : null;

  if (!talk_id) return { error: 'talk_id가 필요합니다' };
  if (!frame_address) return { error: 'frame_address가 필요합니다' };

  // talk_id 해소: 1차 customers.talk_id → 2차 bookings.booking_id → 3차 customers.customer_name
  let resolved_talk_id = talk_id;
  let customer = await env.DB.prepare(
    `SELECT customer_name, frame_address FROM customers WHERE talk_id = ?1`,
  ).bind(talk_id).first<{ customer_name: string | null; frame_address: string | null }>();

  if (!customer) {
    // 2차: booking_id로 talk_id 추출
    const byBooking = await env.DB.prepare(
      `SELECT talk_id FROM bookings WHERE booking_id = ?1 LIMIT 1`,
    ).bind(talk_id).first<{ talk_id: string | null }>();
    if (byBooking?.talk_id) {
      resolved_talk_id = byBooking.talk_id;
      customer = await env.DB.prepare(
        `SELECT customer_name, frame_address FROM customers WHERE talk_id = ?1`,
      ).bind(resolved_talk_id).first<{ customer_name: string | null; frame_address: string | null }>();
    }
  }

  if (!customer) {
    // 3차: customer_name 매칭 (동명이인 방지: 1건일 때만)
    const byName = await env.DB.prepare(
      `SELECT talk_id, customer_name, frame_address FROM customers WHERE customer_name = ?1`,
    ).bind(talk_id).all<{ talk_id: string; customer_name: string | null; frame_address: string | null }>();
    if (byName.results.length === 1) {
      resolved_talk_id = byName.results[0].talk_id;
      customer = byName.results[0];
    } else if (byName.results.length > 1) {
      return { error: `동명이인(${talk_id}) ${byName.results.length}명 — talk_id를 직접 지정해 주세요` };
    }
  }

  const customer_name = customer?.customer_name ?? null;
  const frame_recipient = frame_recipient_input || customer_name || resolved_talk_id;

  if (customer) {
    await env.DB.prepare(
      `UPDATE customers
       SET frame_address = ?1, frame_recipient = ?2, frame_phone = ?3, updated_at = datetime('now')
       WHERE talk_id = ?4`,
    ).bind(frame_address, frame_recipient, frame_phone, resolved_talk_id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO customers (talk_id, customer_name, frame_address, frame_recipient, frame_phone, created_at, updated_at)
       VALUES (?1, COALESCE(?2, '미등록'), ?3, ?4, ?5, datetime('now'), datetime('now'))`,
    ).bind(resolved_talk_id, customer_name, frame_address, frame_recipient, frame_phone).run();
  }

  const bookingRow = await env.DB.prepare(
    `SELECT booking_id FROM bookings WHERE talk_id = ?1 ORDER BY updated_at DESC LIMIT 1`,
  ).bind(resolved_talk_id).first<{ booking_id: string }>();
  const booking_id = bookingRow?.booking_id ?? null;

  // 주소 수신 = 고객 연락 → alert_paused_until 초기화
  if (booking_id) {
    await env.DB.prepare(
      `UPDATE bookings SET alert_paused_until = NULL, updated_at = datetime('now') WHERE booking_id = ?1`,
    ).bind(booking_id).run();
  }

  const displayName = customer_name || `미등록(${resolved_talk_id.slice(0, 12)}...)`;
  const msgLines = [
    `📦 액자 배송 주소 저장`,
    `${displayName}님 주소가 저장되었습니다.`,
    `주소: ${frame_address}`,
    `받는분: ${frame_recipient}`,
  ];
  if (frame_phone) msgLines.push(`연락처: ${frame_phone}`);

  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  ).bind(
    msgLines.join('\n'),
    JSON.stringify({
      type: 'frame_address_saved',
      talk_id: resolved_talk_id,
      ...(booking_id ? { booking_id } : {}),
      customer_name,
    }),
  ).run();

  const resultLines = [
    `📦 배송 주소 저장 완료`,
    `- 받는분: ${frame_recipient}`,
    `- 주소: ${frame_address}`,
  ];
  if (frame_phone) resultLines.push(`- 연락처: ${frame_phone}`);

  console.log(`[ai-tool] save_frame_address ok talk_id=${resolved_talk_id}`);

  return {
    success: true,
    talk_id: resolved_talk_id,
    customer_name,
    frame_address,
    frame_recipient,
    frame_phone,
    message: resultLines.join('\n'),
  };
}

// ─── set_urgent ────────────────────────────────────────────────────────

export async function executeSetUrgent(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const booking_id = String(input.booking_id || '').trim();
  const until_date = input.until_date ? String(input.until_date).trim() : todayKstYmd();
  const memo: string | null = input.memo ? String(input.memo).trim() : null;

  if (!booking_id) return { error: 'booking_id가 필요합니다' };

  const booking = await env.DB.prepare(
    `SELECT customer_name FROM bookings WHERE booking_id = ?1`,
  ).bind(booking_id).first<{ customer_name: string | null }>();

  if (!booking) return { error: `예약번호 ${booking_id}를 찾을 수 없습니다` };

  await env.DB.prepare(
    `UPDATE bookings SET urgent_retouch_until = ?1, updated_at = datetime('now') WHERE booking_id = ?2`,
  ).bind(until_date, booking_id).run();

  const customerName = booking.customer_name ?? booking_id;
  const msgLines = [`🔴 [${customerName}] 긴급 설정 완료`, `- 마감일: ${until_date}`];
  if (memo) msgLines.push(`- 사유: ${memo}`);

  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  ).bind(
    msgLines.join('\n'),
    JSON.stringify({ type: 'set_urgent', booking_id, until_date }),
  ).run();

  console.log(`[ai-tool] set_urgent ok booking_id=${booking_id} until_date=${until_date}`);

  return { success: true, booking_id, customer_name: customerName, until_date };
}

// ─── record_promotion_consent ──────────────────────────────────────────

function extractFolderIdFromUrl(url: string): string | null {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function executeRecordPromotionConsent(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const booking_id = String(input.booking_id || '').trim();
  const consent_type = String(input.consent_type || '').trim();
  const memo: string | null = input.memo ? String(input.memo).trim() : null;

  if (!booking_id) return { error: 'booking_id가 필요합니다' };
  if (!consent_type) return { error: 'consent_type이 필요합니다' };

  const booking = await env.DB.prepare(
    `SELECT b.customer_name, b.original_folder_url, b.retouched_folder_url
     FROM bookings b
     WHERE b.booking_id = ?1`,
  ).bind(booking_id).first<{
    customer_name: string | null;
    original_folder_url: string | null;
    retouched_folder_url: string | null;
  }>();

  if (!booking) return { error: `예약번호 ${booking_id}를 찾을 수 없습니다` };

  await env.DB.prepare(
    `UPDATE bookings SET promotion_consent = ?1, updated_at = datetime('now') WHERE booking_id = ?2`,
  ).bind(consent_type, booking_id).run();

  // Drive 폴더 rename (홍보x 비동의/철회 시 스킵)
  // hasFolder: URL 컬럼 null 여부로만 판단 (milestone 날짜 무관)
  const { original_folder_url, retouched_folder_url } = booking;
  const hasFolder = original_folder_url !== null || retouched_folder_url !== null;

  let folder_renamed = false;
  let new_folder_name: string | null = null;

  if (hasFolder && consent_type !== '홍보x') {
    const renamedParentIds = new Set<string>();
    for (const folderUrl of [original_folder_url, retouched_folder_url]) {
      if (!folderUrl) continue;
      const childId = extractFolderIdFromUrl(folderUrl);
      if (!childId) continue;
      try {
        const driveEnv = env as any;
        const parentId = await getParentFolderId(driveEnv, childId);
        if (!parentId || renamedParentIds.has(parentId)) continue;
        renamedParentIds.add(parentId);
        new_folder_name = await renameFolderWithPromotion(driveEnv, parentId, consent_type);
        folder_renamed = true;
      } catch (e: any) {
        console.warn(`[ai-tool] record_promotion_consent Drive rename 실패: ${e?.message}`);
      }
    }
  }

  // 채팅 시스템 메시지
  const customerName = booking.customer_name ?? booking_id;
  const isRefusal = consent_type === '홍보x';
  const msgLines = [isRefusal
    ? `❌ [${customerName}] 홍보 비동의 기록`
    : `✅ [${customerName}] 홍보동의 기록 완료`];
  msgLines.push(`- 동의 유형: ${consent_type}`);
  if (isRefusal) {
    msgLines.push(`- Drive 폴더명 변경 스킵 (비동의)`);
  } else if (!hasFolder) {
    // 둘 다 null인 경우에만 "미발송 상태" 표시
    msgLines.push(
      `- Drive 폴더 미발송 상태로 폴더명 변경 스킵 (원본/보정본 발송 시점에 자동 반영 불가, 추후 수동 확인 필요)`,
    );
  } else if (folder_renamed && new_folder_name) {
    msgLines.push(`- Drive 폴더명 변경: ${new_folder_name}`);
  } else {
    msgLines.push(`- Drive 폴더명 변경 실패 (API 오류 — 수동 확인 필요)`);
  }
  if (memo) msgLines.push(`- 메모: ${memo}`);

  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  ).bind(
    msgLines.join('\n'),
    JSON.stringify({ type: 'promotion_consent', booking_id, consent_type }),
  ).run();

  console.log(
    `[ai-tool] record_promotion_consent ok booking_id=${booking_id} consent_type=${consent_type} folder_renamed=${folder_renamed}`,
  );

  return {
    success: true,
    booking_id,
    customer_name: customerName,
    consent_type,
    folder_renamed,
    new_folder_name,
  };
}

// ─── show_link_candidates ─────────────────────────────────────────────

export async function executeShowLinkCandidates(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const newTalkId = String(input.new_talk_id || '').trim();
  const candidates: Array<{ booking_id: string; customer_name: string; shoot_date?: string }> =
    Array.isArray(input.candidates) ? input.candidates : [];

  if (!newTalkId) return { error: 'new_talk_id가 필요합니다' };
  if (candidates.length === 0) return { error: 'candidates가 비어 있습니다' };

  const indexed = candidates.slice(0, 5).map((c, i) => ({
    index: i + 1,
    booking_id: String(c.booking_id || ''),
    customer_name: String(c.customer_name || ''),
    shoot_date: c.shoot_date ? String(c.shoot_date).slice(0, 10) : null,
  }));

  const lines = indexed.map(
    (c) => `${c.index}번: ${c.customer_name} (예약 ${c.booking_id}${c.shoot_date ? ', 촬영 ' + c.shoot_date : ''})`,
  );
  const body = `동명이인이 ${indexed.length}명 있습니다. 어느 예약에 연결할까요?\\n\\n` + lines.join('\\n');

  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  )
    .bind(
      body,
      JSON.stringify({
        type: 'link_candidates',
        new_talk_id: newTalkId,
        candidates: indexed,
      }),
    )
    .run();

  console.log(`[ai-tool] show_link_candidates new_talk_id=${newTalkId} count=${indexed.length}`);
  return { success: true, candidates: indexed, message: '채팅창에 선택 버튼을 표시했습니다.' };
}

// ─── cancel_booking ───────────────────────────────────────────────────

export async function executeCancelBookingPending(
  env: Env,
  input: Record<string, any>,
): Promise<unknown> {
  const inputId = String(input.booking_id || '').trim();
  const cancellationReason = input.cancellation_reason
    ? String(input.cancellation_reason)
    : null;
  const refundAmount =
    input.refund_amount != null ? Number(input.refund_amount) : null;

  if (!inputId) return { error: 'booking_id가 필요합니다' };

  type BookingBasic = {
    booking_id: string;
    customer_name: string;
    shoot_date: string | null;
    cancelled: number | null;
  };

  // 1) 예약번호 정확 매칭
  let booking = await env.DB.prepare(
    `SELECT booking_id, customer_name, shoot_date, cancelled
     FROM bookings WHERE booking_id = ?1`,
  )
    .bind(inputId)
    .first<BookingBasic>();

  let candidates: Array<{ index: number; booking_id: string; customer_name: string; shoot_date: string | null }> = [];

  if (!booking) {
    // 2) 고객명으로 검색 (취소되지 않은 예약만)
    const rows = await env.DB.prepare(
      `SELECT booking_id, customer_name, shoot_date, cancelled
       FROM bookings
       WHERE customer_name LIKE '%' || ?1 || '%'
         AND (cancelled IS NULL OR cancelled = 0)
       ORDER BY updated_at DESC
       LIMIT 5`,
    )
      .bind(inputId)
      .all<BookingBasic>();

    const list = rows.results || [];
    if (list.length === 0) return { error: `고객을 찾을 수 없습니다: ${inputId}` };

    if (list.length > 1) {
      // 동명이인 → 후보 선택 카드 표시
      candidates = list.map((r, i) => ({
        index: i + 1,
        booking_id: r.booking_id,
        customer_name: r.customer_name,
        shoot_date: r.shoot_date ? r.shoot_date.slice(0, 16).replace('T', ' ') : null,
      }));
    } else {
      booking = list[0];
    }
  }

  // 3) 동명이인 케이스
  if (candidates.length > 0) {
    const lines = candidates.map(
      (c) =>
        `${c.index}번: ${c.customer_name} (예약 ${c.booking_id}${c.shoot_date ? ', 촬영 ' + c.shoot_date : ''})`,
    );
    const text =
      `동명이인이 ${candidates.length}명 있습니다. 어느 예약을 취소할까요?\n\n` +
      lines.join('\n');

    await env.DB.prepare(
      `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
       VALUES ('system', ?1, ?2, datetime('now'))`,
    )
      .bind(
        text,
        JSON.stringify({
          type: 'cancel_candidates',
          candidates,
          cancellation_reason: cancellationReason,
          refund_amount: refundAmount,
        }),
      )
      .run();

    console.log(`[ai-tool] cancel_booking 동명이인 count=${candidates.length}`);
    return {
      status: 'needs_selection',
      message: '채팅창에 후보 선택 버튼을 표시했습니다.',
    };
  }

  // 4) 단건
  if (!booking) return { error: '예약을 찾을 수 없습니다' };

  if (booking.cancelled) {
    return {
      error: `이미 취소된 예약입니다: ${booking.booking_id} (${booking.customer_name})`,
    };
  }

  // 5) 상품 목록 조회
  const detailRows = await env.DB.prepare(
    `SELECT COALESCE(p.product_name, bd.raw_text) AS product_name
     FROM booking_details bd
     LEFT JOIN products p ON bd.product_id = p.product_id
     WHERE bd.booking_id = ?1
     ORDER BY bd.id`,
  )
    .bind(booking.booking_id)
    .all<{ product_name: string | null }>();

  const products = (detailRows.results || [])
    .map((r) => r.product_name || '(상품명 없음)')
    .filter(Boolean);

  // 6) 확인 메시지 텍스트 구성
  const shootDisplay = booking.shoot_date
    ? booking.shoot_date.slice(0, 16).replace('T', ' ')
    : '미정';
  const productLines =
    products.length > 0
      ? products.map((p) => `  · ${p}`).join('\n')
      : '  · (상품 정보 없음)';

  const confirmText =
    `❌ 예약 취소 확인\n\n` +
    `📌 예약번호: ${booking.booking_id}\n` +
    `👤 고객명: ${booking.customer_name}\n` +
    `📅 촬영일정: ${shootDisplay}\n` +
    `🛍 예약상품:\n${productLines}\n\n` +
    `이 예약을 취소 처리할까요?`;

  // 7) 확인 system message INSERT
  const actionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (sender, message, metadata, created_at)
     VALUES ('system', ?1, ?2, datetime('now'))`,
  )
    .bind(
      confirmText,
      JSON.stringify({
        processing: {
          type: 'cancel_booking_pending',
          confirmation: {
            action_id: actionId,
            action_type: 'cancel_booking',
            params: {
              booking_id: booking.booking_id,
              cancellation_reason: cancellationReason,
              refund_amount: refundAmount,
            },
            buttons: [
              { label: '✅ 네, 취소합니다', value: 'yes' },
              { label: '❌ 아니오', value: 'no' },
            ],
          },
        },
      }),
    )
    .run();

  console.log(`[ai-tool] cancel_booking pending booking_id=${booking.booking_id}`);
  return {
    status: 'pending_confirmation',
    message: '취소 확인 카드를 표시했습니다. 작가님이 승인하면 처리됩니다.',
  };
}

// ─── 통합 핸들러 ───────────────────────────────────────────────────────

export async function handleToolUse(
  env: Env,
  tool_name: string,
  tool_input: Record<string, any>,
): Promise<unknown> {
  console.log(`[ai-tool] call ${tool_name} input=${JSON.stringify(tool_input)}`);
  try {
    switch (tool_name) {
      case 'record_milestone':
        return await executeRecordMilestone(env, tool_input);
      case 'search_customers':
        return await executeSearchCustomers(env, tool_input);
      case 'update_customer_memo':
        return await executeUpdateCustomerMemo(env, tool_input);
      case 'add_learned_rule':
        return await executeAddLearnedRule(env, tool_input);
      case 'register_product':
        return await executeRegisterProduct(env, tool_input);
      case 'update_product':
        return await executeUpdateProduct(env, tool_input);
      case 'list_products':
        return await executeListProducts(env, tool_input);
      case 'register_question':
        return await executeRegisterQuestion(env, tool_input);
      case 'list_questions':
        return await executeListQuestions(env, tool_input);
      case 'manual_match_booking_detail':
        return await executeManualMatchBookingDetail(env, tool_input);
      case 'register_customer':
        return await executeRegisterCustomer(env, tool_input);
      case 'update_customer_name':
        return await executeUpdateCustomerName(env, tool_input);
      case 'confirm_name_update':
        return await executeConfirmNameUpdate(env, tool_input);
      case 'link_talk_id_to_booking':
        return await executeLinkTalkIdToBooking(env, tool_input);
      case 'link_talk_id_to_booking_force':
        return await executeLinkTalkIdToBookingForce(env, tool_input);
      case 'confirm_pending_link':
        return await executeConfirmPendingLink(env, tool_input);
      case 'confirm_drive_new_products':
        return await executeConfirmDriveNewProducts(env, tool_input);
      case 'mark_frame_sent':
        return { error: 'frame_ordered_at은 아뜨레 발주 시스템 webhook에서만 설정됩니다. AI가 직접 변경할 수 없습니다.' };
      case 'confirm_frame_sent_selection':
        return { error: 'frame_ordered_at은 아뜨레 발주 시스템 webhook에서만 설정됩니다.' };
      case 'save_frame_address':
        return await executeSaveFrameAddress(env, tool_input);
      case 'record_promotion_consent':
        return await executeRecordPromotionConsent(env, tool_input);
      case 'set_urgent':
        return await executeSetUrgent(env, tool_input);
      case 'show_link_candidates':
        return await executeShowLinkCandidates(env, tool_input);
      case 'cancel_booking':
        return await executeCancelBookingPending(env, tool_input);
      default:
        return { error: `알 수 없는 도구: ${tool_name}` };
    }
  } catch (e: any) {
    console.log(`[ai-tool] ${tool_name} 실패: ${e?.message || e}`);
    return { error: String(e?.message || e) };
  }
}

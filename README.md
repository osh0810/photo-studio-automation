# 사진관 업무누락방지 자동화 시스템

네이버 톡톡 메시지를 자동 분류하고, 업무 단계별 누락을 방지하는 자동화 시스템.

## 📌 프로젝트 개요

사진관 운영 중 발생하는 다음 4가지 업무 누락을 방지합니다:

- 원본(링크) 발송 누락
- 보정요청 처리 누락
- 추가보정요청 처리 누락
- 액자 제작 누락

네이버 톡톡으로 들어오는 메시지를 자동 분류하여 Google Sheets에 기록하고, 각 업무 단계에서 정해진 기간 내에 후속 작업이 진행되지 않으면 Discord 알림을 발송합니다.

## 🛠 기술 스택

- **런타임**: Cloudflare Workers (서버리스)
- **언어**: TypeScript
- **데이터 저장**: Google Sheets API
- **AI 분류**: Anthropic Claude API (Haiku 4.5)
- **알림**: Discord Webhook
- **중복 방지/캐시**: Cloudflare KV (예정)
- **배포 도구**: Wrangler CLI

## 🏗 아키텍처

```
[고객]
  ↓ 톡톡 메시지
[네이버 톡톡 파트너 API]
  ↓ Webhook
[Cloudflare Workers]
  ├─ Webhook Handler
  │   ├─ 1. 원본 백업 (필수)
  │   ├─ 2. 중복 체크
  │   ├─ 3. 고객 검색 (Sheets)
  │   ├─ 4. AI 분류 (Anthropic)
  │   ├─ 5. Sheets 업데이트
  │   └─ 6. Discord 알림
  └─ Cron Handler (매일 09:00 KST)
      ├─ 1. 전체 고객 스캔
      ├─ 2. 알림 조건 체크
      └─ 3. Discord 일일 리포트
```

## 📁 디렉토리 구조

```
src/
├── index.ts              # 메인 진입점 및 라우팅
├── handlers/
│   ├── webhook.ts        # 톡톡 webhook 처리
│   └── cron.ts           # 일일 알림 점검
├── services/
│   ├── sheets.ts         # Google Sheets API
│   ├── classifier.ts     # Claude API 메시지 분류
│   ├── discord.ts        # Discord 알림 발송
│   └── backup.ts         # 원본 백업 처리
├── lib/
│   ├── retry.ts          # 재시도 로직
│   ├── dedup.ts          # 중복 방지 (KV)
│   └── alerts.ts         # 알림 등급 판정
├── types/
│   └── index.ts          # 타입 정의
└── prompts/
    └── classifier.ts     # Claude 분류 프롬프트
```

## 🔄 워크플로우 단계

| 코드 | 단계 | 다음 마일스톤 | 알림 기준 |
|---|---|---|---|
| S0 | 신규 문의 | 예약 확정 | - |
| S1 | 촬영 완료 | 원본 발송 | 촬영일 +1일 |
| S2 | 원본 발송 완료 | 셀렉 수신 | 발송일 +7일 (1차), +14일 (2차) |
| S3 | 셀렉 수신 완료 | 보정본 발송 | 셀렉일 +7일 |
| S4 | 보정본 발송 완료 | 추가보정 여부 확인 | 발송 직후 운영자 확인 필요 |
| S5a | 추가보정 요청됨 | 추가보정본 발송 | 요청일 +7일 |
| S5b | 추가보정 없음 확정 | 액자 발주 | 확정일 +1일 |
| S6 | 추가보정본 발송 완료 | 액자 발주 | 발송일 +1일 |
| S7 | 액자 발주 완료 | (종결) | - |

알림 등급:
- 🔴 **긴급**: 기준일 +7일 초과
- 🟡 **일반**: 기준일 도달
- 📌 **확인필요**: 사람의 판단 필요

## 🚀 개발

### 로컬 실행

```bash
# 개발 서버 실행 (.dev.vars 사용)
npx wrangler dev

# 또는
npm run dev
```

### 배포

```bash
# 프로덕션 배포
npx wrangler deploy

# 또는
npm run deploy
```

### Secret 관리

```bash
# 시크릿 등록
npx wrangler secret put <KEY_NAME>

# 시크릿 목록 조회 (값은 표시 안 됨)
npx wrangler secret list

# 시크릿 삭제
npx wrangler secret delete <KEY_NAME>
```

### 로그 확인

```bash
# 실시간 로그 모니터링
npx wrangler tail
```

## 🔐 환경변수

로컬 개발: `.dev.vars` 파일 사용  
프로덕션: Cloudflare Workers Secrets 사용

| 변수명 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 키 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Service Account 이메일 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Google Service Account 키 |
| `GOOGLE_SHEETS_ID` | 대상 스프레드시트 ID |
| `DISCORD_WEBHOOK_DAILY` | 일일점검 채널 webhook URL |
| `DISCORD_WEBHOOK_PROCESSED` | 처리내역 채널 webhook URL |
| `DISCORD_WEBHOOK_ERROR` | 긴급에러 채널 webhook URL |
| `NAVER_TALK_AUTH_TOKEN` | 네이버 톡톡 보내기 API 토큰 (자동 답신용) |

## 📊 데이터 구조

Google Sheets에 3개 시트로 구성:

### 고객목록
메인 데이터. 각 고객의 진행 단계와 모든 일정을 추적.

### _원본백업
모든 webhook 메시지의 원본을 저장. 처리 실패 시 복구용.

### _시스템로그
시스템 이벤트 로그. INFO/WARNING/ERROR/CRITICAL 등급으로 분류.

자세한 컬럼 구성은 별도 명세서 참조.

## 🛡 장애 대응

3단 방어선:
1. **1차**: Webhook 도착 즉시 백업 시트에 원본 저장
2. **2차**: 외부 API 호출에 재시도 로직 (지수 백오프, 최대 3회)
3. **3차**: 최종 실패 시 Discord 즉시 알림

## 📅 구축 로드맵

- **Phase 1 (3~5일)**: 톡톡 메시지 자동 분류 + Sheets 업데이트 MVP
- **Phase 2 (1~2일)**: 일일 알림 자동 점검
- **Phase 3 (2~4주)**: 운영 안정화, 분류 프롬프트 튜닝
- **Phase 4 (선택)**: 자동 답신, 사진 자동 정리, 매출 대시보드 등

## 🔗 관련 문서

- 요구사항 명세서 (별도)
- Day 0 사전 준비물 가이드 (별도)
- Day 1 환경 세팅 가이드 (별도)

## 📝 라이선스

비공개 프로젝트

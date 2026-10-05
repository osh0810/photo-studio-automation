# 예약번호 기준 예약확정 발송

현재 구성: TypeScript Cloudflare Worker + D1 웹앱. 구형 `/admin/send-talk`는 Sheets 갱신을 포함하며, 웹앱 예약은 D1을 사용한다. 이번 발송은 구형 엔드포인트와 같은 `sendNaverTalkMessage` 전송 함수를 재사용하고, Sheets에 새 고객을 만드는 대신 기존 D1 고객 구조를 사용한다.

`email-parser` / `email-processor`가 저장한 `bookings.booking_id`로 조회한다. 이름으로 talkId를 추정하지 않는다. 최초 연결은 예약 상세 화면의 전체 이름을 읽고 그 예약의 톡톡 버튼에서 대화를 열어 기존 `buildConfirmMessage` 문구를 보낸다. 이후 webhook의 `echo-matcher`가 예약번호와 전체 이름을 파싱하여 `bookings.talk_id`, `customers.talk_id`와 이름을 저장한다. 이미 실제 talkId가 있는 예약은 브라우저 없이 API로 발송한다. 새 예약에 talkId가 없으면 기존 고객과 이름이 같아도 최초 연결 절차를 거친다.

## 설치와 화면 설정

DB 마이그레이션 `0025_booking_confirmation_sends.sql`, `0026_booking_confirmation_jobs.sql`을 적용해야 한다. 운영 DB에 두 마이그레이션을 적용하고 Worker 배포를 완료했다.

로컬 브라우저 실행기는 Node.js와 Playwright가 필요하다. 프로젝트에서 `npm install --no-save playwright`로 설치할 수 있다. 기본 브라우저는 Windows Edge다. 별도 전용 프로필에서 처음 한 번 네이버 로그인을 완료해야 한다.

`scripts/booking-browser.example.json`을 로컬 설정 파일로 복사한다. 사업장 745146의 실제 화면에서 예약번호, 전체 이름, 톡톡 버튼, 메시지 입력란, 전송 버튼, 발신 메시지 선택자를 확인하여 예시에 반영했다. 예약 1371185774의 전체 이름은 정상 조회했고, 톡톡 대화의 예약 상세 링크도 같은 번호와 일치했다. 이 예약은 이미 확정문자가 발송되어 있으므로 실발송 테스트에 재사용하지 않는다.

예약 화면이 새 창을 열면 `conversationMode=popup`, 같은 페이지에서 열면 `same-page`를 사용한다. iframe 대화는 현재 지원하지 않는다. 빈 selector는 실행을 차단한다. 선택자가 변경되면 실제 화면을 다시 검사해야 한다. 로컬 Playwright의 전용 로그인 프로필 및 실제 예약·톡톡 팝업 연결을 발송 없이 검증했다. Codex 내부 브라우저의 별도 팝업은 도구 목록에 나타나지 않아, 일반 톡톡 상담 탭에서 입력란과 메시지를 확인했다.

로그인 프로필과 설정 파일은 Git에 넣지 않는다. 기본 `scripts/output/`는 기존 gitignore로 제외된다. 토큰은 환경변수로 제공하며 코드/설정 파일에 넣지 않는다.

## 실행

PowerShell에서 `STUDIO_API_BASE`, `ADMIN_TOKEN` 환경변수를 설정한 뒤:

```powershell
# 조회 및 브라우저 대화 열기. 발송/DB 변경 없음.
node scripts/confirm-booking.mjs 1234567890 --config=scripts/output/booking-browser.json
# 실제 발송. 최초 고객은 브라우저, 저장된 talkId는 API.
node scripts/confirm-booking.mjs 1234567890 --config=scripts/output/booking-browser.json --send
```

예약 상세 URL은 기존 calendar-event-builder의 `/bizes/{bizId}/booking-list-view/bookings/{bookingId}` 구조를 재사용한다. CLI가 전체 이름을 전달하면 서버가 기존 상품/촬영일시로 메시지를 생성한다. dry run은 화면 이름만 출력하고 메시지 생성용 POST나 발송을 하지 않는다.

## API와 중복 방지

`GET /admin/booking-confirmation?booking_id=...`: 발송 경로, 메시지, 상태 조회.

`POST /admin/booking-confirmation`: `{action: "start", booking_id, full_name?}`. 최초 고객은 화면에서 읽은 `full_name` 필수. API 경로는 직접 발송하고, 브라우저 경로는 메시지와 attempt_id를 반환한다. 브라우저 발송 후 `{action: "complete", booking_id, attempt_id, status: "sent" | "uncertain"}`로 결과를 기록한다. 기존 `/admin/send-talk`와 동일하게 Authorization에 ADMIN_TOKEN 원문을 사용한다.

예약별로 한 번만 claim한다. 이미 발송했거나 `sending`/`uncertain` 상태면 409를 반환한다. timeout 후 자동 재시도하지 않는다. 불확실한 발송은 네이버 대화와 webhook 기록을 사람이 확인한 뒤 처리해야 하며, 자동 해제 API는 제공하지 않는다. D1에 보관된 실제 echo 이력에서 같은 예약번호의 확정문자를 발견하면 기존 수동 발송도 `already_sent`로 차단한다. echo가 없는 과거 발송은 실제 대화를 먼저 확인해야 한다. 메일 cron은 안내 카드만 만들며, 사용자 승인 없이 발송하지 않는다.

브라우저 경로에서는 대화 안의 예약 상세 링크에 사업장 ID와 예약번호가 정확히 일치해야 한다. 발신 메시지에 같은 예약번호의 확정 문구가 이미 있으면 `already_sent`로 건너뛰며, start/complete API도 호출하지 않는다. 저장된 talkId를 사용하는 API 경로에서는 보관된 echo 이력을 검사한다.

최초 브라우저 발송 성공 직후 talkId는 아직 없을 수 있다. webhook echo 수신을 확인한 이후 API 경로를 사용할 수 있다. echo-matcher의 기존 talkId 충돌 방어를 유지한다.

## 비서에서 확인 버튼으로 발송

1. 새 예약 메일이 처리되면 기존 비서 채팅의 예약확정 카드에 **확인 후 두 메시지 발송** 버튼이 표시된다.
2. 버튼을 누르면 최신 예약 상품과 촬영일시로 만든 예약확정 문구, 상품의 기존 `additional_question_text`를 미리 보여준다. **닫기**는 발송/승인하지 않는다.
3. **확인 · 발송**을 누르면 서버에서 취소 여부, 상품 매칭, 기존 발송/승인을 다시 검사한다. 로그인 세션 및 같은 출처의 POST만 허용한다. ADMIN_TOKEN은 브라우저에 전달하지 않는다.
4. 실제 talkId가 저장된 예약은 공유 톡톡 API로 확정문자 → 추가 질문 순서로 즉시 발송한다. 질문이 없는 상품은 확정문자만 보낸다.
5. talkId가 없는 예약은 승인 대기열에 들어간다. 아래 PC 실행기가 승인 건만 원자적으로 가져가 예약 화면 전체 이름 확인 → 해당 예약의 톡톡 대화 검증 → 두 메시지 발송 → echo 저장 흐름을 처리한다.

```powershell
# 환경변수 ADMIN_TOKEN, STUDIO_API_BASE와 전용 로그인 프로필 설정 후 실행
node scripts/watch-booking-confirmations.mjs --config=scripts/output/booking-browser.json
```

PC 실행기는 실행한 동안 15초마다 승인 건을 확인한다. PC가 꺼져 있거나 실행기가 없으면 카드가 **승인 완료 · PC 실행기 연결 대기**로 남는다. 자동 시작/Windows 서비스 등록은 이번 변경에 포함하지 않았다. 로그인은 실행기의 별도 Edge 프로필에서 직접 완료한다. Playwright 1.63.0 설치와 전용 프로필의 예약·팝업 연결 확인을 완료했고, 현재 실행기가 운영 승인 건을 대기하고 있다.

실행 중 PC가 종료되면 `running`으로 남을 수 있다. 카드에는 오래 지속될 경우 대화를 확인하라는 안내가 나온다. 자동으로 대기열에 돌려보내지 않는다. 두 번째 질문만 실패해도 전체 건을 `uncertain`으로 기록하여 첫 번째 확정문자를 다시 보내지 않는다. 미매칭/삭제된 상품 및 취소 예약은 발송을 차단한다.

운영 적용 순서: 변경 파일 검토 → D1 0025/0026 적용 → Worker 배포 → PC Playwright/설정/로그인 준비 → 실행기 시작 → 새 테스트 예약으로 비서 승인 실발송 확인. 이전에 실발송한 예약 1371251146은 echo에 전체 이름 **김용욱**과 talkId가 저장되어 있으므로 새 코드가 중복 발송을 차단해야 한다.

## 검증 결과

이번 변경은 D1 통합 테스트 13개와 실행기 테스트 10개, TypeScript 검사에 통과했다. 로컬 UI fixture에서 미리보기, 닫기, 승인 대기 표시를 브라우저로 확인했다. 이 UI 검증은 실제 고객에게 발송하지 않는다. 운영 배포 및 로컬 Playwright의 실제 예약·톡톡 팝업 연결 확인을 완료했다. 새 고객에 대한 승인 버튼부터 실제 두 메시지 발송까지의 종합 검증은 아직 진행하지 않았다.

```powershell
node --test test/confirmation-runner.test.mjs
node node_modules/vitest/vitest.mjs run --config vitest.confirmation.config.mts
node node_modules/typescript/bin/tsc --noEmit
```

전용 Vitest 설정은 Windows sqlite-shm 격리 오류를 피하고 각 테스트가 로컬 D1 행을 명시적으로 정리한다. 실제 고객/API 발송은 mock으로 대체한다.

## 운영 적용 완료 (2026-10-06)

운영 DB에 0025/0026 적용, Worker 버전 c22ecfbf-36d5-4a01-8eb5-4e64bc67bb76 배포 완료. 공식 Playwright 1.63.0을 별도 PC 실행기 폴더에 설치했다. 전용 Edge 프로필에서 예약 상세/톡톡 팝업 연결을 발송 없이 확인했고, 실행기는 운영 승인 대기열을 15초마다 확인하고 있다. PC 재시작 시 outputs의 예약실행기-시작.cmd를 실행한다. Windows 자동 시작 등록은 하지 않았다. 운영 배포 당시에는 커밋/푸시하지 않았다.

---
kind: decision
status: active
canonical: mydocs/plans/2026-10-28-calendar-works-sync.md
last_verified: 2026-10-28
---

# 캘린더 — 웍스 일정을 들여와 옴니스 날짜 데이터와 함께 보여 준다

상태: 2026-10-28 작업지시자가 막혀 있던 둘을 정했다.
- **계정**: 정우창 개인 계정(`jwoochang`)의 앱 비밀번호를 쓴다
- **범위**: 캘린더 3개 — `Hadd Science` · `대표님 일정` · `바이오아이코어 2026`
- 아직 승인받지 않은 것: 이 계획 자체. **승인 뒤 1단계를 시작한다.**
- PR 까지만 한다. 머지는 작업지시자가 한다.

설계의 권위 문서는 [`../tech/calendar.md`](../tech/calendar.md) 다. 왜 CalDAV 인지,
무엇이 실측으로 확인됐는지는 거기 있고 여기 옮기지 않는다.

## 왜

옴니스에 날짜를 가진 데이터가 여덟 모델에 흩어져 있는데 한 화면에서 볼 곳이 없다
(업무 마감 · 프로젝트 기간 · 주간보고 · 연혁 · 견적 · 샘플 · 출고 · 세금계산서).
회사 행사와 미팅은 아예 옴니스 밖, 웍스 캘린더에만 있다.

## 범위

**이 계획에 들어가는 것** — 웍스 → 옴니스 읽기와 캘린더 화면.

**들어가지 않는 것**

| 빠진 것 | 왜 |
|---|---|
| 폰으로 내보내는 ICS 구독 피드 | 반대 방향이고 혼자 선다. 별도 계획서로 ([`../tech/calendar.md`](../tech/calendar.md) 1.3) |
| 옴니스 → 웍스 쓰기 (HTTP Calendar API) | 미러를 수정 불가로 띄우면 충돌이 없다. 필요해지면 그때 |
| 옴니스 일정을 새로 만드는 기능 | 캘린더는 읽는 화면으로 시작한다 |

## 자격증명 — 정한 것과 그 대가

개인 계정 앱 비밀번호를 쓴다. 대가를 적어 둔다.

- 이 앱 비밀번호는 키체인에 `service=works-imap` 으로 있고 **IMAP 도 함께 열린다.**
  운영 환경변수에 넣으면 옴니스 서버가 회사 메일을 읽을 수 있는 열쇠를 갖는다.
- 비밀번호를 바꾸면 **동기화가 조용히 멈춘다.** 그래서 2단계에 인증 실패를 구분해
  기록하는 것을 넣는다.
- 동기화 범위는 「이 계정이 구독한 캘린더」다. 계정에서 캘린더를 빼면 옴니스에서도 사라진다.

후속 과제로 **전용 계정 교체**를 남긴다. 서비스 계정이 CalDAV Basic 인증에 쓰일 수 있는지는
확인되지 않았다 — 안 되면 캘린더만 구독한 전용 구성원 계정을 만든다.

`CALDAV_*` 환경변수는 **서버 전용**이다. 클라이언트가 CalDAV 에 직접 붙는 경로를 만들지 않는다.

## 단계

### 1단계 — 스키마

`ExternalCalendarEvent` 와 커서 테이블 하나. 칸 구성은
[`../tech/calendar.md`](../tech/calendar.md) 3.2 그대로.

- `(provider, externalCalendarId, externalId, recurrenceId)` 유니크 —
  **마스터와 예외 회차가 UID 를 공유**하므로 `recurrenceId` 가 키에 들어가야 한다
- `CalendarSyncState`: `externalCalendarId` · `displayName` · `ctag` · `syncToken` · `syncedAt` · `lastError`
- `calendarId` 를 코드에 박지 않는다. 캘린더는 PROPFIND 로 찾고, **표시 이름으로 걸러**
  `CALDAV_CALENDARS="Hadd Science,대표님 일정,바이오아이코어 2026"` 와 맞춘다.
  웍스에서 캘린더를 다시 만들면 id 가 바뀌지만 이름은 유지된다

마이그레이션은 이 브랜치의 워크트리에서 돌린다 — `main` 체크아웃의 `up to date` 는
거짓말일 수 있다. 운영 반영은 머지 전에 한다.

**게이트**: `pnpm run verify` 통과. 로컬 스냅샷에 마이그레이션 적용 확인.

### 2단계 — CalDAV 클라이언트와 파서

`lib/caldav/` 에 둔다. 외부 요청이라 테스트는 **저장해 둔 실제 응답**으로 돈다
(10/27 탐침 산출물을 픽스처로 옮긴다 — 회사 일정 내용은 지어낸 것으로 바꿔 넣는다).

- `discoverCalendars()` — PROPFIND Depth:1 로 href·displayName·ctag
- `syncCalendar(state)` — ctag 가 같으면 **요청 0건으로 끝낸다**. 다르면 `sync-collection`
- `fetchEvents(hrefs)` — `calendar-multiget`, 100개 묶음
- `parseICalendar(text)` — 한 리소스에 VEVENT 여러 개. 마스터와 `RECURRENCE-ID` 를 나눈다.
  `RRULE`·`EXDATE` 는 **문자열로 보관**하고 펼치지 않는다

실측에서 나온 함정을 그대로 코드 주석과 테스트로 박는다.

| 함정 | 대응 |
|---|---|
| 토큰이 초 단위 | 받은 토큰에서 **3초 되돌려** 저장. 중복은 upsert 로 흘린다 |
| 상한 토큰에 오류를 주지 않고 전체를 준다 | 응답 건수가 전체 크기로 튀면 `lastError` 에 기록. 깨지지는 않지만 알아야 한다 |
| `calendar-query` 가 `calendar-data` 를 무시 | 본문은 반드시 multiget 으로. 테스트로 고정 |
| `C:expand` 를 무시 | 보내지 않는다 |
| 깨진 `time-range` 에 500 | 날짜 포맷을 만드는 곳을 한 군데로 모은다 |
| 삭제는 `404` propstat | `deletedAt` 으로 가린다. 행을 지우지 않는다 |

**게이트**: 픽스처 테스트. 그리고 **읽기 전용으로** 실제 서버에 한 번 돌려
캘린더 3개가 붙고 두 번째 호출이 요청 1건으로 끝나는 것을 확인한다.

### 3단계 — 동기화 라우트와 호출 시점

`POST /api/calendar/sync` — 서버에서만 돈다.

- 마지막 동기화가 60초보다 오래됐을 때만 실제로 당긴다. 아니면 즉시 반환
- 캘린더 화면을 열 때·주/월을 넘길 때 호출. 폴링은 `hooks/use-visible-interval` **60초**,
  캘린더 화면에 있을 때만
- `setInterval` 직접 금지, 숨긴 탭에서 돌리지 않기 — [`../tech/request-budget.md`](../tech/request-budget.md)

Vercel Hobby 크론은 하루 1회라 바닥 역할을 못 한다. **아무도 안 볼 때의 동기화는 이 단계에
넣지 않는다** — 알림이 필요해지면 그때 외부 스케줄러를 붙인다.

**게이트**: 요청 수 실측. 아무 변경이 없는 주기가 외부 요청 1건으로 끝나는지 센다.

### 4단계 — 읽기 모델

`from`~`until` 창을 받아 하나의 `CalendarItem[]` 을 돌려주는 함수 하나.

- 파생 층 어댑터 여덟 개 ([`../tech/calendar.md`](../tech/calendar.md) 3.1) + 미러 UNION
- **RRULE 전개를 여기서** 한다. 창에 맞춰 펼치고 `EXDATE` 를 빼고 `RECURRENCE-ID` 로 덮어쓴다.
  펼친 결과를 저장하지 않는다
- 종일/시간 일정과 `Asia/Seoul` 을 구분해 담는다

**게이트**: 전개 단위테스트 — 주간 반복 · `UNTIL` 경계 · `EXDATE` 한 회차 제거 ·
`RECURRENCE-ID` 로 시간이 옮겨진 회차. 네 경우를 10/27 에 실제로 본 구조대로 쓴다.

### 5단계 — 화면

`app/(main)/calendar`. 월 뷰부터, 출처별 색, 미러는 수정 불가 표시.

- 규칙은 [`../manual/ux-rules.md`](../manual/ux-rules.md). 좁은 뷰포트 함정은
  [`../troubleshootings/narrow-viewport-traps.md`](../troubleshootings/narrow-viewport-traps.md)
- 일정에서 원본(업무·견적·기관)으로 가는 링크. 웍스 일정은 링크 없이 보여 준다
- 출처별로 켜고 끄기

**게이트**: `pnpm run verify` · 좁은 뷰포트 확인 · 월 전환이 추가 외부 요청을 만들지 않는지

## 되돌리는 법

1~2단계는 테이블과 `lib/` 추가뿐이라 화면에 영향이 없다. 3단계 이후 문제가 생기면
`CALDAV_CALENDARS` 를 비워 동기화를 끄면 파생 층만 남은 캘린더로 돌아간다 —
화면이 죽지 않는다.

## 남은 결정 (구현 중에 정해도 늦지 않다)

- 월 뷰 외에 주·목록 뷰를 넣을지
- 미러 일정의 참석자를 어디까지 보여 줄지. 이름을 옴니스 `User` 에 못 붙인 사람 처리
- 동기화 창(과거 몇 달·미래 몇 달). `sync-collection` 이 묘비를 주므로 창을 좁혀도
  삭제를 놓치지 않는다

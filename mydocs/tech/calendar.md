---
kind: canonical
status: active
canonical: mydocs/tech/calendar.md
last_verified: 2026-10-27
---

# 캘린더 — 옴니스 날짜 데이터 집계와 네이버 웍스 동기화

옴니스에 캘린더를 붙이기 전에 읽는다. 담을 것은 **하나의 새 스키마가 아니라**
이미 옴니스 안에 흩어져 있는 날짜 데이터의 집계 뷰이고, 여기에 회사 행사·미팅을
네이버 웍스에서 끌어온다.

웍스 쪽 사실은 **2026-10-27 에 실제로 요청을 보내 확인한 것**이다. 응답 코드와 건수는
문서 끝 「실측 기록」에 있다. 조사만 하고 못 돌려본 것은 그렇게 적었다.

## 결론 — 어느 길로 가는가

| 무엇 | 결정 | 근거 |
|---|---|---|
| 웍스 → 옴니스 읽기 | **CalDAV** | 증분 동기화(`sync-collection`)가 실제로 된다. HTTP Calendar API 에는 없다 |
| 변경 감지 | **`getctag` 먼저, 바뀐 캘린더만 `sync-collection`** | 캘린더 홈 PROPFIND 한 번(요청 1건)으로 5개 캘린더의 ctag 를 다 본다 |
| 일정 본문 | **`calendar-multiget`** | `calendar-query` 는 `calendar-data` 를 요청해도 etag 만 준다 |
| 옴니스 → 웍스 쓰기 | **CalDAV 아님.** HTTP Calendar API 또는 ICS 구독 | 웍스 CalDAV 는 읽기 전용이다 (`allow: OPTIONS, PROPFIND, REPORT`) |
| 반복 일정 | **우리가 펼친다** | 서버는 마스터+RRULE 로만 주고 `C:expand` 를 무시한다 |
| 지연 | **열람 시 갱신이 주력, 스케줄은 보조** | Vercel Hobby 의 크론은 하루 1회다 — 분 단위 크론이 없다 |
| 옴니스 스키마 | **새 테이블은 하나(`ExternalCalendarEvent`)** | 나머지는 기존 모델의 날짜 칸을 읽는 파생 층 |

## 1. 웍스에서 데이터를 꺼내는 세 가지 길

### 1.1 HTTP Calendar API — 증분이 없다

2026-09-22 에 공식 문서로 확인한 것(요청은 보내지 않았다):

- `GET /v1.0/users/{userId}/calendar/events`, scope `calendar` 또는 `calendar.read`
- 조회 파라미터는 `fromDateTime`·`untilDateTime` **뿐**이다. `syncToken`·`updatedSince` 가 없다
- 캘린더 변경을 알려 주는 **웹훅이 없다.** 봇 콜백은 메시지 전용이다
- 레이트리밋은 요금제별 — 무료 60 req/min, Lite/Standard 이상 240 req/min, 동시 요청 5건
- 서비스 계정 JWT(RS256) 로 인증하면 서버에서 전 구성원 캘린더를 읽을 수 있다

읽기에는 CalDAV 가 낫다. **쓰기는 이 API 밖에 없다** — 아래 1.2 참조.

### 1.2 CalDAV — 증분 동기화가 된다 (실측)

```
호스트     caldav.worksmobile.com
principal  /rl/{테넌트}/principals/users/{웍스 내부 userId}/
캘린더 홈  /rl/{테넌트}/caldav/{웍스 내부 userId}/calendar/
캘린더     위 경로 + /{calendarId}/
일정       위 경로 + /{UID}.ics
```

테넌트 번호와 내부 userId 는 사람마다 다르다. **경로를 박지 않고 PROPFIND 로 찾는다.**
10/22·10/27 탐침은 개인 계정 앱 비밀번호로 Basic 인증했다 — 키체인 항목
`service=works-imap`, `account=<회사 메일>`. 운영에 붙일 때 이 개인 자격증명을 쓰면 안 된다
([4장](#4-승인-전인-것과-남은-확인)).

#### 쓰기는 막혀 있다

`OPTIONS` 응답의 `allow` 가 **`OPTIONS, PROPFIND, REPORT`** 세 개다. `PUT`·`DELETE`·`MKCALENDAR`
가 없고 `DAV:` 헤더도 돌아오지 않는다. 즉 **웍스 CalDAV 는 읽기 전용 창구**다.
일정 일부에 `D:write-content` 권한이 보이지만 메서드 자체가 없다.

> 옴니스에서 만든 일정을 웍스에 밀어 넣으려면 HTTP Calendar API(POST)나
> ICS 구독(1.3) 을 쓴다. CalDAV 로는 안 된다.

컴포넌트는 **`VEVENT` 뿐**이다(`supported-calendar-component-set`). `VTODO` 가 없으니
옴니스의 업무는 웍스 캘린더에 올라갈 자리가 애초에 없다 — 업무는 옴니스가 원본으로 갖는다.

#### 변경 감지 — `getctag` 가 쓸 것, `sync-token` 은 서버 시계

캘린더 홈에 `PROPFIND Depth: 1` 한 번이면 캘린더 5개의 두 값을 다 받는다.

| 속성 | 실측 | 뜻 |
|---|---|---|
| `CS:getctag` | 캘린더마다 **다른** 값. `2026-10-20 17:26:02` / `2026-10-27 15:46:13` … | 컬렉션의 마지막 변경 시각. **이것이 변경 감지용이다** |
| `D:sync-token` | 5개 캘린더가 **전부 같은** 값, 호출할 때마다 바뀜 (`2026-10-27 17:20:17`) | 컬렉션 상태가 아니라 **서버의 현재 시계**다 |

둘 다 불투명 문자열이 아니라 `YYYY-MM-DD HH:MM:SS` 평문이다. `getetag` 도 같은 꼴
(`"2026-08-05 13:17:13"`).

캘린더 홈 자신은 캘린더가 아니다 — `resourcetype` 이 `D:collection` 뿐이고
`displayname`·`getctag`·`supported-calendar-component-set` 이 `404` propstat 으로 온다.

#### `sync-collection` 실측

`supported-report-set` 에 `D:sync-collection`·`C:calendar-query`·`C:calendar-multiget` 세 개가
광고되고, 실제로 동작한다.

| 보낸 `sync-token` | 응답 | 받은 것 |
|---|---|---|
| 빈 값 (초기) | 207 | 9건 — 현재 5건(`201 Created`) + 묘비 4건(`404 Not Found`) |
| 방금 받은 토큰 | 207 | **0건.** 델타가 정확하다 |
| 임의 과거 시각 `2026-10-01 00:00:00` | 207 | 3건 (`201`×2, `404`×1) |
| 쓰레기 문자열 | 207 | **9건 — 전체 재동기화** |

읽어야 할 것 넷:

1. **토큰이 평문 시각이라 임의 과거 시점을 넣어도 받아 준다.** 토큰을 잃어도 커서를 직접 만들 수 있다.
2. **삭제는 `404` propstat 으로 온다.** 묘비가 있으니 창 전체를 매번 다시 받아 대조할 필요가 없다.
3. **잘못된 토큰에 `DAV:valid-sync-token` 오류를 주지 않는다.** 그냥 조용히 전체를 준다 —
   토큰이 상해도 깨지지는 않지만, 상했다는 **신호도 없다**. 응답 건수가 갑자기 전체 크기로
   튀면 그게 유일한 단서다.
4. **초 단위다.** 같은 초에 두 건이 바뀌고 그 사이 토큰을 저장하면 한 건을 놓친다.
   받은 토큰에서 **2~3초 되돌려** 저장하고, 중복 수신은 upsert 로 흘린다.

캘린더 홈에 `sync-collection` 을 보내면 `sync-level` 을 `1` 로 주든 `infinite` 로 주든
**`404`, 빈 본문**이다. **캘린더마다 따로 보내야 한다** — 한 주기에 5건.

#### 본문 받기 — `calendar-query` 는 etag 만 준다

`calendar-query` 에 `<C:calendar-data/>` 를 넣어도 응답에는 `D:getetag` 만 있다.
오류도 `404` propstat 도 없이 **조용히 빠진다**. 그래서 두 단계다.

```
1단계  calendar-query (time-range)  또는  sync-collection   → href + etag
2단계  calendar-multiget (href 묶음)                        → iCalendar 본문
```

`calendar-multiget` 은 `calendar-data` 를 제대로 준다. href 100개 묶음으로 보내 동작을 확인했다
(캘린더 4개·일정 809건을 11번에 나눠 받음).

`time-range` 필터는 정상이다 — 같은 캘린더에서 2026년 창은 739건 중 296건만 돌려준다.
다만 **`time-range` 값이 잘못되면 `400` 이 아니라 `500`** 이다.

#### 반복 일정

| 질문 | 답 |
|---|---|
| 마스터+RRULE 로 오는가, 펼쳐져 오는가 | **마스터+RRULE.** 인스턴스별 리소스가 생기지 않는다 |
| `C:expand` 를 주면 서버가 펼쳐 주는가 | **아니다.** 207 을 주지만 응답이 그대로다 — RRULE 이 남아 있고 DTSTART 가 1개다. 조용히 무시한다 |
| 예외 인스턴스는 어디 있는가 | **같은 `.ics` 리소스 안**에 두 번째 `VEVENT` 로. 마스터에 `EXDATE`, 예외에 `RECURRENCE-ID` |
| `time-range` 가 반복 인스턴스로 매칭하는가 | **된다.** 마스터 DTSTART 가 창 밖이고 인스턴스만 창 안이어도 잡히고, `UNTIL` 이후 창에서는 안 잡힌다 |
| `EXDATE` 를 매칭에 반영하는가 | **아니다.** 그 창의 유일한 인스턴스가 `EXDATE` 로 빠졌는데도 잡혔다 |

**RRULE 전개는 우리 몫이다.** 한 리소스가 마스터와 예외를 함께 담으므로, 파서는
"리소스 1개 = VEVENT 1개" 를 가정하면 안 된다. 예시(실제 일정이 아니라 지어낸 것):

```
BEGIN:VEVENT                                  ← 마스터
UID:example-1234@works
DTSTART;TZID=Asia/Seoul:20260912T090000
RRULE:FREQ=WEEKLY;UNTIL=20261226T000000Z;INTERVAL=1;BYDAY=SA
EXDATE;TZID=Asia/Seoul:20261017T090000        ← 이 회차는 삭제됨
END:VEVENT
BEGIN:VEVENT                                  ← 같은 리소스 안의 예외 회차
UID:example-1234@works
RECURRENCE-ID;TZID=Asia/Seoul:20261121T090000
DTSTART;TZID=Asia/Seoul:20261121T113000       ← 시간만 옮겨진 회차
END:VEVENT
```

시각은 거의 다 `DTSTART;TZID=Asia/Seoul` 이고, 리소스의 약 70% 가 `VTIMEZONE` 블록을
함께 싣는다. `X-NAVER-REGISTERER`·`X-NAVER-LAST-MODIFIER`·`X-NAVER-CATEGORY-ID`·
`X-ATTENDEE-EDIT-SCOPE` 같은 네이버 확장이 붙어 온다 — 등록자·최종수정자를 옴니스 사용자에
붙일 때 쓸 수 있다.

#### 레이트리밋

탐침 56건 동안 `429` 가 없었고 `rateLimit-*` 헤더도 **붙지 않았다**. CalDAV 는 HTTP API
게이트웨이의 한도(1.1)와 다른 경로로 보인다. 한도를 모르는 것이지 없는 것은 아니니
주기는 아래 2장의 계층으로 눌러 둔다.

### 1.3 ICS 구독 피드 — 내보내기 쪽

웍스 캘린더는 **외부 iCal URL 구독**을 지원한다(캘린더 추가 → 외부 캘린더 구독). 반대로
웍스 캘린더를 외부에 공개하는 iCal URL 도 낼 수 있다. CalDAV 가 읽기 전용이므로,
**옴니스 → 웍스** 로 보여 주는 길은 이 구독 피드와 HTTP Calendar API 두 개뿐이다.

구독 피드는 당겨 가는 쪽 주기를 우리가 못 정한다 — 캐시 뒤에 있어 반영이 수 분~수 시간이다.
그래서 **실시간이 필요한 방향에는 쓰지 않는다.** 읽기 전용 미러를 보여 주는 데는 맞다.

> **2026-09-23 에 ICS 구독 피드를 어떻게 쓰기로 정했는지는 이 저장소에 기록이 없다.**
> 그 결정은 다른 세션의 대화에만 있다. 확인한 뒤 이 절을 채운다.

## 2. 동기화 설계

### 2.1 폴링 계층 — 바뀌지 않았으면 요청 1건

```
① 캘린더 홈 PROPFIND Depth:1          요청 1건   → 캘린더 5개의 getctag
② ctag 가 바뀐 캘린더만 sync-collection  요청 0~5건 → 바뀐 href + 묘비
③ 추가·수정된 href 만 calendar-multiget  요청 0~n건 → iCalendar 본문
```

아무 일도 없던 주기는 **요청 1건으로 끝난다.** 전체 창을 매번 다시 받는 설계와 비교가 안 된다.
`sync-collection` 이 묘비를 주므로 삭제 감지에 창 경계를 고정할 필요도 없다.

### 2.2 지연 예산 — Vercel Hobby 에 분 단위 크론이 없다

[`request-budget.md`](request-budget.md) 의 제약이 그대로 걸린다. 무료 팀의 Edge Requests 는
월 100만 건이고 **팀 안의 모든 프로젝트가 같이 쓴다.** 2026-09-15 에 실제로 한도에 닿아
프로젝트가 멈췄다. 게다가 **Hobby 요금제의 크론은 하루 1회**가 상한이다.

그래서 지연은 이렇게 만든다.

| 계층 | 주기 | 비용 | 쓰임 |
|---|---|---|---|
| **열람 시 갱신** | 캘린더 화면을 열거나 주/월을 넘길 때, 마지막 동기화가 60초보다 오래됐으면 그 자리에서 ①~③ | 보는 사람 수에 비례. 아무도 안 보면 0 | 주력 |
| 보이는 탭 폴링 | `useVisibleInterval` 60초 — 캘린더 화면에 있을 때만 | 탭당 시간당 60건 | 화면을 열어 둔 사람 |
| 외부 스케줄러 | 사내 NAS 또는 GitHub Actions 크론 → 옴니스 API 를 때림 | Vercel 크론 제약을 비켜 간다 | 아무도 안 볼 때의 바닥. 알림·마감 임박에 필요 |
| Vercel 크론 | 하루 1회 | — | 요금제를 올리지 않는 한 바닥 역할을 못 한다 |

**새 폴링은 반드시 `hooks/use-visible-interval` 로 넣는다.** 숨긴 탭에서 도는 폴링이
9/15 사고의 33% 였다. 간격은 "사람이 몇 초 늦게 알아도 되는가" 로 정한다 — 캘린더는
알림 벨(15초)보다 느려도 된다.

외부 자격증명으로 외부 호스트를 때리는 일이니 **동기화 라우트는 함수 안에서만 돌고
클라이언트가 직접 CalDAV 에 붙지 않는다.** 앱 비밀번호가 브라우저로 나가면 안 된다.

### 2.3 쓰기 방향 — 유형별로 원본을 정한다

양방향 실시간을 맞추려 하면 비용이 두 배가 되고 충돌 해소가 생긴다. 유형마다 한쪽만 원본으로 둔다.

| 데이터 | 원본 | 반대쪽 |
|---|---|---|
| 업무·프로젝트·주간보고·CRM 일자 | **옴니스** | 웍스에 올리지 않는다. CalDAV 가 `VEVENT` 만 받고, 올려도 읽기 전용이라 되돌아오지 않는다 |
| 회사 행사·미팅 | **웍스** | 옴니스는 미러만 갖는다(`ExternalCalendarEvent`). 화면에서 수정 불가로 보여 준다 |
| 옴니스에서 만든 미팅 | 정하지 않았다 | HTTP Calendar API 로 밀어 넣으면 즉시 반영된다. 승인 전 |

미러를 "수정 불가" 로 두면 충돌이 아예 생기지 않는다. 먼저 이렇게 띄우고, 옴니스에서
웍스 일정을 고쳐야 할 이유가 실제로 생기면 그때 1.1 의 API 를 붙인다.

## 3. 옴니스 쪽 데이터 모델

날짜를 가진 모든 것을 한 테이블에 모으지 않는다. 층을 둘로 나눈다.

### 3.1 파생 층 — 새 테이블 없음

이미 날짜를 가진 모델을 공통 `CalendarItem` 모양으로 읽는 어댑터만 둔다. 집계 대상:

| 모델 | 칸 | 캘린더에서 |
|---|---|---|
| `Task` | `deadline` / `workStart`~`workEnd` | 마감 · 작업 기간 |
| `Project` | `startDate`~`deadline` | 기간 막대 |
| `WeeklyReport` | `weekStart`~`weekEnd`, `submittedAt` | 주간 경계 · 제출 |
| `CompanyRecord` | `startsOn`~`endsOn` | 연혁 · 수상 · 정부과제 |
| `CrmQuote` | `quotedAt`, `taxInvoicedAt` | 견적 · 세금계산서 |
| `CrmSampleRequest` | `requestedAt`, `sentAt` | 샘플 신청 · 발송 |
| `CrmShipment` · `CrmProduction` | `shippedAt` · `producedAt` | 출고 · 생산 |
| `TaxInvoice` · `CrmPayment` | `issuedOn` · `paidOn` | 발행 · 입금 |

조회는 창(`from`~`until`)을 받아 이 어댑터들과 3.2 를 **UNION 하는 read model 하나**로 둔다.
원본 모델에 칸을 더하지 않는다 — 캘린더는 읽는 쪽이다.

성능이 문제가 되면 그때 인덱스 테이블을 materialize 한다. 지금 규모(업무 수백 건대)에서는 필요 없다.

### 3.2 `ExternalCalendarEvent` — 새 테이블은 이것 하나

옴니스 안에 집이 없는 데이터, 즉 웍스에서 미러링한 일정만 담는다.

| 칸 | 왜 |
|---|---|
| `provider` · `externalCalendarId` · `externalId`(UID) | `(provider, externalCalendarId, externalId)` 유니크 |
| `href` · `etag` | `calendar-multiget` 재요청 키. etag 가 같으면 본문을 다시 받지 않는다 |
| `recurrenceId` | 예외 회차. 마스터와 같은 UID 를 갖기 때문에 UID 만으로는 유니크하지 않다 |
| `rrule` · `exdate` | 전개는 조회 시점에 한다. 펼친 결과를 저장하지 않는다 |
| `startAt` · `endAt` · `isAllDay` · `tzid` | `DTSTART;TZID=Asia/Seoul` 과 `VALUE=DATE` 를 구분해 담는다 |
| `sequence` · `lastModified` | 변경 판정 |
| `deletedAt` | `sync-collection` 의 `404` 묘비. 지우지 않고 가린다 |

캘린더별 커서는 따로 둔다 — `externalCalendarId` · `ctag` · `syncToken` · `syncedAt`.

**펼친 인스턴스를 테이블에 쌓지 않는다.** 무한 반복이 있으면 끝이 없고, 규칙이 바뀔 때마다
지우고 다시 넣어야 한다. 마스터만 저장하고 조회 창에 맞춰 그때 전개한다.

### 3.3 사용자 매핑

웍스 `ORGANIZER`·`ATTENDEE`·`X-NAVER-REGISTERER` 를 옴니스 `User` 에 붙일 때는
**회사 메일 주소로만** 대응시킨다. 웍스 내부 userId 를 `User` 의 정체성으로 삼지 않는다 —
[`auth-architecture.md`](auth-architecture.md) 가 네이버웍스를 인증 앵커로 두는 것을
기각했다. 대응표는 단순 참조이고, 못 붙은 참석자는 이름만 표시한다.

## 4. 승인 전인 것과 남은 확인

- **자격증명.** 탐침은 개인 계정 앱 비밀번호로 했다. 운영에 쓸 계정을 정해야 한다 —
  서비스 계정이 CalDAV Basic 인증에 쓰일 수 있는지 확인되지 않았다. 안 되면 전용 계정의
  앱 비밀번호를 쓰고, 그 계정이 어느 캘린더를 구독하는지가 곧 동기화 범위가 된다.
- **동기화 범위.** 탐침 계정에는 캘린더 5개·일정 809건이 보였고, 그중 둘에만
  `D:write-content` 가 있었다. 어느 캘린더를 옴니스에 들일지는 사람이 정한다.
- **옴니스 → 웍스 쓰기를 할지.** 2.3 의 마지막 줄. 하지 않으면 전체가 읽기 전용 미러로 끝나고 훨씬 싸다.
- **2026-09-23 의 ICS 구독 피드 결정** — 1.3 의 인용 박스.
- **스케줄러를 어디에 둘지** — 사내 NAS 인지 GitHub Actions 인지. Vercel Hobby 로는 안 된다.

스키마 변경과 외부 자격증명 투입이 들어가므로 [`AGENTS.md`](../../AGENTS.md) 의 타스크 사이클
2단계(계획서 → 승인)를 거친다. 이 문서는 그 계획서가 아니라 **그 앞의 확정 사실**이다.

## 5. 실측 기록 (2026-10-27)

읽기 메서드만 보냈다 — `OPTIONS`·`PROPFIND`·`REPORT`. 요청 56건, `429` 없음.

| 코드 | 건수 | 어디서 |
|---|---|---|
| 200 | 1 | `OPTIONS` 캘린더 홈 |
| 207 | 50 | `PROPFIND`, `REPORT` (`sync-collection`·`calendar-query`·`calendar-multiget`) |
| 404 | 2 | 캘린더 홈에 보낸 `sync-collection` (`sync-level` 1·infinite 둘 다, 빈 본문) |
| 500 | 3 | 형식이 깨진 `time-range` 값 |

| 확인한 것 | 결과 |
|---|---|
| `OPTIONS` 의 `allow` | `OPTIONS, PROPFIND, REPORT` — 쓰기 메서드 없음, `DAV:` 헤더 없음 |
| `PROPFIND Depth:1` 캘린더 홈 | 207. 평범한 컬렉션 1 + 캘린더 5 |
| `supported-report-set` | `sync-collection`, `calendar-query`, `calendar-multiget` |
| `supported-calendar-component-set` | `VEVENT` 만 |
| `getctag` | 캘린더마다 다른 평문 시각 — 변경 감지에 쓸 수 있다 |
| `sync-token` | 캘린더 5개가 동일, 호출마다 변함 — 서버 시계다 |
| `sync-collection` 빈 토큰 | 207, 9건 (현재 5 `201` + 묘비 4 `404`) |
| `sync-collection` 방금 받은 토큰 | 207, **0건** |
| `sync-collection` 과거 시각 | 207, 3건 |
| `sync-collection` 쓰레기 토큰 | 207, 9건 — 오류 없이 전체 재동기화 |
| `calendar-query` + `calendar-data` | 207 이지만 `getetag` 만. 조용히 무시 |
| `calendar-multiget` + `calendar-data` | 207, 본문 정상. 809건을 100개 묶음 11번에 수신 |
| `time-range` 필터 | 유효. 739건 중 2026년 창 296건 |
| `time-range` 와 반복 | 인스턴스로 매칭됨. `UNTIL` 이후엔 안 잡힘. **`EXDATE` 는 반영 안 함** |
| `C:expand` | 207 이지만 결과가 그대로. 펼쳐 주지 않는다 |
| 반복 일정 구조 | 한 `.ics` 안에 마스터(`RRULE`+`EXDATE`) + 예외(`RECURRENCE-ID`) |

시험 스크립트와 원본 응답은 저장소 밖 scratchpad 에 뒀다 — 회사 일정 내용이 들어 있어
저장소에 넣지 않는다. 자격증명은 키체인에서 읽어 `curl -K -` 로 stdin 으로만 넘겼고
argv·파일·로그에 남기지 않았다.

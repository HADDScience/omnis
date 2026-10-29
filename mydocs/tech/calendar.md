---
kind: canonical
status: active
canonical: mydocs/tech/calendar.md
last_verified: 2026-10-29
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
| 옴니스 → 폰·외부 캘린더 | **개인 토큰이 든 ICS 구독 피드** (2026-09-23) | 폰 위젯을 만들지 않고 OS 기본 캘린더를 쓴다. 읽기 전용 · 갱신은 저쪽 주기 |
| 반복 일정 | **우리가 펼친다** | 서버는 마스터+RRULE 로만 주고 `C:expand` 를 무시한다 |
| 지연 | **열람 시 갱신이 주력, 스케줄은 보조** | Vercel Hobby 의 크론은 하루 1회다 — 분 단위 크론이 없다 |
| 옴니스 스키마 | **새 테이블은 웍스 미러 둘**(`ExternalCalendar` · `ExternalCalendarEvent`) | 나머지는 기존 모델의 날짜 칸을 읽는 파생 층 |

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

### 1.3 ICS 구독 피드 — 옴니스가 내보내는 쪽

ICS 구독은 **두 자리**에서 쓸 수 있고, 쓰려는 자리는 둘째다.

- 웍스 캘린더가 외부 iCal URL 을 구독할 수 있다(캘린더 추가 → 외부 캘린더 구독). CalDAV 가
  읽기 전용이므로 **옴니스 → 웍스** 로 보여 주는 길은 이것과 HTTP Calendar API 둘뿐이다.
- **옴니스가 ICS 피드를 내고 개인 기기가 구독한다.** 2026-09-23 에 정한 쪽이 이것이다.

#### 2026-09-23 결정 — 폰 위젯을 만들지 않고 피드를 낸다

> 출처는 세션 대화뿐이었다(`ace2c4d4`). 사용자에게 제안해 합의한 내용이고, 기록이 미정이어서
> 2026-10-27 에 여기로 옮겼다. **구현 승인은 아직이다.**

옴니스가 사람마다 **개인 토큰이 든 구독 주소**를 낸다.

```
webcal://…/calendar/<개인토큰>.ics
```

폰 캘린더에 한 번 구독해 두면 iOS·안드로이드 **기본 캘린더 위젯**과 PC(아웃룩·구글 캘린더)에
옴니스 일정이 뜬다. 전용 폰 위젯을 따로 만들지 않는다 — OS 가 이미 가진 것을 쓴다.

**한계는 설계가 아니라 규약에서 온다.**

| 한계 | 내용 |
|---|---|
| 읽기 전용 | 폰에서 고쳐도 옴니스로 돌아오지 않는다. 양방향은 우리가 CalDAV **서버**를 만들어야 해 범위 밖이다 |
| 갱신이 즉시가 아니다 | iOS 는 OS 주기를 따르고, 구글 캘린더는 외부 ICS 를 **수 시간~하루** 간격으로 당긴다. 우리가 정할 수 없다 |
| 급한 변경 | 피드가 아니라 **기존 웹 푸시**가 맡는다 ([`../plans/2026-09-22-web-push.md`](../plans/2026-09-22-web-push.md)) |

**주소가 곧 열쇠다.** 캘린더 앱은 로그인을 못 하므로 세션도 헤더도 못 쓴다. 그래서

- 토큰은 **사람마다** 따로 내고, 설정 화면에서 **재발급**하면 옛 주소를 즉시 무효화한다
- 잠금화면에 일정 제목이 그대로 보인다. **민감한 일정의 제목을 가리는 옵션**을 검토한다
  (제목을 「업무」 처럼 바꿔 내보내고 본문은 옴니스에서 보게 하는 식)
- 토큰이 든 주소는 로그·에러 리포트에 남지 않게 한다

**피드가 지켜야 할 조건** — 구독하는 쪽이 캐시하고 대조하기 때문에 하나라도 어기면 중복·누락이 난다.

| 조건 | 왜 |
|---|---|
| 일정마다 **바뀌지 않는 UID** | 매번 새 UID 를 내면 구독자는 지우고 다시 넣는다. 알림이 다시 울리고 중복이 보인다 |
| 종일/시간 일정 구분 | `DTSTART;VALUE=DATE` 와 `DTSTART;TZID=…` 를 구분해 낸다. 섞으면 종일 일정이 한 칸 밀린다 |
| 시간대 `Asia/Seoul` 명시 | `VTIMEZONE` 을 싣는다. 웍스가 보내는 것과 같은 꼴이다(1.2 참조) |
| 일정마다 옴니스로 돌아오는 링크 | `URL` 속성에 업무·일정 주소를 넣는다. 폰에서 눌러 원문으로 간다 |

**첫 단계는 `Task.deadline` 하나로 충분하다.** 「내 업무 마감」만 담은 피드를 먼저 붙이고,
3.1 의 나머지 파생 층과 웍스에서 들여온 일정은 **같은 피드에 더한다** — 구독자는 주소를
다시 등록하지 않는다. 피드를 여러 개로 쪼개면 사람마다 구독을 여러 번 해야 한다.

구독자가 당겨 가는 요청은 우리 쪽 Edge Requests 를 쓴다. 사람 수가 적고 주기가 길어
[`request-budget.md`](request-budget.md) 의 한도에서 문제가 되지 않지만, 토큰이 유출돼
외부에서 긁으면 이야기가 달라진다 — 재발급이 그 대응이다.

#### 세 방향이 어떻게 맞물리는가

| 방향 | 길 | 성격 |
|---|---|---|
| 웍스 → 옴니스 | **CalDAV 읽기** (`getctag` → `sync-collection` → `multiget`) | 증분. 분 단위까지 당길 수 있다 |
| 옴니스 → 폰·아웃룩·구글 | **ICS 구독 피드** (개인 토큰) | 읽기 전용, 갱신 주기는 저쪽이 정한다. 급한 건은 웹 푸시 |
| 옴니스 → 웍스 | **HTTP Calendar API** (POST) | CalDAV 로는 불가. 할지 말지 미정 (2.3) |

한 줄로: **웍스에서 읽어 오는 것은 CalDAV, 폰으로 내보내는 것은 ICS 피드, 웍스에 써 넣는 것은
HTTP Calendar API** — 세 길이 각각 한 방향씩만 맡고 겹치지 않는다.

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

| 모델 | 칸 | 캘린더에서 | 화면 묶음 · 기본 |
|---|---|---|---|
| `Task` | `deadline` | 마감. 완료된 업무는 흐리게 | 업무 마감 · 켬 |
| `Project` | `startDate`~`deadline` | 기간 막대 | 프로젝트 · 켬 |
| `CompanyRecord` | `startsOn`~`endsOn` | 연혁 · 수상 · 정부과제 | 회사 기록 · 켬 |
| `CrmQuote` | `quotedAt` | 견적 | CRM · 끔 |
| `CrmSampleRequest` | `requestedAt`, `sentAt` | 샘플 신청 · 발송 | CRM · 끔 |
| `CrmShipment` · `CrmProduction` | `shippedAt` · `producedAt` | 출고 · 생산 | CRM · 끔 |
| `TaxInvoice` · `CrmPayment` | `issuedOn` · `paidOn` | 발행 · 입금. 금액은 싣지 않는다 | 재무 · 끔 |
| `WeeklyReport` | `submittedAt` | 내 주간보고 제출 | 주간보고 · 끔 |

2026-10-28 구현하며 고친 것:

- **`Task.workStart`~`workEnd` 는 쓰지 않는다.** 처음에 「작업 기간」으로 적었는데, `workEnd` 는 계획이
  아니라 **완료한 시각**이다 — 상태를 `DONE` 으로 바꿀 때 `new Date()` 로 찍힌다(`lib/task-update.ts`).
  로컬 스냅샷에서 472건이 그 꼴이었다. `workStart` 는 1건뿐이다
- `CrmQuote.taxInvoicedAt` 은 `TaxInvoice.issuedOn` 과 같은 사건이라 뺐다
- `WeeklyReport` 의 주간 경계는 매주 같은 막대라 뺐다. 제출만 남긴다

**날짜 칸의 저장 꼴이 다르다** (2026-10-28 로컬 스냅샷 실측). 업무 마감은 **서울 자정**(15:00Z) 105건 ·
실제 시각 7건, 회사 기록 · CRM · 세금계산서 · 입금은 **UTC 자정**이다. 그래서 날짜는 한 규칙으로 정한다 —
UTC 자정이면 UTC 날짜, 아니면 서울 날짜. 세 꼴 모두 맞는 날이 나온다(`calendarDate`, `lib/calendar/items.ts`).

**권한은 넓히지 않는다.** 업무는 기본이 내가 담당 · 지시한 것(「전체」를 고르면 업무 화면과 같은 범위),
주간보고는 내 것만, 회사 기록 · CRM · 세금계산서는 각 화면처럼 구성원 전체. 웍스 캘린더는 3.2 의 `audience`.

조회는 창(`from`~`until`)을 받아 이 어댑터들과 3.2 를 **UNION 하는 read model 하나**로 둔다.
원본 모델에 칸을 더하지 않는다 — 캘린더는 읽는 쪽이다.

성능이 문제가 되면 그때 인덱스 테이블을 materialize 한다. 지금 규모(업무 수백 건대)에서는 필요 없다.

### 3.2 `ExternalCalendarEvent` — 새 테이블은 웍스 미러뿐

옴니스 안에 집이 없는 데이터, 즉 웍스에서 미러링한 일정만 담는다.

| 칸 | 왜 |
|---|---|
| `calendarId` · `uid` · `recurrenceId` | `(calendarId, uid, recurrenceId)` 유니크 |
| `href` · `etag` | `calendar-multiget` 재요청 키. etag 가 같으면 본문을 다시 받지 않는다 |
| `recurrenceId` | 예외 회차. 마스터와 같은 UID 를 갖기 때문에 UID 만으로는 유니크하지 않다. **마스터는 `null` 이 아니라 빈 문자열** — Postgres 유니크 키는 null 끼리의 겹침을 막지 못한다 |
| `rrule` · `exdates` · `recurUntil` | 전개는 조회 시점에 한다. 펼친 결과를 저장하지 않는다. `recurUntil` 은 마지막 회차의 끝(끝없는 반복은 null)으로, 조회 창을 거르는 데만 쓴다 |
| `startAt` · `endAt` · `isAllDay` · `tzid` | `DTSTART;TZID=Asia/Seoul` 과 `VALUE=DATE` 를 구분해 담는다. 종일은 서울 자정 기준 |
| `sequence` · `lastModified` | 변경 판정 |
| `deletedAt` | `sync-collection` 의 `404` 묘비. 지우지 않고 가린다 |

캘린더 하나는 `ExternalCalendar` 한 행이다 — `externalId` · `displayName` · `ctag` · `syncToken`(3초 되돌린 값) ·
`syncedAt` · `attemptedAt` · `lastError` · **`audience`**. `audience` 는 옴니스에서 누가 보는가(`ALL` · `ADMIN`)이고
**기본값은 `ADMIN`** 이다. 웍스에서 보이는 사람과 옴니스 구성원이 같다는 보장이 없어서다. 관리자가 캘린더 화면에서 연다.

**펼친 인스턴스를 테이블에 쌓지 않는다.** 무한 반복이 있으면 끝이 없고, 규칙이 바뀔 때마다
지우고 다시 넣어야 한다. 마스터만 저장하고 조회 창에 맞춰 그때 전개한다.

### 3.3 사용자 매핑

웍스 `ORGANIZER`·`ATTENDEE`·`X-NAVER-REGISTERER` 를 옴니스 `User` 에 붙일 때는
**회사 메일 주소로만** 대응시킨다. 웍스 내부 userId 를 `User` 의 정체성으로 삼지 않는다 —
[`auth-architecture.md`](auth-architecture.md) 가 네이버웍스를 인증 앵커로 두는 것을
기각했다. 대응표는 단순 참조이고, 못 붙은 참석자는 이름만 표시한다.

## 4. 승인 전인 것과 남은 확인

**2026-10-28 에 정해진 둘** (계획서 [`../plans/2026-10-28-calendar-works-sync.md`](../plans/2026-10-28-calendar-works-sync.md)):

- **계정** — 정우창 개인 계정의 앱 비밀번호를 쓴다. 대가는 그 앱 비밀번호가 **IMAP 도 함께
  열린다**는 것이다 — 옴니스 서버가 회사 메일을 읽을 수 있는 열쇠를 갖고, 비밀번호를 바꾸면
  동기화가 조용히 멈춘다. 전용 계정 교체를 후속 과제로 둔다. 서비스 계정이 CalDAV Basic
  인증에 쓰일 수 있는지는 확인되지 않았다.
- **범위** — 캘린더 3개: `Hadd Science`(쓰기 권한 있음) · `대표님 일정` · `바이오아이코어 2026`.
  탐침 계정에 보인 5개 중 본인 개인 캘린더와 8월 이후 변경이 없는 하나는 뺐다. **본인 개인
  일정은 옴니스 캘린더에 뜨지 않는다.** 동기화 범위는 「이 계정이 구독한 캘린더」이므로
  계정에서 캘린더를 빼면 옴니스에서도 사라진다.
- `calendarId` 를 코드에 박지 않는다 — PROPFIND 로 찾고 **표시 이름으로 걸러** 맞춘다.
  웍스에서 캘린더를 다시 만들면 id 는 바뀌지만 이름은 유지된다.

아직 사람이 정하지 않은 것:

- **옴니스 → 웍스 쓰기를 할지.** 2.3 의 마지막 줄. 하지 않으면 전체가 읽기 전용 미러로 끝나고 훨씬 싸다.
- **ICS 피드의 민감 일정 제목 가림** — 1.3. 잠금화면에 보이므로 기본값을 정해야 한다.
- **ICS 피드를 어느 데이터까지 담을지** — `Task.deadline` 으로 시작하는 것은 정했고,
  3.1 의 나머지와 웍스 일정을 언제 더할지는 미정이다.
- **스케줄러를 어디에 둘지** — 사내 NAS 인지 GitHub Actions 인지. Vercel Hobby 로는 분 단위가 안 된다.
  2026-10-29 새 일정 알림을 붙이며 **하루 한 번 크론(`/api/cron/daily`)에 동기화를 한 줄 더했다** — 아무도 캘린더를
  안 연 날에도 하루 한 번은 새 일정이 알림으로 나간다. 그보다 빠른 바닥(분 단위)은 여전히 이 질문에 달려 있다.

## 4a. 구현 (2026-10-28)

계획 [`../plans/2026-10-28-calendar-works-sync.md`](../plans/2026-10-28-calendar-works-sync.md) ·
실측 [`../working/2026-10-28-calendar-works-sync.md`](../working/2026-10-28-calendar-works-sync.md).

| 어디 | 무엇 |
|---|---|
| `lib/caldav/` | 읽기 전용 클라이언트 · XML · iCalendar 파서 · 동기화(`syncWorksCalendars`) |
| `lib/calendar/` | 시간대 · RRULE 전개 · 읽기 모델(`getCalendarItems`) · 월 칸 계산 |
| `app/api/calendar/` | `GET` 읽기 · `POST sync` 열람 시 갱신 · `PATCH calendars/[id]` 공개범위 |
| `app/(main)/calendar/` | 월 보기 화면 |
| `scripts/calendar-sync.ts` | 지금 한 번 당기기 · `--force` 처음부터 |

환경변수(서버 전용). **넷 중 하나라도 비면 웍스 부분이 통째로 꺼지고** 캘린더는 옴니스 날짜만으로 돈다 —
새 테이블을 읽지도 않는다. 데모(`omnis`)에는 넣지 않는다.

| 이름 | 뜻 |
|---|---|
| `CALDAV_HOME_URL` | 캘린더 홈. `https://caldav.worksmobile.com/rl/{테넌트}/caldav/{웍스 userId}/calendar/` |
| `CALDAV_USERNAME` | 그 계정의 회사 메일 주소 |
| `CALDAV_PASSWORD` | 앱 비밀번호. **IMAP 도 열리는 열쇠다** — Sensitive 로만 |
| `CALDAV_CALENDARS` | 들일 캘린더의 표시 이름, 쉼표로. `calendarId` 는 PROPFIND 로 찾는다 |

비밀번호를 바꾸면 동기화는 401 로 멈추고, 관리자에게만 「보기」 창에 오류가 보인다.
구성원 화면은 DB 에 있던 것으로 그대로 돈다.

## 4b. 새 일정 알림 (2026-10-29)

계획 [`../plans/2026-10-29-push-notifications.md`](../plans/2026-10-29-push-notifications.md) 결정 3 ·
실측 [`../working/2026-10-29-push-notifications.md`](../working/2026-10-29-push-notifications.md).

- **언제** — 동기화가 새 행을 만들 때(`upsertResources` 의 `createManyAndReturn`). 동기화는 캘린더 화면을 열 때(60초 판정)와
  하루 한 번 크론에서 돈다 — 알림이 늦으면 그 사이 아무도 캘린더를 안 연 것이다
- **보내지 않는 것** — 그 캘린더의 **첫 성공 동기화**(`syncedAt` 이 비어 있었다): 원래 있던 일정이다. 공개 범위를 넓힐 때:
  행이 새로 생기지 않는다. 예외 회차(`recurrenceId ≠ ""`) · 취소 · 이미 끝난 일정. 바뀐 · 취소된 일정 알림은 범위 밖
- **누구에게** — `audience` ALL 이면 구성원 전원, ADMIN 이면 관리자. 그 일정의 ORGANIZER 메일이 옴니스 사용자면 그 사람은 뺀다
- **무엇을** — 벨(`calendar_event_added`) + 푸시. `entityId` 는 `YYYY-MM-DD:<일정 id>` 이고 누르면 `/calendar?day=` 로 그 날을 연다.
  한 캘린더에서 한 번에 4건 이상이면 「새 일정 N건」 하나로 묶는다
- 알림은 응답 뒤에 만든다 — 동기화 응답을 늦추지 않고, 실패해도 동기화 결과는 그대로다
- 규칙은 `lib/notify-rules.ts`(`calendarEventsToNotify` · `calendarRecipients` · `calendarNotices`), 발송은 `lib/calendar-notify.ts`

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

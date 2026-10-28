---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-28-calendar-works-sync.md
last_verified: 2026-10-28
---

# 캘린더 — 웍스 일정 들여오기 · 구현 · 실측

계획: [`../plans/2026-10-28-calendar-works-sync.md`](../plans/2026-10-28-calendar-works-sync.md).
설계 정본: [`../tech/calendar.md`](../tech/calendar.md). 브랜치 `feat/calendar-works-sync`, 워크트리 `../omnis-calendar`.

**운영 DB 쓰기 · 운영 마이그레이션 · 배포 · Vercel 환경변수 등록은 하지 않았다.** 웍스에는 읽기 요청
(`PROPFIND` · `REPORT`)만 보냈다. 쓴 곳은 로컬 DB(운영 스냅샷)뿐이다.

## 만든 것

| 단계 | 파일 | 하는 일 |
|---|---|---|
| 1 | `prisma/schema.prisma` · `migrations/20261028000000_calendar_works_sync` | `ExternalCalendar` · `ExternalCalendarEvent` · `CalendarAudience`. 새 객체만 만든다 |
| 2 | `lib/caldav/xml.ts` | multistatus 파서. 접두사 무시 · CDATA · 엔티티 |
| 2 | `lib/caldav/ical.ts` | VEVENT 꺼내기. 한 리소스의 마스터+예외, VALARM 분리, 시간대 |
| 2 | `lib/caldav/client.ts` | 읽기 전용 CalDAV(메서드를 PROPFIND · REPORT 로 막음). 토큰 3초 되돌리기 |
| 2 | `lib/caldav/sync.ts` | ctag → sync-collection → etag 다른 것만 multiget. 새 행은 createMany |
| 2 | `lib/calendar/time.ts` · `recurrence.ts` | 서울 벽시계 계산 · RRULE 전개(의존성 없이) |
| 2 | `scripts/calendar-sync.ts` | 지금 한 번 당기기. localhost 아니면 `--prod` 없이는 멈춘다 |
| 3 | `app/api/calendar/sync/route.ts` | 열람 시 갱신. 60초 안이면 요청 없이 돌려보낸다 |
| 3 | `app/api/calendar/calendars/[calendarId]/route.ts` | 관리자가 캘린더 공개범위를 바꾼다. 활동 기록 |
| 4 | `lib/calendar/items.ts` · `works.ts` · `types.ts` · `app/api/calendar/route.ts` | 파생 층 + 웍스 미러 UNION, 반복 전개와 예외 병합 |
| 5 | `app/(main)/calendar/*` · `lib/calendar/grid.ts` · 사이드바 | 월 보기 · 기간 띠 · 고른 날 목록 · 보기 창 |

의존성은 늘리지 않았다. `package.json` 에는 `test:unit`(`tsx --test`) 한 줄만 더했다 — 이 저장소에
단위테스트 실행기가 없었다. `verify` 에는 넣지 않았다(게이트를 바꾸는 일이라 따로 정한다).

## 검증

### 품질 게이트 (2026-10-28)

```
$ pnpm run verify
✖ 43 problems (0 errors, 43 warnings)      ← 경고 43건 중 이번에 만든 · 고친 파일 0건
$ pnpm test:unit
ℹ tests 42  ℹ pass 42  ℹ fail 0
```

테스트가 실제로 잡는지 일부러 깨뜨려 봤다.

| 깨뜨린 것 | 실패한 테스트 |
|---|---|
| EXDATE 를 빼지 않게 | 4건 |
| VALARM 속성을 일정에 섞이게 | 1건 |
| sync-token 되돌리기를 0초로 | 1건 |
| 예외 회차가 원래 회차를 대신하지 않게 | 3건 |

원복 뒤 전부 통과.

### 실서버(읽기만) → 로컬 DB

```
첫 동기화     요청 14건 (PROPFIND 1 · sync-collection 3 · multiget 10) · 5.7초 · 리소스 805개
바뀐 것 없음  요청 1건 · 229ms · 3개 캘린더 모두 unchanged
60초 안 재호출 요청 0건 · 20ms (skipped)
증분 경로     로컬에서 한 캘린더의 ctag 를 틀어 확인 — 요청 2건, 저장된 토큰으로 변경 0건, ctag 원래 값으로 복구
```

| 캘린더 | 행 | 반복 마스터 | 예외 회차 | 종일 |
|---|---|---|---|---|
| Hadd Science | 741 (리소스 740) | 3 | 1 | 200 |
| 대표님 일정 | 23 | 0 | 0 | 3 |
| 바이오아이코어 2026 | 42 | 0 | 0 | 34 |

반복 마스터 3 · 예외 1 은 10/27 탐침에서 본 RRULE 3건 · RECURRENCE-ID 1건과 같다.
행이 리소스보다 하나 많은 것이 그 예외 회차다(마스터와 한 리소스에 든다).

### 화면 — 로컬 dev(3130) · Playwright headless

e2e 계정은 `scripts/ensure-e2e-accounts.ts` 로 로컬 스냅샷에만 더했다(팀장 ADMIN · 사원1 MEMBER).

| 확인 | 결과 |
|---|---|
| 관리자 2025-11 | 칸 42 · 항목 65(웍스 47 · 회사 기록 18) |
| 화면을 열 때 동기화 | `POST /api/calendar/sync` 200, 웍스 요청 1건 |
| 11/26 | 옮겨진 예외 회차 한 번(20:30)에 반복 표시. 원래 18:00 자리는 비어 있다 |
| 가로 넘침 | 1440 · 1024 · 768 · 390 · 320 · **200px** 모두 0px |
| 구성원(공개 전) | 웍스 0건 · 캘린더 0개 |
| 구성원의 sync 응답 | `status` · `changed` 만. `?force=1` 도 관리자 정보 없음 |
| 구성원의 공개범위 PATCH | 403 |
| 관리자가 Hadd Science 를 열면 | 구성원에게 45건 → `ADMIN` 으로 되돌림 확인 |
| 잘못된 창 · 100일 초과 | 400 · 400 |
| 콘솔 오류 | 관리자 0 · 구성원 1(일부러 보낸 PATCH 의 403) |
| 다크 모드 · 보기 창 | 스크린샷으로 확인 |

화면을 보다 찾아 고친 것:

- **1년 넘는 기간의 끝이 잘렸다.** 칸에 나눠 담는 `itemDayKeys` 가 400일에서 끊는데, 그것으로 끝 날짜를
  셌다. 2025-04-01 에 시작한 지원사업이 정확히 400일째인 「5월 5일」에서 끝나는 것으로 보였고, 실제 끝은
  2029-03-31 이었다. 그 뒤 날짜를 고르면 목록에서도 빠졌다. `itemSpan` · `coversDay` 로 바꾸고 회귀 테스트를 뒀다
- 주소로 다른 달을 열면 오른쪽 목록이 오늘을 고르고 있었다 — 그 달 1일로
- 고른 날 목록에서 지원사업 같은 긴 기간이 그날 일정과 같은 무게로 섞였다 — 「이 날에 걸친 기간」 으로 나눔

## 계획과 달라진 것

| 계획 | 실제 | 왜 |
|---|---|---|
| 커서 테이블 `CalendarSyncState` | `ExternalCalendar` | 커서만이 아니라 공개범위(`audience`)까지 담게 됐다 |
| 업무 `workStart`~`workEnd` = 작업 기간 | 마감만 | `workEnd` 는 `DONE` 으로 바꿀 때 찍히는 완료 시각이었다(로컬 472건) |
| 상한 토큰을 `lastError` 에 기록 | `console.warn` | `lastError` 는 화면에 오류로 보인다. 깨진 것이 아니라 비효율이고, etag 비교로 본문 요청은 늘지 않는다 |
| — | 공개범위 라우트 · 스위치 | 기본값이 관리자만이라 이것 없이는 구성원이 아무것도 못 본다 |
| 2단계 `lib/caldav/` | 반복 전개 · 시간대는 `lib/calendar/` | 읽는 쪽(4단계)이 같이 쓴다 |

## 머지 전에 사람이 할 것

1. **운영 DB 마이그레이션** — `20261028000000_calendar_works_sync`. 새 테이블 둘 · enum 하나만 만든다.
   마이그레이션을 먼저, 머지를 나중에
2. **Vercel 환경변수 넷** — 운영(`omnis-hadd`) Production 에만. 데모에는 넣지 않는다(넣지 않으면 웍스 부분은 꺼진다)

   | 이름 | 값 |
   |---|---|
   | `CALDAV_HOME_URL` | `https://caldav.worksmobile.com/rl/{테넌트}/caldav/{웍스 userId}/calendar/` — 10/22 접속 때 찾은 정우창 계정의 캘린더 홈 |
   | `CALDAV_USERNAME` | 정우창 회사 메일 주소 |
   | `CALDAV_PASSWORD` | 키체인 `works-imap` 의 앱 비밀번호 — **Sensitive 로**. IMAP 도 열리는 열쇠다 |
   | `CALDAV_CALENDARS` | `Hadd Science,대표님 일정,바이오아이코어 2026` |

3. 배포 뒤 관리자가 캘린더 화면 「보기」 에서 **구성원에게 열 캘린더를 고른다.** 지금은 셋 다 관리자만이다

환경변수가 없으면 캘린더는 웍스 없이 옴니스 날짜만으로 돈다 — 새 테이블을 읽지도 않는다
(`configuredCalendarNames()` 가 비면 일찍 돌아간다). 그래서 마이그레이션보다 머지가 먼저 되어도
화면이 죽지는 않는다. 그래도 순서는 1 → 머지 → 2 로 간다.

## 남은 것

- 전용 웍스 계정으로 교체 — 계획서 「자격증명」
- 주 · 목록 보기, 참석자 표시 범위 — 계획서 「남은 결정」
- 폰으로 내보내는 ICS 구독 피드 — 별도 계획서([`../tech/calendar.md`](../tech/calendar.md) 1.3)
- 달을 넘길 때마다 sync 를 부른다. 서버가 60초 안이면 요청 없이 돌려보내지만 함수 호출과 DB 질의 1건은
  남는다. 요청 수가 문제가 되면 클라이언트에서도 60초를 막는다

---
kind: snapshot
status: active
canonical: mydocs/working/2026-09-28-neon-wake-time.md
last_verified: 2026-09-28
---

# Neon 이 깨어 있는 시간을 줄인다 — 측정과 처방

PR #67, 머지 커밋 `8acca18`. 운영 배포 완료.

2026-09-23 에 Neon 무료 한도(100 CU-시간/월)가 터져 Omnis 와 홈페이지가 함께 멈췄다.
Launch 플랜으로 올려 한도는 없어졌지만 **깨어 있던 시간이 곧 요금**이 됐다($0.106/CU-시간).

사이트 세션이 "홈페이지 방문 비콘이 방문마다 Neon 을 깨운다" 며 묶어 달라고 요청했다.
만들기 전에 쟀고, **전제가 절반만 맞았다.**

## 측정 방법

Neon 은 마지막 질의 5분 뒤에 잔다. 그래서 「요청이 든 5분 칸의 수 × 5분」 이
깨어 있던 시간의 하한이다. 운영 DB 의 timestamp 를 5분으로 버킷팅해 셌다.

```sql
COUNT(DISTINCT date_trunc('hour', at) + floor(extract(minute FROM at)/5) * interval '5 min')
```

## 결과 (최근 7일, 2026-09-28 기준)

```
Omnis 자체 쓰기:        20칸  1.7h
홈페이지 방문:          78칸  6.5h
합집합(실제 깨어 있음): 95칸  7.9h
── 방문만 있던 칸:      75칸  6.3h   ← 방문의 한계 비용
```

한 달 환산 약 27 CU-시간 ≈ $2.8 (컴퓨트 1 CU 기준. Neon 최소 0.25 CU 면 1/4).

날짜별:

```
날짜        방문  5분칸  깨운시간(h)
2026-09-22    27     10  0.83
2026-09-23    40     20  1.67
2026-09-24    11      9  0.75
2026-09-25    22     13  1.08
2026-09-26    10     10  0.83
2026-09-27    14     13  1.08
2026-09-28     3      3  0.25
```

## 이 측정의 구멍 — 그리고 진짜 주범

**행을 남기는 것만 센다.** Omnis 의 *읽기*는 아무 행도 남기지 않아 안 잡힌다.
그래서 코드를 봤다:

- `components/chat/chat-panel.tsx:127` → `/api/chat/messages` **3초마다**
- `components/layout/notification-bell.tsx:76` → `/api/notifications` **15초마다**

둘 다 Prisma 를 친다. 즉 **탭이 하나라도 열려 있으면 Neon 은 100% 깨어 있다.**
5분 잠들기 타이머가 영원히 리셋된다.

한 사람이 하루 8시간 켜 두면 그것만으로 월 176 CU-시간. 터진 한도가 100 이었으니
**넘긴 것은 방문(27)이 아니라 이쪽이다.** 켜 두고 퇴근하면 밤새 24시간이 그대로 나간다.

라우트별 호출 수로 못 박고 싶었지만 Vercel Observability Plus 가 Pro 플랜부터라 막혔다.
위는 코드와 산수다 — **실측이 아니다.**

## 처방 1 — 사람이 없는 탭은 폴링을 멈춘다

`hooks/use-visible-interval.ts`. 안 보이는 탭은 원래 멈췄지만 **보이면서 사람이 없는**
탭은 그대로 돌았다. 마우스·키보드가 10분 조용하면 멈추고, 다시 만지면 그 자리에서
한 번 부르고 재개한다. 놓친 것은 채팅의 `after` 커서로 한 번에 따라잡는다.

유휴 판정이 5분이 아니라 10분인 이유: 5분이면 Neon 이 잠들락 말락 하는 경계에 걸려
깨어 있는 시간은 그대로인데 화면만 늦어진다.

브라우저 실측 — `IDLE_MS` 를 잠깐 5초로 낮춰 재고 되돌렸다:

```
무조작 45초  → 폴링 0건
활동 40초    → 4건, 첫 요청 0초(즉시 재개), 이후 15초 간격
```

## 처방 2 — 밖으로 나가는 호출에 전부 타임아웃

`fetch` 도 `tls.connect` 도 `https.request` 도 기본 타임아웃이 없다.

| 어디 | 전 | 후 |
|---|---|---|
| Gemini 생성 ×2 | 없음 | 45초 |
| Gemini 임베딩 | 없음 | 30초 |
| NAS(WebDAV) 연결 / 응답 | 없음 | 10초 / 30초 |
| 홈페이지 재검증 | 없음 | 10초 |
| 오류 알림 메일 | 없음 | 10초 |
| `lib/github-issue.ts` | 8초 있었음 | 그대로 |

Gemini 가 제일 나빴다 — 재시도 8번이 첫 시도에서 멎어 한 번도 못 돌았다.
NAS 는 헤더가 오면 한도를 풀어 큰 파일을 받다 끊기지 않게 했다.

응답하지 않는 서버를 세워 실측:

```
맨 fetch            20.0초에도 매달려 있음
revalidateWebsite   10.0초에 반환, 던지지 않고 로그만
NAS 연결            10.0초에 끊음 — "NAS 연결이 10초 안에 열리지 않았습니다"
```

## 처방 3 — 방문을 Redis 에 쌓아 하루 한 번 옮긴다

**하루 한 번인 것이 핵심이다.** 크론 한 번이 Neon 을 최소 5분 깨우므로 한 시간마다면
하루 24 × 5분 = 2시간이고, 그건 묶지 않은 지금(0.93시간)보다 **나쁘다.** 자주 돌릴수록 손해다.

새벽 4시 KST(`0 19 * * *` UTC). 옮길 것을 STAGING 으로 먼저 `RENAME` 한 뒤 읽는다 —
읽고 나서 지우면 그 사이 들어온 방문이 함께 지워진다. `createMany` 가 실패하면
STAGING 이 남아 다음 크론이 다시 집는다.

**Redis 가 없거나 떨어지면 예전처럼 바로 쓴다.** 통계 한 건을 잃느니 컴퓨트를 한 번
깨우는 편이 낫다. 그래서 Upstash 가 붙기 전에 배포해도 지금과 똑같이 돈다.

가짜 Upstash REST 서버를 세워 실측:

```
1) 방문 3건 접수     → Postgres 0건 · 버퍼 3건
2) 크론 flush        → moved 3 · Postgres 3건 · 버퍼 0건
3) 빈 버퍼로 재flush  → moved 0 (안 던짐)
4) flush 뒤 새 방문   → 버퍼에만, 다음 flush 에 감
5) at                → 방문 시각(크론 시각 아님), 다섯 칸 전부 보존
6) Redis 없음        → 바로 Postgres

복구 — STAGING 에 2건 남은 채로 새 방문 1건:
   남은 2건 먼저(moved 2) → 새 1건(moved 1) → 합계 3건, 한 건도 안 잃음
```

사이트 계약(`POST /api/website/visits`)은 바뀌지 않았다. IP·UA 미전송 그대로다.
통계 응답에 `pending`(아직 Postgres 로 안 간 수)을 더했다 — 화면이 「오늘 0명」 을
장애로 오해하지 않아야 한다. 사이트 세션에 전달했다.

## 운영 확인

```
POST /api/cron/flush-visits  (비밀 없이)  → 401 forbidden   ← 503 이 아니므로 CRON_SECRET 설정됨
POST /api/cron/flush-visits  (틀린 비밀)  → 401 forbidden
POST /api/website/visits     (비밀 없이)  → 401 forbidden
https://haddscience.com/ko/               → 200
```

## 기대 효과 — 아직 실측 아님

| | 지금 | 뒤 |
|---|---|---|
| 폴링(탭 열어 둠) | 열려 있는 내내 | 사람이 있을 때만 |
| 방문 | 주 6.5h | 주 0.6h (하루 5분 × 7) |

**숫자는 아직 검증되지 않았다.** Neon Monitoring 에서 전후를 비교하려면 며칠이 지나야
한다. 위 표는 산수이지 실측이 아니다.

## 남은 것

- **Upstash 약관 동의(브라우저)** — `vercel integration add upstash/upstash-kv` 가
  `integration_terms_acceptance_required` 로 막혀 있다.
  https://vercel.com/woochang4862s-projects/~/integrations/accept-terms/upstash
  동의 전까지 방문은 예전처럼 Postgres 로 바로 간다(처방 3이 안 켜진 상태)
- Neon Monitoring 전후 비교. 사이트 세션이 자기 문서에 같이 적겠다고 했다
- **Neon scale-to-zero 지연 설정**은 검토만 하고 손대지 않았다. 5분을 1분으로 줄이면
  깨어 있는 시간이 더 줄지만, 실제 Omnis 사용자가 겪는 콜드 스타트가 늘어난다.
  폴링·방문을 고친 뒤 남는 양을 보고 정할 일이다

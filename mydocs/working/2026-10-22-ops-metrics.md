---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-22-ops-metrics.md
last_verified: 2026-10-22
---

# 운영 수치 쌓기 — 구현 · 실측

계획: [`../plans/2026-10-22-ops-metrics.md`](../plans/2026-10-22-ops-metrics.md). 브랜치 `feat/ops-uptime`, 워크트리 `../omnis-ops`.
운영 DB 쓰기 · 마이그레이션 · 배포는 하지 않았다. 스키마 변경 없음.

## 만든 것

| 파일 | 하는 일 |
|---|---|
| `lib/kpi.ts` · `scripts/kpi-export.ts` | 클라이언트가 KPI 표를 모르면 generate 를 안내하며 exit 1. `eventsSince().catch(() => null)` 제거 |
| `scripts/verify-kpi-export.ts` | 위 점검 · 실제 실행 exit 코드 |
| `app/api/health/route.ts` | DB 에 닿지 않는 응답 `{ ok, sha }` |
| `.github/workflows/uptime.yml` | 30분마다 `/login` · `/api/health`. 하나라도 200 이 아니면 실패 |
| `lib/uptime-report.ts` · `scripts/uptime-report.ts` | 실행 기록 → 가동률 · 장애 · 복구 시간 |
| `scripts/verify-uptime-report.ts` | 위 계산 |
| `mydocs/working/ops-log.md` | 주간 에러 · 월 비용 · 월 가동률 장부와 기록하는 법. 첫 기록(10/15~10/21 에러) |

## 검증 (2026-10-22)

### 품질 게이트

```
$ pnpm run verify
✖ 43 problems (0 errors, 43 warnings)      ← main 과 같은 경고 43개
verify exit=0
$ pnpm exec eslint <바꾼 파일 7개>
eslint exit=0                               ← 새 경고 0
$ pnpm run build
✓ Compiled successfully in 21.8s
├ ƒ /api/health                             ← 동적 함수(정적 페이지로 굳지 않는다)
build exit=0
```

### kpi-export — `npx tsx --env-file=.env scripts/verify-kpi-export.ts` (로컬 DB 읽기만)

```
── 클라이언트 점검 (assertKpiClient)
✓ 지금 클라이언트는 통과 → null
✓ 거부: KPI 표를 모르는 클라이언트 → 둘 다 이름을 대고 generate 를 안내 → [true,true]
✓ 거부: 하나만 아는 클라이언트 → 빠진 것만 → true
── 실제 실행 (자식 프로세스)
✓ --compute 하루 → exit 0 → 0
✓ 출력이 JSON 배열 → true
✓ 저장값 모드 → exit 0 → 0
✓ 거부: --out 없이 → exit ≠ 0 → true

✓ 전부 통과
```

### 낡은 클라이언트 재현 (거부 사례)

이 워크트리의 `generated/prisma` 를 KPI 표 이전 스키마(`7a487c2^`)로 다시 만들고, 옛 코드(origin/main)와 새 코드를 같은 조건에서 돌렸다.
`generated/` 는 gitignore 라 워크트리마다 따로다. 다른 세션의 체크아웃에는 영향이 없다. 끝나고 현재 스키마로 다시 만들었다.

```
$ git show 7a487c2^:prisma/schema.prisma > prisma/schema.old.prisma   # model KpiDaily 0개
$ npx prisma generate --schema prisma/schema.old.prisma
== 옛 코드 · 저장값
TypeError: Cannot read properties of undefined (reading 'findMany')
exit=1
== 옛 코드 · --compute
13칸 · 1일 → …/r2.json
exit=0                         ← 고치기 전: 이력 지표를 빼고 성공
== 새 코드 · 저장값
Error: Prisma 클라이언트에 kpiDaily · taskEvent 가 없다 — 스키마보다 낡았다. `npx prisma generate` 를 먼저 돌린다
exit=1
== 새 코드 · --compute
Error: Prisma 클라이언트에 kpiDaily · taskEvent 가 없다 — 스키마보다 낡았다. `npx prisma generate` 를 먼저 돌린다
exit=1
$ npx prisma generate          # 원래대로
== 재생성 후 새 코드 · --compute
13칸 · 1일 → …/r5.json
exit=0
```

다시 재현하려면 위 명령을 **워크트리 안에서** 돌린다. 공유 체크아웃(omnis-local)에서 돌리면 그 사이 다른 세션이 낡은 클라이언트를 쓴다.

### 가동률 계산 — `npx tsx scripts/verify-uptime-report.ts`

```
── 장애 묶음
✓ 센 회차 6 · 성공 3 · 가동률 0.5 → [6,3,0.5]
✓ 장애 2건 → 2
✓ 첫 장애: 00:30 실패부터 01:30 성공까지 60분, 실패 2회 → ["2031-01-07T00:30:00Z","2031-01-07T01:30:00Z",60,2]
✓ 마지막 장애는 진행 중 — 끝 · 복구 시간 없음 → [null,null]
✓ 기간은 정렬된 첫·끝 → ["2031-01-07T00:00:00Z","2031-01-07T03:00:00Z"]
── 세지 않는 회차 (거부)
✓ 거부: 취소 · 진행 중 · 건너뜀 · 손으로 돌린 실패는 분모에도 장애에도 없다 → [2,2,0]
✓ 거부: 센 회차가 없으면 가동률은 0 이 아니라 null → null

✓ 전부 통과
```

`scripts/uptime-report.ts --file`(가짜 실행 3회) 출력:

```
기간 2031-01-07T00:00:00Z ~ 2031-01-07T01:00:00Z · 센 회차 3 · 성공 2 · 가동률 66.67%
장애 1건
  2031-01-07T00:30:00Z ~ 2031-01-07T01:00:00Z · 실패 1회 · 복구 30분
```

`--from` 으로 GitHub 을 부르면 지금은 `gh: Not Found (HTTP 404)` 다. `uptime.yml` 이 아직 main 에 없어서다. 같은 API 를 `ci.yml` 에 부르면 `{created_at, status, conclusion, event}` 가 그대로 나온다. 응답 모양은 이것으로 확인했다.

### `/api/health` — 로컬 dev (`next dev -p 4731`, 이 워크트리)

```
HTTP/1.1 200 OK
cache-control: no-store
{"ok":true,"sha":null}
login 200
 GET /api/health 200 in 839ms (compile: 828ms, render: 12ms)
```

DB 에 닿지 않는 근거는 코드다. 라우트의 import 는 `next/server` 하나뿐이다. Prisma 쿼리 로그는 켜져 있지 않아서 로그 0줄은 근거가 아니다.

### 워크플로 확인 단계 — 운영 주소로 그대로 실행

`uptime.yml` 의 `run:` 을 꺼내 로컬 bash 로 돌렸다. YAML 은 `yaml.safe_load` 로 읽었다(`schedule: */30 * * * *`, job `check`).

```
/login 200
/api/health 404        ← 아직 운영에 없다
step exit=1            ← 200 이 아니면 실패로 끝난다 (거부 사례)
```

머지해서 `/api/health` 가 운영에 나가면 이 단계는 exit 0 이 돼야 한다.

## 돌리지 않은 것

- **GitHub 에서 예약 실행.** 예약 작업은 기본 브랜치의 워크플로만 돈다. 머지 뒤에 Actions 탭에서 확인한다.
- `actionlint` 는 이 기기에 없어서 돌리지 않았다.
- e2e — 화면 흐름을 바꾸지 않았다.

## 머지 뒤 사람이 할 일

1. 머지하면 운영에 `/api/health` 가 나간다. `curl https://omnis-hadd.vercel.app/api/health` 가 200 인지 본다.
2. Actions → `uptime` → **Run workflow** 로 한 번 손으로 돌려 초록인지 본다. 손으로 돌린 회차는 가동률에 세지 않는다.
3. 30분 뒤 `schedule` 회차가 생겼는지 본다.
4. 매주 월요일 에러, 매월 초 가동률 · 비용 — [`ops-log.md`](ops-log.md) 의 「기록하는 법」.

시크릿 등록 · 유료 설정은 필요 없다.

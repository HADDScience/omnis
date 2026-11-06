---
kind: guide
status: active
canonical: mydocs/manual/maintenance-switch.md
last_verified: 2026-11-06
---

# 점검 스위치

장애 · 긴급 수정 때 **재배포 없이** 공지 띠나 점검 화면을 띄운다. 값은 Vercel Global Config(구 Edge Config)
스토어 `omnis-switch` 의 항목 `maintenance` 하나다. 코드: `lib/maintenance/` · `proxy.ts` · `app/api/status` ·
`components/layout/notice-banner.tsx`.

## 명령

```bash
scripts/maintenance.sh status                         # 지금 값
scripts/maintenance.sh banner "18시에 5분 점검합니다"     # 화면 위 공지 띠
scripts/maintenance.sh on "긴급 수정 배포 중입니다"       # 점검 화면(503)
scripts/maintenance.sh off                            # 끄기
```

`vercel whoami` 로 로그인된 맥에서 돈다. 다른 팀이면 `VERCEL_SCOPE=…`. 대시보드(Storage → omnis-switch → Items)에서
`maintenance` 를 직접 고쳐도 같다.

## 무엇이 일어나는가

| mode | 화면 | 열린 화면 | 반영까지 |
|---|---|---|---|
| `off` (값 없음 · 못 읽음 포함) | 그대로 | 띠 없음 | — |
| `banner` | 맨 위 노란 띠에 `message`. 닫으면 같은 공지는 그 탭에서 다시 안 나온다 | 25초마다 확인 | 최대 60초 |
| `maintenance` | 정적 점검 화면 503 + `Retry-After: 120`. DB · 인증 · 앱 번들을 쓰지 않는다 | 다음 확인 때 스스로 새로고침해 점검 화면으로 | 새 요청 최대 40초, 열린 화면 최대 60초 |

반영 시간 = 전파(최대 10초) + 서버 메모리 캐시(proxy 30초 · /api/status 5초) + CDN 20초(/api/status) + 폴링 25초.

**점검 중에도 열려 있는 것:** `/api/*` 전부(`/api/health` · `/api/status` 포함), `/.well-known/*`(Workflow 실행),
정적 자원(`/_next/static` · 아이콘 · `sw.js`). API 를 proxy 에 태우지 않은 이유는 호출 수다 — 채팅이 3초마다 API 를
부르므로 함수 호출이 거의 두 배가 된다(Hobby 월 1,000,000회). 그래서 **MCP · 스크립트처럼 화면 밖에서 API 를
부르는 쪽은 점검 중에도 쓴다.** 쓰기를 확실히 막아야 하는 점검이면 그쪽을 따로 멈춘다.

**스위치가 서비스를 넘어뜨리지 않는다:** 값이 없거나 모양이 틀리거나, 토큰 · 네트워크 · 한도 초과로 못 읽거나,
1.5초 안에 답이 없으면 off 다.

## 관리자 우회

점검 화면이 떠 있어도 고친 결과를 확인해야 할 때. 환경변수 `MAINTENANCE_BYPASS_TOKEN`(16자 이상, 저장소에 두지 않는다)
과 같은 값으로 한 번 연다:

```
https://omnis.haddscience.com/?maintenance_bypass=<토큰>
```

12시간짜리 httpOnly 쿠키를 심고 주소에서 토큰을 지운다. 들어가면 맨 위에 빨간 「점검 중 · 우회 접속」 띠가 보인다.
주소창의 토큰은 접속 기록에 남는다 — 점검이 끝나면 토큰을 바꾼다.

## 읽기 한도 (Hobby)

| 항목 | Hobby | 출처 |
|---|---|---|
| 스토어 | 1개(팀 전체), 프로젝트당 1개 연결 | vercel.com/docs/global-config/global-config-limits |
| 읽기 | 월 100,000회 포함 | 같은 곳 · vercel.com/docs/plans/hobby |
| 쓰기 | 월 100회 포함 — 명령 한 번이 1회 | 같은 곳 |
| 넘으면 | 30일 동안 그 기능을 못 쓴다(그동안 스위치는 off) | vercel.com/docs/plans/hobby |

요청마다 읽으면 한도를 넘는다. 그래서 인스턴스마다 메모리에 둔다 — 읽기는 요청 수가 아니라 **켜져 있는 시간 /
캐시 시간**에 묶인다. 화면이 쓰이는 시간을 월 220시간(평일 10시간 × 22일)으로 잡으면:

- proxy(화면 요청, 30초 캐시): 인스턴스 하나당 시간당 120회 → 26,400회
- /api/status(CDN 20초): 시간당 180회 → 39,600회
- 합계 약 66,000회. 화면을 열어 둔 채 15분 넘게 손대지 않거나 탭이 가려지면 확인을 멈춘다

proxy 인스턴스가 늘 둘이면 약 92,000회로 한도에 가깝다. 늘면 `MAINTENANCE_CACHE_SECONDS=60`(proxy 캐시)을 넣고
재배포한다 — proxy 읽기가 반으로 준다. Hobby 는 사용량을 CLI · API 로 못 읽으니 대시보드 Usage → Global Config 에서 본다.

## 로컬 · 시험

- `MAINTENANCE_MODE=banner|maintenance` · `MAINTENANCE_MESSAGE=…` 를 주고 띄우면 스토어 없이 같은 값이 된다.
  운영에 넣으면 스토어보다 먼저 보므로(재배포 필요) 스토어가 고장 났을 때의 두 번째 길로 쓸 수 있다.
- `MAINTENANCE_ALLOW_SIMULATE=1` 인 서버는 쿠키 `omnis_maintenance_sim` 으로 브라우저 하나만 값을 바꿔 본다 —
  CI e2e 가 이 길을 쓴다(`tests/feature/maintenance-switch.spec.ts`). 운영에는 넣지 않는다.
- 규칙 단위 시험: `lib/maintenance/maintenance.test.ts`.

## 처음 한 번 — 운영 연결

```bash
vercel global-config create omnis-switch --items '{"maintenance":{"mode":"off","message":"","updatedAt":null}}'
```

그다음 대시보드에서 스토어를 프로젝트 `omnis` 의 Production(필요하면 Preview)에 연결하면 `GLOBAL_CONFIG`
연결 문자열이 환경변수로 들어간다. `MAINTENANCE_BYPASS_TOKEN` 을 Production 에 넣고 재배포한다. 연결 전에는
코드가 스토어를 부르지 않는다(읽기 0회).

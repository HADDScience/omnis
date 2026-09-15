---
kind: canonical
status: active
canonical: mydocs/tech/request-budget.md
last_verified: 2026-09-15
---

# 요청 한도와 폴링 규칙

폴링을 새로 넣거나 간격을 바꾸기 전에 읽는다. 브라우저 탭 하나가 몇 초마다 부르는 요청이
한 달이면 모든 사내 사이트가 같이 쓰는 한도를 채운다.

## 한도

- Vercel **무료 팀의 Edge Requests 는 월 100만 건**이고, 팀 안의 프로젝트가 한 한도를 같이 쓴다 —
  운영(`omnis-hadd`) · 데모(`omnis`) · 허브 · 홈페이지.
- 한도를 넘으면 **프로젝트가 자동으로 일시 중지된다.** 옴니스만이 아니라 같은 팀의 사이트가 같이 멈춘다.
- 2026-09-15 에 실제로 닿았다: 버셀 메일 75%(9/14 15:13) → 100%(9/15 11:21).

## 그때 무엇이 요청을 썼나 (2026-09-15 실측)

운영 요청 로그 5,000건(11:33~11:37) — **시간당 약 6.8만 건**, 20분 동안 5.3만~6.7만 건 유지.
데모 · 홈페이지 · 허브는 1시간에 0~2건이었다.

| 비중 | 요청 | 원인 |
|---|---|---|
| 65.6% | `GET /omnis/api/ip-mcp` | MCP 클라이언트의 스트림 GET 에 200 을 주고 끊어 재연결이 반복된 것으로 보인다 (아래) |
| 33.0% | `GET /omnis/api/notifications` | 알림 벨이 모든 페이지에서 2.5초마다, 숨긴 탭에서도 돌았다 (탭당 시간당 1,440건) |
| 1.3% | `GET /omnis/api/chat/messages` | 채팅 3초 폴링 |

## 규칙

### 1. 새 폴링은 `hooks/use-visible-interval` 로

```ts
useVisibleInterval(callback, ms, enabled?)
```

- 탭이 보일 때만 `ms` 마다 부른다. 숨기면 멈춘다.
- 탭으로 돌아오면 **한 번 바로** 부르고 다시 센다 — 돌아온 사람이 오래된 화면을 보지 않게.
- `setInterval` 을 직접 쓰지 않는다. 안 보이는 탭은 새 소식을 보여 줄 곳이 없다.
- 간격은 "사람이 몇 초 늦게 알아도 되는가" 로 정한다.

브라우저 실측(PR #17): 보이는 16.5초 2건 → 숨김 16.5초 0건 → 복귀 즉시 1건.

### 2. 지금 간격

| 무엇 | 간격 | 조건 |
|---|---|---|
| 알림 벨 | 15초 | 보이는 탭만. **벨을 열 때 바로 한 번** 더 읽는다 |
| 채팅 패널 메시지 | 3초 | 보이는 탭만. `after` 로 마지막 이후만. 전송 중에는 `pausePolling` |
| AI 재구성 끝 확인 `rebuild-status` | 2초 | 방금 보낸 글의 재구성을 기다리는 동안만, 최대 90초 ([chat-post.md](chat-post.md)) |

**이 표의 앞 두 줄은 PR #17(`fix/request-volume`) 기준이다.** 머지 전 main 은 알림 2.5초 · 채팅 3초이고 둘 다 숨긴 탭에서도 돈다.

### 3. MCP 스트림 GET 에는 405

Streamable HTTP 클라이언트는 서버가 먼저 보낼 메시지를 받으려고 `GET`(`Accept: text/event-stream`)을 연다.
규약상 서버는 SSE 를 열거나 **405** 로 답해야 한다. 200 JSON 을 주고 끊으면 클라이언트는 스트림이 끊긴 것으로 보고 곧바로 다시 여는 것으로 보인다(초당 약 12건).
로그에 클라이언트 정보가 없어 반복하는 주체를 직접 확인하지는 못했다.

- `app/api/ip-mcp/[[...path]]/route.ts` 의 `GET` — `Accept` 에 `text/event-stream` 이 있으면 `405` · `Allow: POST, OPTIONS` (PR #17).
- `.well-known/*` · `/authorize` · `/download` · 그 밖의 일반 GET(서버 정보 JSON)은 그대로다.
- 새 MCP · SSE 엔드포인트를 만들면 스트림 GET 을 처음부터 따로 처리한다.

## 조사하는 법

한도 메일(75%)이 오면 그날 로그를 떠서 경로별로 센다.

- `vercel logs --json --limit 5000` — 5,000건이 최대라 운영에서는 **최근 몇 분치**만 온다.
  24시간 경로별 비율은 이 방법으로 낼 수 없다. 짧은 구간을 여러 번 떠서 시간당 속도를 본다.
- `--query "path:…"` 필터는 먹지 않았다 — 받은 뒤 직접 거른다.
- `vercel usage` 는 무료 플랜에서 `Costs not found (404)`. 프로젝트별 사용량은 대시보드에서만 본다.

## 관련

- 경위: [troubleshootings/pr-traps-2026-09.md](../troubleshootings/pr-traps-2026-09.md) PR #17
- MCP 서버: [omnis-mcp.md](omnis-mcp.md)

---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-22-ops-metrics.md
last_verified: 2026-10-22
---

# 운영 장부 — 가동률 · 주간 에러 · 월 비용

12월 말까지 3개월치 운영 실측을 남기는 곳이다. 왜 이렇게 남기는지는 [`../plans/2026-10-22-ops-metrics.md`](../plans/2026-10-22-ops-metrics.md).
사용·AI 호출 지표는 여기 적지 않는다 — `KpiDaily` 가 매일 쌓는다(`scripts/kpi-export.ts --compute`).

**사람 이름 · 업무명 · 채팅 원문은 적지 않는다.** Vercel 에러의 표본 메시지에 업무명이 섞여 나오니 묶음 이름까지만 옮긴다.

## 기록하는 법

| 언제 | 무엇 | 어떻게 |
|---|---|---|
| 매주 월요일 | 지난주(월~일, KST) 런타임 에러 | Vercel MCP `get_runtime_errors` (since/until 로 그 주를 준다. 7일이 지나면 사라진다) 또는 대시보드 Observability → Errors. 묶음 이름 · 건수 · 처음/마지막(UTC) · 경로를 아래 표에 |
| 매월 초 | 지난달 가동률 · 장애 | `npx tsx scripts/uptime-report.ts --from YYYY-MM-01 --to YYYY-MM-말일` 의 출력 세 줄을 아래 표에. Actions 실행 기록은 90일 뒤 사라질 수 있다 |
| 매월 초 | 지난달 인프라 비용 | GCP · Neon · Vercel 콘솔의 청구서 금액. **출처를 같이 적는다** — 청구서 금액인지, 배분 결정인지 |

## 가동률 · 장애 (월)

`uptime` 워크플로가 30분마다 `/login` · `/api/health` 를 친다. 머지 뒤부터 쌓인다.
가동률 분모는 실제로 돈 회차다(GitHub 예약 실행은 늦거나 건너뛸 수 있다). 30분보다 짧은 장애는 놓칠 수 있다. DB 가용성은 재지 않는다.

| 달 | 센 회차 | 성공 | 가동률 | 장애 | 복구 시간 | 비고 |
|---|---|---|---|---|---|---|

## 런타임 에러 (주)

| 주 (KST) | 묶음 | 건수 | 처음 ~ 마지막 (UTC) | 경로 | 비고 |
|---|---|---|---|---|---|
| 10/15~10/21 | Gemini 일일 토큰 한도 초과 (embedTexts.RETRIEVAL_QUERY) | 4 | 10-19 02:08 ~ 04:49 | /api/ip-mcp | 코드 상한 100만 토큰/일. 장애 후보 — 아래 |
| 10/15~10/21 | Gemini 일일 토큰 한도 초과 (omnisAsk.route) | 3 | 10-19 02:07 ~ 02:08 | /api/ip-mcp | 같은 원인 |
| 10/15~10/21 | Gemini 일일 토큰 한도 초과 (column/drafts) | 1 | 10-19 06:48 | /api/website/column/drafts | 같은 원인 |
| 10/15~10/21 | record-proposals 추출 실패 (TimeoutError) | 3 | 10-20 01:48 ~ 10-21 01:20 | Vercel 표기 /api/website/media/… | AI 호출 타임아웃. 경로는 Vercel 이 붙인 값이라 실제 호출 지점과 다를 수 있다 |
| 10/15~10/21 | ai/draftCardUpdate 초안 실패 (TimeoutError) | 1 | 10-20 01:48 | 〃 | 같은 시각 타임아웃 |
| 10/15~10/21 | ai/detectKnowledge 판정 실패 (TimeoutError) | 1 | 마지막 10-20 01:48 | 〃 | 같은 시각 타임아웃 |
| 10/15~10/21 | DeprecationWarning DEP0169 `url.parse()` | 1 | 마지막 10-20 07:57 | /api/ip-mcp | 경고. 장애 아님 |

10/15~10/21 합계: 7묶음 · 14건. 2026-10-22 에 Vercel MCP `get_runtime_errors`(since 2026-10-14T15:00Z, until 2026-10-21T15:00Z)로 옮겼다.

### 장애 기록

자동 장부(uptime)가 생기기 전에 에러 묶음에서 찾은 것. 「장애」는 사용자 기능이 실패로 끝난 경우다.

| 시각 (UTC) | 무엇 | 영향 | 끝 | 근거 |
|---|---|---|---|---|
| 10-19 02:07 ~ 늦어도 10-20 00:00 | Gemini 일일 토큰 상한 100만 도달 (에러 메시지의 분모) | AI 질문 · 검색 임베딩 · 칼럼 초안 호출이 거절됐다 (8건, 마지막 06:48) | 상한은 서버 시각 0시에 풀린다 — `lib/gemini-usage.ts` 가 `startOfDay(new Date())` 로 세고 Vercel 함수는 UTC 다(한국 09시). 그 사이 언제 다시 됐는지는 기록이 없다 | 위 표의 한도 초과 묶음 3개 |

화면 오류는 `/api/errors` 가 GitHub 이슈로도 남긴다(`lib/github-issue.ts`, 운영에 `GITHUB_ISSUE_TOKEN` 이 있을 때). 9/28 이후 이 저장소 이슈는 0건이다(2026-10-22 `gh issue list --search "created:>=2026-09-28"`).

## 인프라 비용 (월)

| 달 | 항목 | 금액 | 출처 |
|---|---|---|---|
| 상한 | GCP (Gemini 포함) | 40,000원 | **배분 결정** 2026-10-07 — 회사 인프라 월 상한 50,000원 중. 청구액이 아니다 |
| 상한 | Neon | 10,000원 | **배분 결정** 2026-10-07 — 같은 상한 중. 청구액이 아니다 |
| 2026-09 | GCP · Neon | (미기록) | 콘솔 청구서에서 옮긴다 |
| 2026-09 · 10 | Vercel | 0원으로 보인다 | 청구 API `GET /v1/billing/charges` 가 `costs_not_found` (2026-10-21). 무료 플랜으로 본다 — 대시보드에서 확인 필요 |
| 2026-10 | GCP · Neon · Vercel | (11월 초에) | |

---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-29-omnis-agent.md
last_verified: 2026-10-29
---

# 옴니스 메신저 3단계 — 에이전트 런타임 · 확인 흐름 구현 · 실측

계획: [`../plans/2026-10-28-omnis-messenger-agent.md`](../plans/2026-10-28-omnis-messenger-agent.md) 3단계 · 「실행 모델」 · 「folding 에서 가져올 것」.
브랜치 `feat/omnis-agent`(feat/omnis-messenger 1·2단계 위), 워크트리 `../omnis-agent`. 1·2단계 결과: [`2026-10-28-omnis-messenger.md`](2026-10-28-omnis-messenger.md).

## 커밋

| 커밋 | 내용 |
|---|---|
| `2813f65` feat(agent): 옴니스 1:1 방을 에이전트 런타임으로 — 쓰기는 확인 카드를 거친다 | 스키마 · 런타임 · API · 단위 시험 · 검증 스크립트 · 계획서 사본 갱신 |
| `0df27d8` feat(agent): 막힌 카드에도 비밀 값은 가려 남긴다 | 화면 확인 중 찾은 것 — 막힌 카드의 전 → 후 표에 비밀 값이 그대로 남던 것 |
| `6d5b195` feat(agent): 옴니스 방에서 답을 흘려 보이고, 쓰기는 확인 카드로 묻는다 | 화면(스트림 · 카드) · 시나리오 스크립트 · 스크린샷 |
| (이 문서) docs(agent) | 결과 문서 |

## 고정한 패키지

전부 `^` 없이. 2주 넘게 지난 짝 버전으로 골랐다 — 처음 설치한 최신(ai 7.0.156 · @ai-sdk/workflow 2.0.88)은 하루 전 것이라
pnpm 공급망 정책이 `minimumReleaseAgeExclude` 를 덧붙였다. `@ai-sdk/workflow` 가 `ai` 를 정확한 버전으로 물고 있어 그 짝을 따랐다.

| 패키지 | 버전 | 배포일 |
|---|---|---|
| `ai` | 7.0.140 | 2026-10-14 |
| `@ai-sdk/workflow` | 2.0.72 | 2026-10-14 (ai 7.0.140 고정) |
| `workflow` | 5.2.2 | 2026-10-13 |
| `@ai-sdk/openai` | 4.0.93 | 2026-10-13 |
| `@ai-sdk/anthropic` | 4.0.79 | 2026-10-12 |
| `@ai-sdk/google` | 4.0.95 | 2026-10-13 |
| `@ai-sdk/react` | 4.0.143 | (ai 7.0.140 짝. 지금 화면은 쓰지 않는다 — 남은 문제 8) |
| `@workflow/serde` | 5.0.0 | 2026-09-30 |

세 프로바이더 모두 `@ai-sdk/provider 4.0.27` · `provider-utils 5.0.59` 로 `ai` 와 같다. `pnpm-workspace.yaml` 에
`@swc/core` · `cbor-extract` 설치 스크립트를 **false** 로 적었다 — workflow 가 끌어오는 것인데 플랫폼별 미리 빌드한 패키지가 함께 깔려 할 일이 없다.

## 스키마 — 추가만

| 마이그레이션 | 무엇 |
|---|---|
| `20261029000000_agent_runtime` | `enum AgentRunStatus` · `enum AgentStepStatus` · 표 `AgentRun` · `AgentStep`(→ AgentRun cascade) · `AiUsage` |
| `20261029010000_agent_run_sources` | `AgentRun.sources jsonb default '[]'` — 답의 각주 [n] 이 가리키는 검색 조각. 확인으로 실행이 나뉘어도 번호가 이어지게 |

- 기존 칸 삭제 · 이름 변경 없음. `GeminiUsage` 그대로
- `AgentRun.userId · roomId`, `AiUsage.userId · roomId · runId` 는 **관계 없는 문자열**이다. User · ChatRoom 모델을 고치지 않았다 —
  feat/omnis-messenger 가 같은 때 두 모델에 칸을 더하고 있어 머지에서 겹치지 않게, 그리고 사용 기록은 방 · 사람이 바뀌어도 남아야 해서
- 로컬(5433)에만 적용. 대상 호스트를 먼저 확인하고 이 워크트리에서 `prisma migrate deploy`:

```
로컬 5433 확인
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
50 migrations found in prisma/migrations
Applying migration `20261029000000_agent_runtime`
All migrations have been successfully applied.
…
Applying migration `20261029010000_agent_run_sources`
All migrations have been successfully applied.
```

마이그레이션 SQL 은 `prisma migrate diff --from-schema-datamodel <HEAD 스키마> --to-schema-datamodel <새 스키마>`(DB 를 건드리지 않는 파일끼리 비교)로 만들었다.
상대 브랜치 마이그레이션이 섞여 `migrate deploy` 가 실패하는 일은 이번에 없었다.
규칙 23(Zod 동시): 새 API 입력은 `lib/schemas/agent.ts`. 새 표뿐이라 백필은 없다.

## 확인 흐름이 실제로 도는 방식

사용자가 옴니스 방에 글을 보내면 `POST /api/agent/rooms/[roomId]`(새 대화는 `/api/agent/rooms`)가 질문 글을 남기고 `AgentRun`(대화 = 방의 이전 글 + 이번 질문)을 만든 뒤
`start(omnisAgentWorkflow, [runId])` 로 Workflow 를 한 번 연다. 이 한 번이 「한 구간」이다. 구간 안에서 `WorkflowAgent` 가 모델(gpt-6.1-sol, reasoning medium)과
도구를 오가며, 읽기 도구는 "use step" 으로 바로 돌고, 쓰기 도구(`needsApproval: true`)를 부르면 SDK 가 HMAC 서명한 승인 요청을 내고 멈춘다. 구간 끝(`savePass`)에서
사용량을 `AiUsage` 에 호출마다 한 줄 남기고, 승인 요청마다 `AgentStep` 카드를 만든다 — 대상 업무 · 카드의 지금 값을 DB 에서 읽어 전 → 후 표를 만들고,
입력에 비밀이 보이면 BLOCKED(값은 가림), 아니면 PENDING 과 `planHash = sha256(run · toolCallId · 도구 · 입력 · 카드)`. 실행은 AWAITING_APPROVAL 로 두고 Workflow 는 끝난다 — 기다리며 열려 있는 요청이 없다.
화면은 스트림을 끝까지 읽은 뒤 방 상태를 DB 에서 다시 읽어 카드를 그린다. [확인] 은 `POST /api/agent/steps/[id] { decision, planHash }` 로 가서,
본인 카드인지 · PENDING 인지 · 해시가 같은지 · 비밀이 없는지 본 뒤 `status=PENDING AND planHash=…` 조건부 갱신으로 APPROVED 로 바꾼다(동시에 두 번 눌러도 하나만 통과).
그 구간의 카드가 다 정해지면 DB 의 대화에 `tool-approval-response` 를 붙이고 AWAITING → RUNNING 도 조건부로 바꾼 뒤 같은 실행으로 Workflow 를 다시 연다.
SDK 가 서명을 확인하고 승인된 도구를 실행하면, 실행 단계(`writeTool`)가 한 번 더 카드를 대조(APPROVED · 같은 도구 · 같은 입력 · 비밀 없음)하고
APPROVED → EXECUTED 조건부 갱신을 잡은 경우에만 MCP 와 같은 `runTool` 을 요청한 사람의 권한으로 부른다. 결과는 카드에 남고 모델이 이어서 답을 쓴다.
[취소] 는 approved=false 응답을 붙여 같은 방식으로 이어 가고, 모델이 「취소했다」 고 답한다. 비밀 · 대상 없음으로 전부 막힌 구간은 사람이 누를 것이 없어
거절 응답을 붙여 곧바로 한 구간 더 돈다(최대 3구간). 새 글을 보내면 확인을 기다리던 앞 실행은 CANCELLED, 카드는 EXPIRED 가 된다.
턴(모델 호출) 12회 · 200원 상한은 `stopWhen` 이 구간을 넘어 합산해 보고, 닿으면 그 사실을 방에 남긴다. 새로고침하면 방 화면이 DB 의 글 · 카드 · 돌고 있는 실행을 읽고,
돌고 있으면 `GET /api/agent/runs/[id]/stream` 으로 같은 Workflow 스트림에 다시 붙는다.

### 위험 등급 · 도구

| 등급 | 도구 | 처리 |
|---|---|---|
| 읽기 | search_knowledge · ip_overview · list_tasks · get_task · list_projects · list_members · crm_overview · find_org · list_omnis_cards · get_omnis_card · list_weekly_reports · list_chat · list_notifications · company_profile · list_company_records · list_record_proposals · list_tax_invoices · list_staff · list_market_companies · get_context · (지식재산권) list_stages · list_ip · get_ip · list_todo | 자동. 지식재산권은 `runTool` 이 구성원이 아니면 거절, `list_staff` 연락처는 관리자만 — 요청한 사람의 Caller 그대로 |
| 쓰기 | create_task · update_task(상태 · 마감 · 우선순위 · **담당** · 이름 · 프로젝트 · 배경) · update_checklist · post_message(업무방만, task 필수) · write_omnis_card · save_company_record | 확인 카드 |
| 열지 않음 | delete_company_record · respond_notification · decide_record_proposal · write_weekly_report · upload_file · create_upload_link · 지식재산권 쓰기 · update_task 의 archived · post_message 의 files | — |

MCP `update_task` 에 `assignees` 가 없어서 **같은 함수(`updateTask` 의 assigneeIds)로 MCP 에 더했다** — 에이전트 전용 지름길을 두지 않았다.

### 모델 · 비밀 키

- 설정 한 곳: `lib/ai-models.ts`(기능별 기본값 + `OMNIS_AGENT_MODEL=vendor:model` · `OMNIS_AGENT_REASONING`), 상한 `OMNIS_AGENT_MAX_TURNS` · `OMNIS_AGENT_MAX_KRW`
- 요금표 한 곳: `lib/ai-pricing.ts`. gpt-6.1-sol $2.00 / 캐시 $0.10 / 출력 $10.00 (developers.openai.com/api/docs/pricing, 2026-10-28). 원/달러 1,380
- OpenAI 는 `store: false` + `include: ["reasoning.encrypted_content"]` — 대화를 OpenAI 쪽에 남기지 않는다
- **모델 객체를 껍데기(`lib/agent/model.ts` OmnisLanguageModel)로 감쌌다.** `@ai-sdk/openai` 모델을 그대로 WorkflowAgent 에 주면 Workflow 직렬화(provider-utils
  `serializeModelOptions`)가 `headers()` 를 풀어 **Authorization 헤더(API 키)가 Workflow 이벤트 기록에 남는다**. 껍데기는 vendor · 모델 id 만 넘기고 실제 모델은 모델 단계 안에서 env 로 만든다.
  로컬 기록을 풀어서(base64 + zstd) 확인했다:

```
$ node scripts/agent-scan-workflow-data.mjs
파일 81 · 푼 덩어리 28 · 모델 이름이 보인 곳 12 (풀기가 됐는지 대조용)
✓ 비밀 4종(OPENAI_API_KEY · ANTHROPIC_API_KEY · GEMINI_API_KEY · OMNIS_AGENT_APPROVAL_SECRET) 없음
```

### 비밀 옮김 막기

- 코드: `lib/agent/secrets.ts` — 비밀번호(열쇠말 + 값처럼 생긴 4자 이상), 인증 정보(sk- · AIza · ghp_ · Bearer · JWT · 개인 키 · hadd_ 토큰 · 비밀번호 든 DB 주소 · 인증번호 · Luhn 맞는 카드번호), 개인 식별번호(주민 · 외국인등록 · 운전면허 · 여권)
- 검사 자리 넷: 카드를 만들 때(BLOCKED) · 승인할 때 · 실행 직전 · 막힌 카드의 표(값을 `ha••••` 로 가림)
- 시스템 프롬프트에도 규칙(`lib/agent/prompt.ts` 「비밀 정보」)
- 「비밀번호 재설정 안내」 · 「API 키 발급 절차」 · 날짜 · 금액 · 전화 · 사업자번호 · 과제번호는 걸지 않는다(시험)

## 검증

### 품질 게이트

```
$ pnpm run verify
verify exit 0
✖ 37 problems (0 errors, 37 warnings)     ← 경고는 모두 이번에 손대지 않은 파일. 2단계 때 38

$ pnpm run test:unit
ℹ tests 82
ℹ pass 82
ℹ fail 0
```

이번에 더한 단위 시험 31건(51 → 82): `lib/agent/approval.test.ts`(확인 없이 쓰기 불가 · 재사용 승인 거부 · 해시 · 남의 카드 · 막힌 카드 · 승인/실행 직전 비밀),
`lib/agent/secrets.test.ts`(막아야 하는 것 · 걸지 말아야 하는 것 · 가리기), `lib/agent/limits.test.ts`(턴 12 · 200원 · 구간 합산 · 요금 · 모델 설정),
`lib/agent/messages.test.ts`(승인 요청 · 응답 · 화면 스트림 접기).

`pnpm run build` 는 **돌리지 않았다** — 작업 지시(next build 금지). withWorkflow 가 빌드를 바꾸므로 머지 전에 꼭 돌려야 한다(남은 문제 1).

### 지킴 — `BASE=http://localhost:3103 pnpm exec tsx --env-file=.env scripts/verify-agent.ts`

도구 실행 함수와 확인 API 를 직접 친다. 모델은 [4] 에서 한 번(서명 없는 승인을 이어 가 보는 것).

```
대상 DB: localhost:5433 · 서버: http://localhost:3103
A=윤훈 · B=팀장
[1] 확인 카드 없이 쓰기
  ✓ 카드가 없는 도구 호출은 실행하지 않는다 (거부되어야 하는 경우)
  ✓ 업무가 생기지 않았다
[2] 확인 전(PENDING)에 쓰기
  ✓ PENDING 카드로는 실행하지 않는다 (거부되어야 하는 경우)
  ✓ 업무가 생기지 않았다
[3] 확인 API
  ✓ 남의 카드는 404 (거부되어야 하는 경우)
  ✓ 화면과 다른 해시는 409 (거부되어야 하는 경우)
  ✓ 로그인 없이 401
  ✓ 거부된 요청 뒤에도 카드는 PENDING
[4] 같은 승인을 동시에 두 번 · 서명 없는 승인 요청
  ✓ 하나만 통과하고 하나는 409 (거부되어야 하는 경우)
  ✓ 끝난 뒤 같은 승인을 다시 보내도 409 (거부되어야 하는 경우)
  ✓ 서명 없는 승인 요청은 SDK 가 실행하지 않는다 — 업무가 생기지 않았다 (거부되어야 하는 경우)
  ✓ 카드는 APPROVED 로 남고 EXECUTED 가 아니다
    이어 간 실행: DONE · 모델 1회 · 1.49원
[5] 승인된 카드는 한 번만 실행
  ✓ APPROVED 카드로 실행된다
  ✓ 업무가 하나 생겼다
  ✓ 같은 카드로 다시 실행하지 않는다 (거부되어야 하는 경우)
  ✓ 업무는 여전히 하나
[6] 비밀이 든 제안
  ✓ APPROVED 로 바꿔 넣어도 비밀이 있으면 실행하지 않는다 (거부되어야 하는 경우)
  ✓ 지식 카드가 생기지 않았다
  ✓ 카드는 EXECUTED 가 아니다
[7] 모델이 비밀을 넣어 제안해도 — 구간 저장(savePass)이 카드를 막는다
  ✓ 카드는 BLOCKED 로 만들어진다 (거부되어야 하는 경우)
  ✓ 막은 이유에 비밀번호가 있고 값은 가린다
  ✓ 카드 표(preview)에는 값을 가려 남긴다
  ✓ 사람이 누를 것이 없으니 거절 응답을 붙여 곧바로 이어 간다
  ✓ 붙인 응답은 approved=false
  ✓ BLOCKED 카드는 확인 API 로도 승인할 수 없다 (거부되어야 하는 경우)
  ✓ 지식 카드가 생기지 않았다
    방 /chat/7c62d0f3-d8db-41f1-9519-19147cb73fd1
전부 통과
```

[5] 는 실제로 업무를 하나 만든다(`[검증 hh:mm:ss] 확인 없이 만들면 안 되는 업무`, 로컬 DB). 그때 임베딩 동기화가 실패 로그를 낸다 — 로컬 `.env` 의 Gemini 키 잔액이 0 이다(남은 문제 5).

### 화면 시나리오 — `TOKEN=… BASE=http://localhost:3103 node scripts/agent-scenarios.mjs <n> [roomId]`

dev `env -u GEMINI_API_KEY NEXTAUTH_URL=http://localhost:3103 pnpm next dev --webpack -p 3103`, 로그는 파일로. 로그인은 로컬 `NEXTAUTH_SECRET` 으로 만든 세션 쿠키(`scripts/agent-cookie.ts`, 정우창).
실제 모델 gpt-6.1-sol. 스크린샷은 모두 문서 가로 넘침 0px.

| # | 무엇 | 결과 |
|---|---|---|
| 1 | 읽기 질문 1턴 (「이번 주(10/26~11/1) 마감인 업무를 담당자와 함께 정리해 줘」) | 스트림으로 표가 흘러나오고 끝난 뒤 방에 답이 남음. 「업무 목록 ✓」 도구 칩. **이어서 2턴 질문을 보내고 1.5초 뒤 새로고침** → 돌던 실행에 다시 붙어 2초 만에 답이 붙음(「그 업무들 중 지연된 업무는 1건입니다.」) |
| 2 | 「에이전트 확인 흐름 점검」 마감 2026-11-12 · 우선순위 높음 → 카드 → [확인] | 카드 4.7초(마감 2026-11-05 → 2026-11-12, 우선순위). [확인] 뒤 5.7초에 카드 「실행됨」 + 「고쳤습니다 … 바뀐 필드: priority, deadline」 + 답. DB 아래 |
| 3 | [취소] (4 에서 남긴 「완료로」 카드, 375) | 카드 「취소함」, 2.4초 뒤 답 「사용자가 변경을 취소하여 … 완료로 바뀌지 않았습니다. 현재 상태는 ‘할 일’」. 상태 TODO 그대로, status 이력 0건 |
| 4 | 「그 업무 상태를 완료로 바꿔 줘」 → 카드 → 새로고침 (375 · 1440) | 새로고침 뒤 카드가 그대로(「할 일 → 완료」 · [취소] [확인]). 다른 창(1440)에서 열어도 같은 카드 |
| 5 | 공용 PC 비밀번호를 지식 카드로 | **sol 은 쓰기 도구를 부르지 않고 거절**: 「비밀번호는 지식 카드에 기록할 수 없습니다. 아래처럼 비밀번호를 제외하고 만들까요?」 — 카드 0, OmnisCard 0. 모델과 무관한 코드 차단을 보려고 dev 를 `OMNIS_AGENT_MODEL=openai:gpt-6-luna` 로 다시 띄워 두 문구를 더 시도했으나 luna 도 값을 스스로 뺐다(「비밀번호는 지식 카드에 기록하지 않습니다」 · 「라이선스 코드 [비공개 정보]」 — 값 없는 PENDING 카드). 그래서 코드 차단은 verify-agent [7] 이 만든 막힌 카드로 화면을 확인했다 — 버튼 0, 「비밀번호로 보이는 값(ha••••••)이 들어 있어 실행하지 않습니다」 |

시나리오 2 의 DB(로컬):

```
[전] 에이전트-확인-흐름-점검|TODO|HIGH|2026-11-05 14:59:59
[후] 에이전트-확인-흐름-점검|TODO|HIGH|2026-11-12 14:59:59
TaskEvent: mcp|deadline|"2026-11-05T14:59:59.000Z"|"2026-11-12T14:59:59.000Z"|2026-10-29 02:04:24.757
AgentStep: EXECUTED|update_task|{"task": "에이전트-확인-흐름-점검", "deadline": "2026-11-12", "priority": "HIGH"}
```

우선순위는 시나리오 전에 이미 HIGH 였다 — 클릭 문제를 재현하던 탐침이 같은 흐름(카드 → [확인])으로 바꿔 둔 것이다(카드 EXECUTED, 실행 DONE). 그래서 이 실행에서 실제로 바뀐 칸은 마감이다.
시나리오 3 의 DB: `에이전트-확인-흐름-점검|TODO|HIGH|2026-11-12` · status 이력 0건 · 카드 `REJECTED|update_task|{"task": …, "status": "DONE"}`.

응답 시간 — 같은 서버에서 SSE 를 직접 읽은 한 번(2턴 질문 「그중 지연된 것만 한 줄로」):

```
  1.07s start
  3.37s tool-input-start     (list_tasks)
  3.90s tool-output-available
  5.43s text-start
  6.34s text-end
  6.46s finish
```

2단계는 같은 종류의 질문에서 답이 다 올 때까지 7.1~11.3초 스켈레톤이었다. 이제 1초 안에 「생각하는 중」 칸, 3~4초에 도구 칩, 5초 남짓에 글이 흐르기 시작한다.

### 쓴 비용 — `AiUsage` (이번 작업 전부: 시나리오 · 재시도 · 탐침 · verify-agent 두 번)

```
 vendor |    model    | feature | calls | input  | cached | output | reasoning |  usd   |  krw
--------+-------------+---------+-------+--------+--------+--------+-----------+--------+-------
 openai | gpt-6.1-sol | agent   |    38 | 216498 | 193647 |   1933 |       303 | 0.0844 | 116.5
 openai | gpt-6-luna  | agent   |     4 |  21415 |  15581 |    741 |       548 | 0.0011 |   1.5
 합계   |             |         |    42 | 237913 | 209228 |   2674 |       851 | 0.0855 | 118.0

      status       | count | avg_turns | avg_krw | max_krw
-------------------+-------+-----------+---------+---------
 AWAITING_APPROVAL |     5 |       2.0 |     1.9 |     2.8
 DONE              |    17 |       1.9 |     6.4 |    28.4
```

**합계 118원**(목표 2,000원 안). 입력의 88% 가 캐시 읽기다 — 도구 정의 · 지시문이 매번 같아 OpenAI 프롬프트 캐시가 잡힌다. 첫 호출(캐시 없음)이 14.6원, 같은 앞부분의 둘째 호출이 2.4원이었다.
OpenAI 콘솔 청구와 대조하지는 않았다.

### 스크린샷 — `mydocs/working/omnis-agent/`

| 파일 | 무엇 |
|---|---|
| `1440-1-streaming-start.png` · `1440-1-streaming-text.png` | 보낸 직후 「생각하는 중」 칸 · 표가 흘러나오는 중 |
| `1440-1-answer.png` · `375-1-answer.png` | 1턴 답 |
| `1440-1-after-reload.png` | 답하는 도중 새로고침 → 다시 붙어 2턴 답이 붙음 |
| `1440-2-card.png` · `375-2-card.png` | 업무 고치기 확인 카드(마감 전 → 후) |
| `1440-2-executed.png` · `375-2-executed.png` | [확인] 뒤 「실행됨」 + 실행 결과 + 답 |
| `1440-4-after-reload.png` · `375-4-after-reload.png` | 카드 대기 중 새로고침 — 카드가 남음 |
| `375-3-rejected.png` | [취소] 뒤 「취소함」 + 답 |
| `1440-5-secret.png` · `375-5-secret.png` | 비밀번호 카드 요청 — sol 이 거절하고 비밀번호를 뺀 안을 제안 |
| `1440-5-secret-license.png` · `375-5-secret-license.png` | luna 에 API 키를 「라이선스 코드」 로 넣게 한 시도 — luna 가 `[비공개 정보]` 로 바꿔 제안 |
| `1440-5-blocked-card.png` · `375-5-blocked-card.png` | 코드 차단 — 막힌 카드, 버튼 없음, 값 가림 |

## 운영 반영에 필요한 것

### 1. 운영 migrate — 먼저, 머지는 나중

1. 운영 DB 를 가리키는지 호스트를 찍어 확인한 뒤 `pnpm run db:deploy`. 적용 순서는 파일 이름 순:
   `20261028010000_chat_room_kinds`(1·2단계) → feat/omnis-messenger 쪽 방 목록 마이그레이션(읽음 · 즐겨찾기 · 폴더, 그 브랜치 이름대로) → `20261029000000_agent_runtime` → `20261029010000_agent_run_sources`.
   모두 추가만 하는 변경이라 지금 운영 코드는 그대로 돈다
2. 그 다음 머지. 순서는 nav 계획대로 nav → 메신저(1·2단계 + 방 목록) → 이 브랜치
3. migrate 전에 이 코드가 나가면: 옴니스 방 화면이 `AgentStep` · `AgentRun` 을 읽다 오류가 난다(`loadAgentRoom`)

### 2. Vercel 환경변수 (omnis-hadd, Production · Preview)

| 이름 | 값 | 없으면 |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI 키 | 에이전트 API 503 「AI 기능이 비활성화」 |
| `OMNIS_AGENT_APPROVAL_SECRET` | `openssl rand -base64 32` (32자 이상). 모든 인스턴스에 같은 값 | 503 — 서명 없이 승인을 받지 않는다. **바꾸면 기다리던 카드가 모두 무효**가 된다 |
| `OMNIS_AGENT_MODEL` | (선택) `vendor:model`. 기본 `openai:gpt-6.1-sol` | 기본값 |
| `OMNIS_AGENT_REASONING` | (선택) low · medium · high. 기본 medium | 기본값 |
| `OMNIS_AGENT_MAX_TURNS` · `OMNIS_AGENT_MAX_KRW` | (선택) 기본 12 · 200 | 기본값 |
| `ANTHROPIC_API_KEY` | 모델을 anthropic 으로 바꿀 때만 | — |

Workflow 는 Vercel 배포에서 Vercel World 가 자동으로 붙는다(따로 둘 env 없음). 데모(`omnis`) 프로젝트에 `OPENAI_API_KEY` 를 넣지 않으면 데모의 옴니스 방은 503 이다 — 데모에서 열지 정해야 한다.

### 3. Hobby 에서의 Workflow 한도

- 계획서 표(작업지시자 2026-10-28): **Hobby 는 상업적 사용 불가 · Workflow 이벤트 월 5만 개 포함.** 이번에 Vercel 문서로 다시 확인하지는 못했다(문서 검색에 Workflow 요금 항목이 잡히지 않았다)
- 로컬 실측 — Workflow 실행(=구간) 24개의 이벤트 수: 평균 24.9 · 중앙 24 · 최소 15 · 최대 39. 읽기 질문은 1구간, 쓰기는 확인 전 · 후 2구간
- 로컬 이벤트 수가 Vercel 의 청구 이벤트와 같다고 치면: 하루 50질문(쓰기 20%) × 22일 ≈ 1,320구간 × 25 ≈ **월 3.3만 이벤트** — 5만 안이지만 여유가 크지 않다. 하루 80질문이면 넘는다
- 실행당 한도: Vercel World 는 한 실행의 이벤트 · 단계 수에 상한이 있다(workflow 문서 「Per-run limits」). 우리 구간은 최대 39 이벤트라 멀다
- 라우트 `maxDuration = 300`. 로컬에서 가장 긴 구간이 수십 초라 닿지 않았지만, Hobby 의 함수 시간 상한이 300초를 허용하는지는 확인하지 않았다
- Vercel 에서는 브라우저가 끊겨도 스트림 함수가 바로 끝나지 않고 다시 붙기를 시도한다(workflow 문서 streaming). 우리 Workflow 는 끝에 스트림을 직접 닫아 이 시간을 줄인다

## 남은 문제

1. ~~**`pnpm run build` 를 돌리지 않았다.**~~ → 아래 「A 합치기」 에서 돌렸다(exit 0). `withWorkflow` 가 webpack 설정과 `/.well-known/workflow/*` 경로를 더한다. dev 에서는 「Compiled workflows (30 steps, 1 workflow)」 로 돈다. 머지 전에 운영 env 를 읽지 않는 곳에서 빌드를 돌려야 한다(이 워크트리에는 `.env.production.local` 이 없다 — 작업지시자 판단)
2. ~~**기존 Gemini 질문 경로(`/omnis/ask` · MCP `ask_omnis` · `askOmnisRoute`)는 쓰기 도구를 확인 없이 연다.**~~
   → `fix/ask-route-readonly`(c230377) merge 로 해결 — 빼는 목록 `ROUTE_TOOL_EXCLUDE` 대신 여는 목록 `ROUTE_READ_TOOLS`(읽기만). 아래 「A 합치기」.
   원래 내용: `ROUTE_TOOL_EXCLUDE` 가 4개(ask_omnis · post_message · create_task · search_knowledge)만 빼서 update_task · update_checklist · write_omnis_card · save_company_record · delete_company_record · respond_notification · write_weekly_report · decide_record_proposal · upload_file 이 Gemini 에 열려 있다. 지시대로 그 경로는 건드리지 않았다 — 막을지 정해야 한다
3. 쓰기의 변경 이력이 `via=mcp` 로 남는다 — `runTool` 이 updateTask · 체크리스트에 "mcp" 를 넘긴다. 에이전트가 한 것을 따로 세려면 runTool 에 출처 인자가 필요하다
4. 비밀 값은 카드 표에서는 가렸지만 **실행의 대화(`AgentRun.messages`)와 카드 입력(`AgentStep.input`)에는 모델이 낸 그대로 남는다.** 이어 가기(SDK 서명 · 입력 대조)에 그대로 필요해서다. 막힌 실행이 끝난 뒤 지우거나 가리는 정리는 아직 없다. Workflow 이벤트 기록(로컬 `.next/workflow-data`, 운영은 Vercel)에도 도구 입력 · 결과가 남는다
5. 로컬 `.env` 의 `GEMINI_API_KEY` 도 잔액이 0 이다(402 「prepayment credits are depleted」). 그래서 로컬에서 쓰기 뒤 임베딩 동기화가 실패하고, `search_knowledge` 의 질문 임베딩도 실패할 수 있다 — 이번 시나리오에서 모델이 search_knowledge 를 부르지 않아 그 경로는 확인하지 않았다
6. 시나리오 5 의 코드 차단은 화면에서 모델이 일으키지 못했다 — sol · luna 모두 프롬프트 규칙대로 값을 뺐다. 코드 차단은 단위 시험 · verify-agent [6] [7] · 그 결과 카드의 화면으로 확인했다
7. dev 서버에서 같은 방을 다른 창으로 열 때 열려 있던 창이 통째로 다시 읽히는 일이 두 번 있었다(Playwright 「Execution context was destroyed」, 로그의 `GET /chat/{id}` 두 줄). dev 의 경로 다시 컴파일로 본다 — 375 촬영을 1440 조작 뒤로 옮긴 뒤로는 나오지 않았다. 운영 빌드에서는 확인하지 않았다
8. [고치기] 버튼은 넣지 않았다(선택 항목). `@ai-sdk/react` 는 설치만 했고 쓰지 않는다 — useChat 대신 DB 를 원본으로 두는 작은 SSE 읽기(`lib/agent/client-stream.ts`)를 썼다. 안 쓸 것으로 정하면 지운다
9. 로컬 DB 에 확인을 기다리는 실행 5개가 남아 있다(스크립트 재시도 · luna 시도의 카드). 새 글을 보내면 지나간다
10. 2단계의 `POST /api/chat/rooms`(새 대화 + Gemini 질문) · `POST /api/chat/rooms/[roomId]/ask` 는 남아 있고 화면은 더 부르지 않는다. 앞의 것은 방 목록 API 파일이라 다른 브랜치와 겹치지 않게 그대로 두었다. 머지 뒤 지운다
11. 좁은 화면 점검(`scripts/narrow-audit.mjs`)은 돌리지 않았다 — 로그인 비밀번호가 필요한 스크립트다. 1440 · 375 스크린샷은 모두 가로 넘침 0px, 카드 버튼은 `.touch-target`
12. 대화 문맥에는 앞 턴의 **글**만 들어간다(2단계와 같음). 앞 실행의 도구 결과 · 카드는 새 질문의 문맥에 없다

## A 합치기 · 5단계 · 데모 비용 (2026-10-29 오후)

작업지시자 승인 뒤 같은 워크트리(`../omnis-agent`, `feat/omnis-agent`)에서 이어 했다. 순서 A → B → C.

### 커밋

| 커밋 | 내용 |
|---|---|
| `96fea67` merge: feat/omnis-messenger | 2-b 방 목록(칩 · 폴더 · 안읽음 · 검색)과 폴더 수정. **충돌 없음** — `prisma/schema.prisma` 를 양쪽이 고쳤으나 다른 자리(AgentRun · AiUsage / ChatRoomPref · ChatFolder)라 자동 병합 |
| `a0e99c1` merge: fix/ask-route-readonly | 질문 경로를 읽기 도구만 여는 보안 수정(c230377, origin/main 위 — main 의 #107 지식재산권 날짜도 함께 들어옴). **충돌 `lib/omnis-ask.ts` 한 곳** — 메신저 2단계의 `HISTORY_RULE` 과 저쪽 `ROUTE_READ_TOOLS` 를 둘 다 살리고, 더는 쓰는 곳이 없는 `ROUTE_TOOL_EXCLUDE` 를 지웠다. `askOmnisRoute(…, { history, endpoint })` 는 충돌 밖이라 그대로 — 여는 도구만 읽기로 줄었다 |
| `385f6af` merge: feat/floating-nav (fa52a90) | 6b782fc 뒤 nav 커밋 셋(e23724f · 78aa3d5 · fa52a90). **충돌 없음** — `right-panel.tsx` 는 「Omnis AI」 탭 삭제(이쪽)와 `router.replace` → `history.replaceState`(저쪽)가 다른 줄. merge 뒤에도 탭은 없고 `useRouter` 도 남지 않았다 |
| `bedb128` feat(chat): 사람끼리 1:1 · 단톡방 | 5단계 |
| `3ea321e` merge: feat/floating-nav (9b15ec1) | 폰 마이 원을 하단 nav 로. **충돌 없음** — `floating-nav.tsx` 의 `CHAT_HOME_READY` · `/chat`(이쪽)과 하단 nav 54px(저쪽)가 다른 줄 |
| `d1d6832` feat(agent): 데모 비용 방어 | C |
| (이 문서) docs(agent) | 결과 · 운영 반영 · narrow-audit 세션 쿠키 |

`git fetch origin` 은 이 저장소의 fetch refspec 이 main 하나라 `origin/feat/floating-nav` 를 만들지 않는다. `git ls-remote origin feat/floating-nav` 로 원격 끝(fa52a90, 이후 9b15ec1)이 로컬 브랜치와 같은 것을 보고 로컬 `feat/floating-nav` 를 merge 했다. feat/e2e-guard 는 가져오지 않았다.

### A — 마이그레이션 · 빌드 · 게이트

```
$ pnpm exec prisma migrate deploy            # merge 뒤, 대상 호스트 확인
Datasource "db": PostgreSQL database "omnis", schema "public" at "localhost:5433"
54 migrations found in prisma/migrations
No pending migrations to apply.

$ ls .env.production*                        # 이 워크트리에 없다
no matches found: .env.production*

$ env -u GEMINI_API_KEY pnpm run build       # A 끝(merge 셋 뒤) · 그리고 B · C 를 마친 뒤 한 번 더 — 둘 다 exit 0
✓ Compiled workflows in 851ms (30 steps, 1 workflow)
- Environments: .env
✓ Compiled successfully in 18.4s
✓ Generating static pages using 11 workers (73/73) in 146.4ms
├ ƒ /.well-known/workflow/v1/flow
├ ƒ /.well-known/workflow/v1/webhook/[token]
├ ƒ /api/agent/rooms … /api/chat/people-rooms/[roomId]/members … /chat/new/people
```

빌드 경고는 `::highlight(chat-search-hit)` CSS 두 줄(전사방 검색, 이번에 손대지 않음)뿐이다. **3단계 남은 문제 1(빌드 안 돌림)은 이것으로 닫는다.**

```
$ pnpm run verify          # 마지막(C 뒤)
verify exit 0
✖ 37 problems (0 errors, 37 warnings)     ← 3단계와 같은 수. 이번에 고친 chat-panel · message-input 의 경고 3개는 고치기 전부터 있던 것(stash 로 대조)

$ pnpm run test:unit
ℹ tests 124
ℹ pass 124
ℹ fail 0
```

82(3단계) → 109(A 의 merge 셋 뒤, 들어온 브랜치의 시험 포함) → 124(이번 chat-people-rules 8 · agent/quota 7).

### B — 5단계: 사람끼리 대화

**방 종류 — `DM` 을 더했다(GROUP + 참여자 2명으로 두지 않았다).** 셋이던 단톡방에서 한 명이 나가면 참여자 2명의 GROUP 이 되는데, 「같은 두 사람의 1:1 은 하나」 를 참여자 수로 가리면 그 방을 1:1 로 잘못 연다. 1:1 은 초대 · 나가기 · 이름 바꾸기도 없어 종류로 가르는 편이 분기가 적다.
같은 두 사람의 방이 하나인 것은 `ChatRoom.dmKey`(두 id 를 정렬해 이은 값, unique)가 DB 에서 지킨다 — 동시에 서로를 골라도 P2002 를 받고 있는 방을 연다.

| 마이그레이션 | 무엇 |
|---|---|
| `20261029030000_chat_people_rooms` | `ALTER TYPE "ChatRoomKind" ADD VALUE 'DM'` · `ChatRoom.dmKey text` · unique 색인. 추가만. `prisma migrate diff`(HEAD 스키마 → 새 스키마) 출력과 같다. 로컬(5433)에만 적용 |

규칙 23(Zod 동시): `lib/schemas/chat-room.ts` 의 `CreatePeopleRoomSchema` · `RenamePeopleRoomSchema` · `InvitePeopleSchema`, 종류 목록 `CHAT_ROOM_KINDS` 에 DM. 새 칸은 새 방에만 쓰여 백필은 없다.

화면 · 동작:

- 「새 대화」 가 메뉴 둘 — **옴니스와 대화**(`/chat/new`, 예전 그대로) · **사람과 대화**(`/chat/new/people`)
- 사람 고르기(`PeoplePicker`): 이름 검색 · 여러 명 · 고른 사람 칩. 목록은 `GET /api/users`(로그인할 수 있는 구성원 — 시스템 계정 제외). 한 번에 30명까지
- 1명 → 「○○님과 1:1 대화」. 있으면 그 방이 열린다(200 `existing`). 2명 이상 → 「N명 단톡방 만들기」, 방 이름 칸은 참여자 이름을 이은 것(나는 맨 뒤, 40자 넘으면 「외 N명」)이 기본이고 고칠 수 있다
- 방: 전사방과 같은 `ChatPanel`(폴링 · 검색 · 답장 · 고치기 · 지우기). people 모드에서 @ 후보는 그 방 참여자만, `/업무` · `#업무` · 첨부 메뉴는 없다. 1:1 머리는 상대 이름, 단톡방 머리는 「단톡방 · N명 · 참여자만 보여요」 + 참여자 버튼
- 단톡방 참여자 창: 참여자 목록 · 방 이름 바꾸기 · **초대하기**(이미 있는 사람은 고를 수 없음) · **나가기**(AlertDialog 확인 — 규칙 11). 내보내기는 없다. 초대된 사람은 이전 대화도 본다
- 나가면 그 방이 내 목록에서 사라지고, 내 즐겨찾기 · 수동 폴더에서도 그 방을 지운다. 마지막 사람이 나가도 방 · 글은 지우지 않는다
- 목록: 「단톡방은 곧」 자리 대신 실제 방. 1:1 은 상대 이름 · 상대 아바타. 칩 · 폴더(수동 폴더에 넣기) · 안읽음 배지 · 즐겨찾기 · 검색은 2-b 그대로 탄다
- 멘션: `@이름` 이 **그 방 참여자**면 그 사람에게만 알림(`chat_mention`, 누르면 `/chat/<방>`). 방 밖 사람 이름은 맞아도 알림이 없다
- 옴니스는 들어가지 않는다. `@옴니스` 는 이번 범위 밖(작업지시자)

**참여자만 보게 — 방침: 사람끼리 나눈 대화는 사내 지식 색인(임베딩)에 넣지 않는다.** 옴니스 검색 · 기록 제안 · 피드 어디로도 나가지 않는다.

| 곳 | 어떻게 |
|---|---|
| 피드 · 사내 지식 색인 · 지표 messages.* · 업무방 목록 | 1단계부터 `kind = COMPANY` 허용 목록이라 DM · GROUP 은 새 코드 없이 빠진다(검증 [4]) |
| 글쓰기 | `POST /api/chat/messages` 가 DM · GROUP 이면 `postPeopleMessage`(`lib/chat-people.ts`) — 저장 · 방 시각 · 참여자 멘션 알림만. 업무 연결 · 재구성 · 임베딩 · ChatMention 을 하지 않는다. 고치기 · 지우기도 같은 이유로 그 셋을 건너뛴다 |
| 메시지 · 검색 API | 참여자가 아니면 403(1단계 그대로) · 글쓰기 · 방 정보 · 초대 · 이름 · 나가기는 404 |
| 방 화면 | 404(1단계 남은 문제 1 대로 본문 표식 `NEXT_HTTP_ERROR_FALLBACK;404`, 글은 내려가지 않음) |
| 목록 · 목록 검색 | 참여자 조건 |
| **답장 인용(새로 막음)** | 답장 대상은 같은 방 글만. 전사방 글에 1:1 글 id 를 `replyToId` 로 걸면 그 앞 80자가 전사방 인용으로 새던 길이 있었다 — 옴니스 1:1 방 글도 해당. 이제 400 |
| **기록 제안 크론(새로 막음)** | `proposeRecordsFromChat` · `secretSignals` 가 방을 가리지 않고 하루치 글을 Gemini 에 넘기고 있었다 — 옴니스 1:1 글이 이미 들어가던 것. `PUBLIC_MESSAGE_WHERE` 를 붙였다 |
| **첨부(받지 않음)** | `GET /api/files` 가 방을 가리지 않고 최근 파일 50개 이름을 내준다. 사람끼리 방에 붙이면 이름이 샌다 — 서버 400, 화면은 첨부 메뉴 · 붙여넣기 · 끌어 놓기를 끈다 |
| 지표 `users.active` | 그날 글을 쓴 **사람 이름**을 셀 때 방을 가리지 않는다(옴니스 질문도 센다). 내용은 나가지 않아 그대로 두었다 |

화면 확인 중 찾은 것 — people 모드에서 `MessageInput` 의 기본값 `tasks = []` 가 그릴 때마다 새 배열이라 후보 계산 effect 가 setState 를 되풀이했다. 방에서 대화상자(참여자 · 폴더 관리)를 열면 「Maximum update depth exceeded」 가 수백 번 났다. ChatPanel 이 같은 빈 배열을 넘기게 고쳤다(전사방은 실제 배열을 넘겨 걸리지 않았다).

#### 검증 — `BASE=http://localhost:3103 pnpm exec tsx --env-file=.env scripts/verify-people-rooms.ts`

모델을 부르지 않는다. 세 사람(A · B · C)의 세션 쿠키, 만든 방 · 글 · 알림은 끝에 지운다.

```
대상 DB: localhost:5433 · 서버: http://localhost:3103
A=윤훈 · B=팀장 · C=허찬
[1] 1:1 — 같은 두 사람은 한 방
  ✓ A 가 B 를 고르면 1:1 이 열린다
  ✓ 다시 고르면 같은 방(200 · existing)
  ✓ B 가 A 를 골라도 같은 방
  ✓ 동시에 서로를 골라도 1:1 방은 하나
[2] 거부되어야 하는 만들기
  ✓ 나만 고르면 400
  ✓ 시스템 계정은 고를 수 없다 400
  ✓ 없는 사람 400
  ✓ 로그인 없이 401
[3] 1:1 글 · 참여자 밖
  ✓ A 가 1:1 에 쓴다 201
  ✓ B 는 메시지 API 로 읽는다
  ✓ C 는 메시지 API 403 · 내용 없음 (거부되어야 하는 경우)
  ✓ C 는 검색 API 403 (거부되어야 하는 경우)
  ✓ C 는 글을 못 쓴다 404 (거부되어야 하는 경우)
  ✓ C 가 방 주소를 열면 404 · 내용 없음 (거부되어야 하는 경우)
  ✓ B 는 방 주소를 연다 — 글이 보인다
  ✓ C 는 방 정보 404
  ✓ C 의 목록에 A·B 의 1:1 이 없다
  ✓ B 의 목록에 1:1 이 상대(A) 이름으로
  ✓ B 의 목록에 안 읽은 글 1
  ✓ C 의 목록 검색에도 없다
  ✓ 첨부는 400 — 파일 목록이 방을 가리지 않는다
  ✓ 다른 방 글에 답장으로 걸면 인용을 붙이지 않는다
  ✓ 전사방 글에 1:1 글을 답장으로 걸면 400 — 인용으로 새지 않는다 (거부되어야 하는 경우)
[4] 방을 가리지 않는 읽기에 새지 않는다
  ✓ 피드 view=all 에 1:1 글이 없다
  ✓ 사내 지식 색인에 넣지 않는다(직접 동기화를 불러도 0)
  ✓ 멘션 표(ChatMention)를 남기지 않는다
[5] 멘션 알림은 참여자에게만
  ✓ B(참여자)에게 알림
  ✓ C(방 밖)에게는 이름을 불러도 알림이 없다 (거부되어야 하는 경우)
[6] 단톡방 — 만들기 · 이름 · 초대 · 나가기
  ✓ 두 명을 고르면 단톡방 201
  ✓ 기본 이름은 참여자 이름을 잇는다(나는 맨 뒤)
  ✓ 참여자 3명
  ✓ 같은 사람으로 다시 만들면 새 단톡방(1:1 과 다르다)
  ✓ 이름을 주면 그 이름
  ✓ 참여자(B)는 이름을 바꾼다
  ✓ 1:1 은 이름을 못 바꾼다 400
  ✓ 1:1 에는 초대할 수 없다 400
  ✓ 1:1 은 나갈 수 없다 400
  ✓ 방 밖 C 는 초대할 수 없다 404 (거부되어야 하는 경우)
  ✓ 방 밖 C 는 이름을 못 바꾼다 404
  ✓ 방 밖 C 는 나가기도 404
  ✓ B 가 C 를 초대 — 이미 있는 A 는 건너뛴다
  ✓ 초대된 C 는 지금까지의 글을 읽는다
  ✓ C 가 나간다
  ✓ 나간 C 는 메시지 API 403
  ✓ 나간 C 는 글을 못 쓴다 404
  ✓ 나간 C 의 목록에 없다
  ✓ 나간 C 의 즐겨찾기 · 폴더에서 빠졌다
  ✓ 남은 A · B 는 그대로
전부 통과
```

회귀: `verify-chat-rooms.ts` · `verify-chat-folders.ts` · `verify-omnis-room-http.ts` 모두 「전부 통과」.

#### 화면 — `A=… B=… C=… AN=정우창 BN=윤훈 CN=허찬 BASE=http://localhost:3103 node scripts/people-scenarios.mjs`

Playwright, 세 계정(세션 쿠키). A=정우창(1440 · 375), B=윤훈(1440), C=허찬(375). 모든 장 가로 넘침 0px. (9b15ec1 merge 전 화면이다 — 하단 nav 는 아래 「375 nav 여백」 에서 merge 뒤로 다시 쟀다)

```
[1] 1:1 만들기 (A, 1440)                       ✓ 1:1 머리에 상대 이름
[2] B 에게 보이고 답장 (B, 1440)                ✓ B 목록에 A 와의 1:1 이 보인다 · ✓ 그 줄에 안읽음 배지 · ✓ B 알림에 멘션
[3] A 에게 안읽음 배지                          ✓ A 목록 B 줄에 안읽음 배지 · ✓ 「안읽음」 칩에 그 방
[4] 같은 사람과 다시 「사람과 대화」            ✓ 같은 방이 열린다
[5] 단톡방 만들기 · 초대 · 나가기               ✓ 기본 이름은 참여자 이름을 잇는다 · ✓ 머리에 단톡방 이름 · 3명 · ✓ 초대 뒤 4명
[6] C 가 단톡방에서 나가기 (375)               ✓ 나간 C 의 목록에 단톡방이 없다
[7] 참여자가 아닌 C                             ✓ 1:1 주소를 열면 404 화면 · 글 없음 · ✓ 목록에 A·B 1:1 이 없다
[8] 폰 375 (A)
전부 통과
```

B 의 목록 안읽음은 30초 폴링이 아니라 목록을 다시 연 시점에 쟀다(열어 둔 채면 최대 30초 늦게 오른다 — 2-b 와 같다).

375 nav 여백 — 9b15ec1(하단 nav 54px · 마이 원) merge 뒤, 정우창 375×812:

```
/chat                {"navTop":750,"navH":54,"listBottom":744}
/chat/<1:1>          {"navTop":750,"navH":54,"inputBottom":734.25}
/chat/<단톡>         {"navTop":750,"navH":54,"inputBottom":734.25}
/chat/new            {"navTop":750,"navH":54,"inputBottom":723.5}
/chat/default-room   {"navTop":750,"navH":54,"inputBottom":734.25}
```

nav 는 bottom 8px + 54px = 62px 로 `--nav-offset-bottom`(68px + safe-area) 안에 들고, 입력창 아래 끝이 nav 위 끝보다 16px 위다 — 가리지 않는다.

#### 좁은 화면 — `AUDIT_TOKEN=$(… agent-cookie.ts 정우창) BASE_URL=http://localhost:3103 ROUTES=… node scripts/narrow-audit.mjs`

스크립트에 `AUDIT_TOKEN`(세션 쿠키)을 더했다 — 비밀번호 없이 로그인한다. 기본 목록에 `/chat/new/people` 을 더했다.

```
✗ 320px /chat               overflow=0 bleed=0 clip=12 ellip=12 tiny=0
✗ 320px /chat/new/people    overflow=0 bleed=0 clip=1 ellip=1 tiny=0
· 320px /chat/<단톡>        overflow=0 bleed=0 clip=0 ellip=0 tiny=2
· 280px /chat/<1:1>         overflow=0 bleed=0 clip=0 ellip=0 tiny=4
✗ 280px /chat/<단톡>        overflow=0 bleed=0 clip=2 ellip=2 tiny=4
✗ 200px /chat/new/people    overflow=0 bleed=0 clip=2 ellip=2 tiny=0
✗ 200px /chat/<1:1>         overflow=0 bleed=0 clip=2 ellip=2 tiny=4
✗ 200px /chat/<단톡>        overflow=0 bleed=0 clip=3 ellip=3 tiny=4
✗ 200px /chat/default-room  overflow=0 bleed=0 clip=6 ellip=9 tiny=11
잘리거나 넘친 화면: 17 / 24      (exit 1, 6경로 × 4폭 중 줄임)
```

- **가로 넘침 · 화면 밖 삐져나감은 6경로 × 200px 까지 0**
- clip · ellip 은 방 이름 · 부제 · 미리보기 한 줄의 말줄임(`truncate`)
- tiny 는 모두 재사용한 `ChatPanel` 안의 것 — 내 글 고치기 · 지우기 아이콘 20px, 입력창 옆 + · 보내기 33px. 1·2단계 남은 문제 2 와 같다. 이번에 만든 사람 고르기 · 참여자 창에는 없다(`/chat/new/people` tiny=0)
- 320px 1:1 은 한 번 `net::ERR_ABORTED`(dev 경로 다시 컴파일 중 이동) — 280 · 240 · 200px 은 잼

#### 스크린샷 — `mydocs/working/omnis-agent/`

| 파일 | 무엇 |
|---|---|
| `5-1440-1-new-menu.png` | 「새 대화」 메뉴 — 옴니스와 대화 / 사람과 대화 |
| `5-1440-1-pick-one.png` · `5-1440-1-dm-sent.png` | 한 명 고르기 · 1:1 에 첫 글(@멘션) |
| `5-1440-2-b-list-unread.png` · `5-1440-2-b-replied.png` | B 목록의 1:1 + 안읽음 배지 · B 의 답장 |
| `5-1440-3-a-unread.png` · `5-1440-3-a-unread-chip.png` | A 목록 안읽음 배지 · 「안읽음」 칩 |
| `5-1440-5-pick-two.png` · `5-1440-5-group.png` · `5-1440-5-invite.png` | 두 명 고르기(기본 방 이름) · 단톡방 · 초대 |
| `5-375-6-c-list.png` … `5-375-6-c-after-leave.png` | C(초대받은 사람)의 목록 · 방 · 참여자 창 · 나가기 확인 · 나간 뒤 목록 |
| `5-375-7-c-404.png` | 참여자가 아닌 C 가 1:1 주소를 열었을 때 |
| `5-375-8-a-list.png` · `5-375-8-a-dm.png` · `5-375-8-a-pick.png` | 폰 목록 · 1:1 · 사람 고르기 |
| `5-375-nav-*.png` | 9b15ec1 merge 뒤 375 — 목록 · 1:1 · 단톡 · 새 대화 · 전사방 |
| `C-1440-daily-limit.png` · `C-375-daily-limit.png` | 데모 하루 상한 429 화면 |

### C — 데모 비용 방어

모두 환경변수로 켠다. **비우면(또는 0 · 음수 · 숫자 아님) 상한이 없다** — 운영(`omnis-hadd`)에는 넣지 않으므로 기본 동작이 그대로다. 코드 `lib/agent/quota.ts`, 검사 자리 `lib/agent/service.ts` `admissionRefusal`.

| 이름 | 무엇 | 닿으면 |
|---|---|---|
| `OMNIS_AGENT_DAILY_KRW` | 오늘(한국 시각 0시부터) `AiUsage.costKrw` 합계 | 새 실행 **429** — 데모(`NEXT_PUBLIC_IS_DEMO=true`)면 「오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요」, 아니면 「오늘 옴니스 사용량 상한에 닿았어요. 내일 다시 써 주세요」 |
| `OMNIS_AGENT_USER_DAILY_RUNS` | 한 사람이 오늘 시작한 `AgentRun` 수 | 429 「오늘 쓸 수 있는 옴니스 요청 N회를 다 썼어요. 내일 다시 써 주세요」 |

- 거절할 때 질문 글 · 새 방을 남기지 않는다. 화면은 입력창 위에 그 문장을 남기고(토스트로 사라지지 않게) 쓴 글을 입력창에 되돌린다
- **확인을 기다리던 카드의 [확인] · [취소] 는 막지 않는다** — 새 실행이 아니라 이미 시작한 실행을 끝내는 일이다(검증 [2]). 그 이어 가기의 비용은 실행당 상한(`OMNIS_AGENT_MAX_KRW`)이 묶는다
- 합계는 구간이 끝날 때 남는 `AiUsage` 를 센다. 돌고 있는 실행의 비용은 끝난 뒤 들어오므로 하루 상한을 넘는 몫은 **최대 (동시에 돌던 사람 수) × `OMNIS_AGENT_MAX_KRW`** 다. 같은 사람은 동시에 하나만 돈다(아래)

**연달아 보내기 — 지금 동작(이번에 바꿈).** 3단계까지는 같은 방에 RUNNING 실행이 있을 때만 409 였다. 방을 바꾸거나 새 대화를 열면 같은 사람이 모델을 겹쳐 부를 수 있었고, 같은 방이라도 두 요청이 동시에 「돌고 있는 실행 없음」 을 보면 둘 다 열렸다.
이제 받을지 정하고 질문 글 · 실행을 만드는 것까지 한 트랜잭션에서 사람마다 `pg_advisory_xact_lock(hashtext('agent-run:<userId>'))` 로 잠그고, 같은 사람의 RUNNING(5분 안에 갱신된 것)이 어느 방에든 있으면 409 다 —
같은 방이면 예전 문구 「옴니스가 아직 앞의 글에 답하는 중입니다」, 다른 방이면 「다른 대화에서 옴니스가 아직 답하는 중이에요. 끝난 뒤 보내 주세요」. **앞 실행은 취소하지 않고 끝까지 간다**(이미 쓴 토큰을 버리지 않는다).
확인을 기다리는(AWAITING_APPROVAL) 실행은 예전처럼 새 글이 오면 CANCELLED · 카드 EXPIRED. 이 막기는 상한 env 와 상관없이 운영에도 걸린다 — 한 방 안에서의 동작은 예전과 같다.

#### 검증

단위 시험 `lib/agent/quota.test.ts` 7건 — 기본값(운영)이면 상한 없음 · 잘못된 값은 상한 없음 · 하루 원 상한 도달(거부) · 데모 아닌 곳의 문구 · 사람당 실행 수 도달(거부) · 하나만 켜기 · 한국 시각 0시 경계.

HTTP — dev 를 env 를 바꿔 세 번 띄웠다(끝나고 기본값으로 다시 띄움). `scripts/verify-agent-quota.ts`:

```
# dev: NEXT_PUBLIC_IS_DEMO=true OMNIS_AGENT_DAILY_KRW=150 OMNIS_AGENT_MODEL=openai:gpt-6-luna
대상 DB: localhost:5433 · 서버: http://localhost:3103 · MODE=daily · 오늘(2026-10-28T15:00:00.000Z 부터) 쓴 원 192.3
[1] 하루 전체 상한에 닿은 뒤
  ✓ 새 대화는 429 (거부되어야 하는 경우)
  ✓ 문구 「오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요」
  ✓ 빈 방을 만들지 않았다
  ✓ 기존 방에 새 글도 429
  ✓ 질문 글을 남기지 않았다
  ✓ 모델을 부르지 않았다(AiUsage 줄 그대로)
[2] 확인을 기다리던 카드는 처리된다
  ✓ [취소] 는 상한과 상관없이 받는다(스트림)
  ✓ 카드는 REJECTED
    이어 간 실행: DONE · 모델 호출 1회
전부 통과

# dev: OMNIS_AGENT_USER_DAILY_RUNS=1
[3] 사람당 하루 실행 수 = 1
    정우창 오늘 실행 17개
  ✓ 오늘 실행이 있으면 429 (거부되어야 하는 경우)
  ✓ 문구에 「1회」
  ✓ 질문 글을 남기지 않았다
전부 통과

# dev: 상한 없음(운영 기본)
[4] 연달아 보내기 — 같은 사람이 다른 방에서 돌고 있을 때
  ✓ 다른 방에서 돌고 있으면 409 (거부되어야 하는 경우)
  ✓ 문구 「다른 대화에서 옴니스가 아직 답하는 중이에요」
  ✓ 같은 방이면 예전 문구로 409
  ✓ 새 대화도 409 · 빈 방을 남기지 않는다
  ✓ 질문 글을 남기지 않았다
  ✓ 모델을 부르지 않았다(AiUsage 줄 그대로)
전부 통과
```

동시 두 요청(잠금 시험) — dev `OMNIS_AGENT_MODEL=openai:gpt-6-luna`, 정우창의 서로 다른 옴니스 방 두 곳에 같은 순간 POST(일회성 스크립트, 지웠다):

```
[200,409] 5895ms
{"error":"다른 대화에서 옴니스가 아직 답하는 중이에요. 끝난 뒤 보내 주세요"}
  ✓ 동시에 둘 — 하나만 받고 하나는 409 (거부되어야 하는 경우)
모델 호출 1 gpt-6-luna 0.7233
```

화면(`C-1440-daily-limit.png` · `C-375-daily-limit.png`): 새 대화에서 보내면 입력창 위 「오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요」, 주소는 `/chat/new` 그대로, 입력창에 쓴 글이 남는다. 가로 넘침 0px.

#### 데모 권장값

| 이름 | 값 | 이유 |
|---|---|---|
| `OMNIS_AGENT_MODEL` | `openai:gpt-6-luna` | 0단계 53과제 완수 87%, 건당 0.9원 |
| `OMNIS_AGENT_MAX_TURNS` | `6` | 데모 질문은 짧다 |
| `OMNIS_AGENT_MAX_KRW` | `20` | 실행 하나가 쓸 수 있는 최대 |
| `OMNIS_AGENT_DAILY_KRW` | `300` | 하루 전체 |
| `OMNIS_AGENT_USER_DAILY_RUNS` | `20` | 한 사람이 하루를 다 쓰지 않게 |

**최악의 경우 월 약 9,000원**(300원 × 30일). 위 「넘는 몫」 까지 치면 하루 300원 + 동시 사용자 수 × 20원이다.

#### 운영 반영 — 데모(`omnis`, omnis-omega.vercel.app)

1. **작업지시자가 OpenAI 대시보드에서**: 데모 전용 **별도 프로젝트와 키**를 만들고, 그 프로젝트에 **월 예산 한도**를 건다. 운영 키를 데모에 넣지 않는다 — 데모 키가 새거나 상한 코드가 뚫려도 청구가 그 한도에서 멈춘다
2. 데모 프로젝트(Vercel `omnis`)에 넣을 환경변수 (Production):

   | 이름 | 값 |
   |---|---|
   | `OPENAI_API_KEY` | 1 에서 만든 **데모 프로젝트 키** |
   | `OMNIS_AGENT_APPROVAL_SECRET` | `openssl rand -base64 32` — 운영과 다른 값 |
   | `OMNIS_AGENT_MODEL` | `openai:gpt-6-luna` |
   | `OMNIS_AGENT_MAX_TURNS` | `6` |
   | `OMNIS_AGENT_MAX_KRW` | `20` |
   | `OMNIS_AGENT_DAILY_KRW` | `300` |
   | `OMNIS_AGENT_USER_DAILY_RUNS` | `20` |
   | `NEXT_PUBLIC_IS_DEMO` | `true` (이미 있다 — 확인만) |

3. **데모 DB 마이그레이션은 main 빌드가 돌린다** — 데모 프로젝트의 빌드 명령이 `prisma migrate deploy && pnpm run build` 다(AGENTS.md 「Git 워크플로우」). 손으로 할 일이 없다. 다만 main 에 머지되는 순간 데모 DB 에 메신저 · 에이전트 마이그레이션 여섯(채팅 방 종류 · 방 목록 둘 · 에이전트 둘 · 사람끼리 방)이 한꺼번에 들어간다
4. 운영(`omnis-hadd`)에는 `OMNIS_AGENT_DAILY_KRW` · `OMNIS_AGENT_USER_DAILY_RUNS` 를 넣지 않는다 — 상한이 없는 지금 동작 그대로

#### 운영 반영 — 운영 migrate 순서에 더할 것

위 「운영 반영에 필요한 것 1」 의 순서에 이번 것이 더해진다. 파일 이름 순:
`20261028010000_chat_room_kinds` → `20261029000000_agent_runtime` → `20261029010000_agent_run_sources` → `20261029010000_chat_folders` → `20261029020000_chat_folder_rules` → **`20261029030000_chat_people_rooms`**.
`20261028100000_ip_explicit_dates` 는 main(#107)에 이미 있는 것이 merge 로 들어왔다. 모두 추가만. `ALTER TYPE … ADD VALUE` 는 트랜잭션 안에서 새 값을 쓰지 않으므로 Prisma 의 한 마이그레이션 안에서 돈다(로컬 적용 확인).
migrate 전에 이 코드가 나가면 목록이 `ChatRoom.dmKey` · `kind = 'DM'` 을 읽다 오류가 난다.

### 쓴 비용

이번 작업(A · B · C)에서 부른 모델: **2회 · 0.91원** (`AiUsage`, 둘 다 gpt-6-luna)

```
2026-10-29T03:10:02Z  gpt-6-luna  입력 5181 · 캐시 0    · 출력 12  0.7233원   ← 동시 두 요청 중 받아진 하나
2026-10-29T03:10:57Z  gpt-6-luna  입력 5572 · 캐시 5158 · 출력 91  0.1911원   ← 상한 중 기다리던 카드 [취소] 이어 가기
```

5단계 · 상한 검증은 모델을 부르지 않았다. 같은 시간대 `AiUsage` 에 gpt-6.1-sol 12회(26원)와 `GeminiUsage` 임베딩 3회가 더 있는데, 02:37~02:55 에 누군가 3103 dev 의 옴니스 방에서 업무 지시(「부스 홍보에 사용할 판넬 제작 …」)를 한 기록이다 — 이 작업의 스크립트가 아니다.

### 남은 문제 (이번 것)

1. **사람끼리 방에 파일을 붙일 수 없다.** `GET /api/files` 가 방을 가리지 않고 최근 파일 이름을 내주고, `/api/files/[id]` 내려받기도 방 참여자를 보지 않는다. 붙이려면 파일 읽기에 방 권한을 먼저 넣어야 한다
2. 들어옴 · 나감 · 초대를 대화에 사건 줄(「○○님이 나갔습니다」)로 남기지 않는다. 참여자 수는 머리에 보인다
3. 초대받은 사람은 초대 전 대화도 본다(카톡과 다르다). 바꾸려면 `joinedAt` 뒤 글만 읽게 해야 한다
4. 1:1 은 나갈 수도 숨길 수도 없다. 목록에서 치우려면 「숨기기」 같은 개인 설정이 필요하다
5. 목록 안읽음은 30초 폴링이다(2-b 그대로). 상대 답장이 목록 배지에 오르기까지 최대 30초
6. 메시지 · 검색 API 는 참여자가 아니면 403, 글쓰기 · 방 정보는 404 다. 1단계가 정한 403 을 바꾸지 않았다 — 방 id 가 uuid 라 있는지 여부가 새는 정도는 작지만 맞추려면 1단계 검증 스크립트도 함께 고친다
7. 참여자가 아닌 방 주소를 열면 목록이 그 방 키로 읽음 PATCH 를 보내 404 를 받는다(콘솔에 404 두 줄). 막히는 것이고 새는 것은 없다
8. 하루 상한은 `AiUsage` 전체를 센다 — 지금은 에이전트만 이 표에 쓴다. 다른 기능이 이 표로 옮겨 오면 데모 하루 상한이 그것까지 묶는다
9. 같은 사람 동시 실행 막기는 운영에도 걸린다. 한 사람이 두 방에서 동시에 묻던 일은 이제 409 다
10. 로컬 DB 에 시나리오가 만든 사람끼리 방이 남아 있다(1:1 정우창–윤훈 하나 · 「5단계 … 견적 TF」 단톡 몇 개 — 클릭 재시도로 같은 시각 것이 둘 생긴 것 포함). 로컬 자료라 지우지 않았다
11. 3단계 남은 문제 2(질문 경로 쓰기 도구)는 `a0e99c1` 로 해결, 1(빌드)은 위 A 로 해결. 나머지는 그대로

## 사용성 수정(작업지시자 확인 뒤) (2026-10-29 저녁)

작업지시자가 폰(3103 dev, 192.168.2.144)과 PC 에서 써 보고 준 11개 + 오른쪽 패널(12). 같은 워크트리 · 브랜치, push 하지 않았다.
규칙은 [`../manual/ux-rules.md`](../manual/ux-rules.md) 메신저 절 「밀기 · 꾹 누르기 · FAB · 입력 · 기기 저장」 · 「오른쪽 패널」 에 옮겼다.

### 커밋

| 커밋 | 항목 |
|---|---|
| `5dd2041` fix(agent): 답이 오는 중인데 「답을 받지 못했어요」 가 뜨던 것을 고친다 | 1 |
| `18d23c4` feat(agent): 옴니스가 쓴 도구를 답 위에 접힌 한 줄로 남긴다 | 2 |
| `adc09d6` fix(chat): 폰 입력칸 — 글자를 버튼과 가운데로, Enter 는 줄바꿈 | 8 · 9 |
| `b9a4000` feat(chat): 오른쪽 패널을 둥근 유리 판으로 · 옴니스 탭을 에이전트로 되살리고 여는 단추를 오른쪽 아래로 | 3 · 12 |
| `320786c` feat(chat): 「새 대화」 를 채팅 목록 오른쪽 아래 유리 FAB 로 · 폴더 관리 칩 아이콘을 가운데로 | 4 · 10 |
| `4621718` feat(chat): 폰 알림 종을 nav 와 같은 유리 원으로 | 5 |
| `21f7de0` fix(chat): 마이 원을 누르면 바로 켜지고 화면을 미리 받는다 | 6 |
| `22f1489` feat(chat): 채팅방 줄의 ⋯ 를 걷고 밀기 · 꾹 누르기로 | 7 (마이그레이션) |
| `2b31cae` feat(chat): 빠르게 — 옴니스 방 30개씩 · 기기 저장으로 먼저 그리기 · 두 번 보내기 막기 | 11 |
| `d406be0` fix(chat): 패널 탭은 누름 단추(aria-pressed)로 | 12 정리 |
| (이 문서) docs(chat) | 결과 · 규칙 · 스크린샷 |

### 1. 「답을 받지 못했어요」 — 원인과 고친 것

**원인.** 화면이 「지금 스트림을 읽고 있는가(live · pending)」 만 보고 답을 못 받았다고 판정했다(`unanswered`).
폰에서 앱을 바꿨다 돌아오면 브라우저가 페이지를 다시 연다 — 3103 로그에 보낸 직후 `GET /chat/<방>` 과 `manifest.webmanifest` 가 함께 다시 찍혀 있었다(문서 새로 읽기).
새로 연 페이지의 서버 상태는 「실행 RUNNING · 방의 마지막 글은 내 질문」 이고, 다시 붙기 스트림(`/api/agent/runs/<id>/stream`)의 첫 바이트가 오기 전까지 live 가 null 이라
「이 질문에 아직 답을 받지 못했어요 · 다시 묻기」 가 떴다. 스트림만 끊긴 경우(화면 꺼짐 · 망 전환)도 같다 — 서버는 답을 끝까지 쓰는데 화면은 오류를 띄웠다.
의심 목록 중 「스트림 끝 판정」 은 같은 뿌리(끝났거나 끊긴 뒤 서버가 아직 돌고 있으면 다시 붙지 않았다), 「사람 글 대조」 는 따로 틀렸다 — 보내는 중인 글을 내용과 「화면을 연 시각 뒤」 로 대조해 같은 말을 두 번 보내거나 폰 시계가 서버보다 빠르면 어긋났다.
「텍스트 파트 접기(foldChunk)」 · 「방 상태 다시 읽는 순서」 는 원인이 아니었다(스트림은 `saveAgentPass` 뒤 `closeAgentStream` 으로 닫혀, 닫힌 뒤 읽으면 답이 이미 DB 에 있다).

**재현** — `scripts/agent-answer-repro.mjs reload`(보낸 뒤 방 주소로 바뀌면 새로고침, 100ms 마다 화면을 읽는다):

```
고치기 전   답: 받음 · 「답을 받지 못 / 다시 묻기」 보인 순간 109번 (5.1s ~ 16.0s)   ✗ 실패
고친 뒤     답: 받음 · 「답을 받지 못 / 다시 묻기」 보인 순간 0번                      ✓ 통과
고친 뒤     (offline — 스트림 도중 2초 연결 끊기)  보인 순간 0번                     ✓ 통과
```

**고친 것.** 판정에 「서버에 돌고 있는 실행」 을 넣었다(`lib/agent/room-view.ts` `unansweredQuestion`, 단위 시험 — 재현 2건 포함).
스트림이 끝나거나 끊기면 방을 다시 읽고 아직 RUNNING 이면 다시 붙는다(최대 6번, 쉬는 시간을 늘리며). 앱으로 돌아올 때(visibilitychange) · 망이 돌아올 때(online) 방을 다시 읽는다.
보내는 중인 글은 서버가 주는 `x-question-id` 로 대조한다. 스트림이 오류로 끝나도 질문 뒤에 답이 남았으면 오류를 띄우지 않는다(`answeredAfter`).

### 2. 도구 사용 표시

답 옆 칩(가로, 답이 끝나면 사라짐) → 답 위 접힌 한 줄 「도구 N개 사용 ›」, 펼치면 부른 순서대로 세로로 도구 이름 · 인자 요약 · 결과 요약.
답하는 동안에도 같은 줄(「도구 N개 쓰는 중」). **새 표를 두지 않았다** — 실행 대화(`AgentRun.messages`)의 tool-call · tool-result 에서 다시 그린다(`lib/agent/tool-trail.ts`, 시험 5건).
결과 본문은 길어(업무 목록 200건) 앞 140자만 내려보낸다. 방 페이지에 든 질문의 실행만 읽는다.

### 3 · 12. 오른쪽 패널

- 제목줄 「채팅 열기」(`RightPanelTrigger`)를 지웠다. **지운 뒤 남는 여는 길을 세었다**: C 키(물리 키보드) · ⌘⇧F(물리 키보드) · `?taskId=` 링크(들어올 때만) · 온보딩 「대화」 장면. 업무 상세의 「이 업무」 스레드도 패널을 여는 단추는 아니었다(패널이 열리면 그 탭이 먼저일 뿐).
  폰에서는 열 길이가 없어진다 — 그래서 **오른쪽 아래 둥근 유리 단추(`PanelDock`)** 를 두었다(규칙 14 의 독 사분면, 업무를 보다가 그 업무 스레드 · 전사 채팅 · 옴니스를 옆에 여는 자리). 폰 채팅 화면에서는 그리지 않고(FAB · 입력칸 자리), PC 채팅 화면에서는 입력칸 위로 올린다. 온보딩 「대화 패널」 장면이 이 단추를 가리킨다
- e2e `onboarding.spec.ts` 「작성 중인 패널 메시지 보존」 은 지키는 것(투어가 패널을 열 때 쓰던 글을 버리지 않는다)을 그대로 두고 여는 단추만 「대화 패널 열기」 로 바꿨다. `_setup.ts` · `scenario/_actors.ts` 도
- 「허전한 패널」(작업지시자 12번 답: 오른쪽 패널, 「예전처럼 · 지금처럼 동글동글하게」) — 예전(origin/main) 구성과 비교:

| 예전 | 지금 | 왜 |
|---|---|---|
| 탭 이 업무 · 전체 · Omnis AI | 이 업무 · 전체 · **옴니스** | 되살림. 옴니스는 Gemini `OmnisAsk`(쓰기를 확인 없이 열던 경로)가 아니라 **에이전트의 옴니스 1:1 방**을 그대로 끼웠다(`PanelOmnis` → `OmnisRoom embedded`) — 확인 카드 · 다시 붙기를 따로 만들지 않았다 |
| Omnis AI = 한 번 묻고 끝 | 최근 방 이어 쓰기 · 새 대화 · 「크게 보기」(`/chat/<방>`) | 메신저의 방과 같은 대화. 패널에서 새 방이 생겨도 지금 화면 주소는 바꾸지 않는다 |
| 머리줄: 네모 탭 + 검색 · 닫기 | 캡슐 탭(현재 탭만 `.glass-pill`) + 둥근 검색 · 닫기 | nav 문법 |
| 업무 스레드 거르기 칩(네모) | 같은 칩, 둥근 알약 · 고른 것은 검정 | 지금 칩 줄 문법 |
| 「이 업무」 일 때 머리 아래 표시 없음 | 「# 업무 이름 스레드」 한 줄 | 무엇을 보는지(정보 밀도) |
| 화면 오른쪽 끝에 붙은 판 | 가장자리에서 8px 띄운 둥근 판(`.glass` 가장자리 빛 · 그림자), 속은 불투명 | 「동글동글하게」. 유리는 크롬에만 |
| 여는 곳: 헤더 단추 | 오른쪽 아래 둥근 단추 | 위 3 |

### 4 · 5 · 6 · 10

- 4: 「새 대화」 FAB — 목록 칸 오른쪽 아래(`absolute`, 셸이 비운 `--nav-offset-bottom` 위), `.glass` 원. 메뉴 둘. 제목줄 버튼은 지웠다. 메뉴가 열릴 때 두 화면을 미리 받는다
- 5: 폰 알림 종을 PC nav 와 같은 `.glass` 원에(버튼이 원을 채운다)
- 6: 마이 원 — 누른 순간 켜지고(도착하면 내려놓음) 눌림 표시, 손가락이 닿거나 마우스가 올라오면 `router.prefetch("/settings")`. 원인: 켜짐이 주소(마이 화면이 다 그려진 뒤 바뀜)만 따랐고 dev 에서는 링크가 저절로 미리 받지 않았다
- **10: 6.png 는 채팅 목록 칩 줄 끝의 「폴더 관리」 칩**(아이콘만 든 원, `FolderLibraryIcon`). 터치 기기에서 `.touch-target` 이 칸을 44px 로 넓히는데 칩 클래스(`CHIP`)에 `justify-center` 가 없어 아이콘이 왼쪽 여백에 붙었다. 같은 `CHIP` 을 쓰는 칩 전부(고정 칩 · 폴더 칩)에 넣었다. 다른 곳의 아이콘만 든 `.touch-target` 원도 훑었다 — `Button` 은 원래 `justify-center` 이고 나머지는 글자가 든 칩이라 해당 없음. 측정(375, 아이콘 중심 − 원 중심): 폴더 관리 칩 · 폰 알림 종 둘 다 ±1px 안

### 7. 밀기 · 꾹 누르기 — 스키마 추가

| 마이그레이션 | 무엇 |
|---|---|
| `20261029040000_chat_room_hidden` | `ALTER TABLE "ChatRoomPref" ADD COLUMN "hiddenAt" TIMESTAMP(3)` — 추가만. `prisma migrate diff`(HEAD 스키마 → 새 스키마)와 같다. **로컬 5433 에만 적용**, 운영 migrate 는 하지 않았다 |

규칙 23: `RoomPrefSchema.hidden`(Zod). 새 칸이라 백필 없음. 방 종류별 뜻은 ux-rules 표. 옴니스 대화 삭제는 `ownRoom` 이 숨긴 방을 없는 방으로 봐 방 화면 · 상태 · 묻기 API 가 모두 404 다.

`BASE=http://localhost:3103 pnpm exec tsx --env-file=.env scripts/verify-chat-hide.ts` (모델 없음, 만든 것은 지운다):

```
[1] 옴니스 1:1 — 대화 삭제는 나에게서 숨기고 기록은 남긴다
  ✓ 지우기 전 목록에 있다 · ✓ 대화 삭제 200 · ✓ 목록에서 빠진다 · ✓ 목록 검색에도 없다
  ✓ 방 상태 API 는 404 (거부되어야 하는 경우) · ✓ 방에 새 글을 보내도 404 (거부되어야 하는 경우) · ✓ 방 주소를 열면 404
  ✓ 글 · 실행 · 사용 기록은 남는다(soft delete) · ✓ 즐겨찾기는 꺼진다
[2] 사람 1:1 — 숨기기는 상대가 새 글을 보내면 다시 보인다
  ✓ 숨기기 200 · ✓ A 목록에서 빠진다 · ✓ B 목록에는 그대로 · ✓ A 는 방을 여전히 연다(숨김은 목록 정리)
  ✓ B 가 새 글을 보내면 A 목록에 다시 보인다 · ✓ 다시 숨긴다 · ✓ 「사람과 대화」 로 같은 사람을 다시 고르면 숨김이 풀린다
[3] 거부되어야 하는 숨김 — 전사방 · 업무방 · 단톡방 · 남의 방
  ✓ 전사방은 400 · ✓ 업무방은 400 · ✓ 단톡방 숨김은 400 — 나가기로 한다 · ✓ 남의 옴니스 방은 404 · ✓ 전사방은 목록에 그대로
[4] 단톡방 나가기(기존 기능)
  ✓ 나가기 200 · ✓ 나간 방은 목록에 없다
전부 통과
```

화면(`TOKEN=… node scripts/usability-scenarios.mjs list pc`, CDP 터치 · 마우스):

```
[list] 375
  ✓ 오른쪽→왼쪽 — 삭제 칸이 드러난다 · ✓ 가로로 밀어도 목록은 세로로 움직이지 않았다 · ✓ 밀어도 방이 열리지 않는다
  ✓ 열린 줄을 누르면 닫히고 방은 열리지 않는다 · ✓ 왼쪽→오른쪽 — 즐겨찾기 · 폴더 칸
  ✓ 전사방은 오른쪽→왼쪽에 아무것도 없다 (거부되어야 하는 경우)
  ✓ 세로로 밀면 목록이 스크롤되고 줄은 열리지 않는다 · ✓ 삭제를 확인하면 그 줄이 목록에서 사라진다
  ✓ 꾹 누르면 메뉴가 열린다 · ✓ 메뉴에 삭제가 있다 · ✓ 꾹 눌러도 방이 열리지 않는다
  ✓ FAB 는 하단 nav 위에 뜬다(겹치지 않는다)
[pc] 1440
  ✓ 마우스로 끌어도 삭제 칸이 드러난다 · ✓ 끌어도 방이 열리지 않는다 · ✓ 키보드 Shift+F10 으로 같은 메뉴가 열린다
전부 통과
```

화면 확인 중 찾은 것: 마우스는 손을 떼는 순간 click 이 바로 따라와 「열린 줄을 누르면 닫는다」 가 방금 연 줄을 곧장 닫았다 · 손가락으로 민 뒤에는 click 이 오지 않아 「버릴 클릭」 표시가 남아 다음 탭을 삼켰다 — 둘 다 고쳤다(새 손짓마다 표시를 지운다).
Playwright 의 Shift+F10 은 contextmenu 를 내지 않아 줄이 직접 연다(메뉴 키 · Shift+F10).

### 8 · 9. 입력칸

- 원인(5.png): 입력칸(한 줄 약 30px)이 보내기 단추(터치 44px)보다 낮은데 `items-end` 로 바닥만 맞춰 글자가 아래로 처졌다. 전사방 · 사람 방(`MessageInput`)은 단추가 `size-10`(rem 이라 32.5px)이고 입력칸은 40px 라 반대로 어긋났다
- 입력칸 최소 높이 = 단추 높이(px), 남는 높이는 위아래 여백. 여러 줄이면 단추는 아래에 붙는다
- Enter 판정 한 곳 `lib/enter-to-send.ts`(시험 4건 — 폰 Enter 보내지 않음 · 한글 조합 · Safari keyCode 229)

```
[input] 375
  ✓ 옴니스 방 — 한 줄일 때 글칸 · 보내기 버튼 세로 가운데가 같다(±1px)
  ✓ 폰에서 Enter 는 줄바꿈 — 보내지 않았다 · ✓ 여러 줄이면 버튼은 아래에 붙는다
  ✓ 전사방 — 한 줄일 때 세로 가운데(±1px) · ✓ 사람 방 — 한 줄일 때 세로 가운데(±1px)
  ✓ PC — Shift+Enter 는 줄바꿈
```

### 11. 빠르게

- 옴니스 방: 전부 받던 글을 최근 30개만, 위로 올리면 30개씩(`?before=`). 전사방 · 사람 방은 이미 30개씩이었다
- 기기 저장(IndexedDB): 범위 · 지우는 때는 ux-rules 「기기 저장」 과 `lib/chat-cache.ts` 머리 주석. 목록은 저장본 먼저, 방은 `loading.tsx` 가 저장본 먼저
- 누름 즉시: 방 줄 · 마이 원 눌림 표시, FAB 메뉴 · 마이 원 미리 받기. 보내기 · [확인] ref 잠금

```
[speed] 375  (PAGED_ROOM = 로컬에 만든 45글 방 「[화면 확인] 긴 옴니스 대화 45글」)
  ✓ 처음에는 최근 30개만 그린다
  ✓ 위로 올리면 앞의 글을 더 받는다(45개)
  ✓ 방을 누르면 저장본이 먼저 그려진다      저장본까지 358ms (dev — 서버 화면은 그 뒤)
  ✓ 보내기를 같은 순간 두 번 눌러도 요청은 한 번
```

### 검증

```
$ pnpm run verify
verify exit 0
✖ 37 problems (0 errors, 37 warnings)        ← 이번에 생긴 경고 3개(패널 tab · 스크립트 변수 둘)는 d406be0 에서 지웠다

$ pnpm run test:unit
ℹ tests 147 · pass 147 · fail 0              ← 124 → 147 (room-view 11 · tool-trail 5 · enter-to-send 4 · chat-list 3)
```

e2e — `e2e-local.sh`(CI 와 같은 조건: 별도 DB `omnis_test` · 데모 시드 · `pnpm run build` · `next start -p 3104`), 모든 커밋 뒤 한 번:

```
  1 skipped      ← chat-task.spec.ts 「AI 자동완성 (Gemini 라이브 호출)」 — CI 에서도 건너뛰는 것
  48 passed (1.2m)
  ✓ onboarding › 비활성 탭에서 재생 정지, 키보드 종료, 작성 중인 패널 메시지 보존   ← 「대화 패널 열기」 로 여는 것으로 바꾼 시험
  ✓ onboarding › 스포트라이트는 실제 대상에 밀착하고 …                           ← 「대화 패널」 장면이 오른쪽 아래 단추를 가리킨다
```

`pnpm run build` 는 이 스크립트 안에서 exit 0. 빌드 뒤 3103 dev 는 그대로 응답한다(`/chat` · `/api/chat/rooms` · `/tasks` 200).

### 쓴 비용

모델 4회 · **17.40원**(gpt-6.1-sol, 전부 `agent-answer-repro.mjs` — 첫 호출 캐시 없음 14.53원, 뒤 셋 0.96원씩). 300원 안. 나머지 시나리오는 모델을 부르지 않았다.

### 스크린샷 — `mydocs/working/omnis-agent/U-*.png` (모두 가로 넘침 0px)

| 파일 | 무엇 |
|---|---|
| `U-375-swipe-left-delete.png` · `U-1440-swipe-left-delete.png` | 오른쪽→왼쪽 — 삭제 칸 |
| `U-375-delete-confirm.png` | 삭제 확인(AlertDialog) |
| `U-375-swipe-right-favorite.png` · `U-1440-swipe-right-favorite.png` | 왼쪽→오른쪽 — 즐겨찾기 · 폴더 |
| `U-375-longpress-menu.png` · `U-1440-context-menu.png` | 꾹 누르기 · 우클릭 메뉴 |
| `U-375-fab-menu.png` · `U-1440-fab-menu.png` | 「새 대화」 FAB 메뉴 |
| `U-375-input-omnis-one-line.png` · `U-375-input-omnis-multiline.png` · `U-375-input-company.png` · `U-375-input-people.png` · `U-1440-input-omnis.png` | 입력칸 한 줄 · 여러 줄 · 전사방 · 사람 방 · PC |
| `U-1440-tools-collapsed.png` · `U-1440-tools-expanded.png` · `U-375-tools-*.png` | 도구 기록 접힘 · 펼침(새로고침 뒤, DB 에서) |
| `U-1440-panel-dock.png` · `U-375-panel-dock.png` | 패널 여는 단추(제목줄에 「채팅 열기」 없음) |
| `U-1440-panel-all.png` · `U-375-panel-all.png` · `U-1440-panel-omnis.png` · `U-375-panel-omnis.png` · `U-1440-panel-task.png` | 패널 전체 · 옴니스 · 이 업무 |
| `U-375-chrome.png` | 폰 알림 유리 원 · 폴더 관리 칩(아이콘 가운데) |
| `U-375-paged-older.png` · `U-375-cached-preview.png` | 위로 올려 더 받기 · 저장본으로 먼저 그리기 |

`U-375-panel-omnis.png` 의 「이 질문에 아직 답을 받지 못했어요」 는 화면 확인용으로 만든 방의 마지막 글이 질문이어서다(실행이 없는 방 — 보여야 하는 경우).

### 운영 반영에 더할 것

위 「운영 반영 — 운영 migrate 순서에 더할 것」 의 끝에 **`20261029040000_chat_room_hidden`** 을 더한다(파일 이름 순 마지막). 추가만 — 지금 운영 코드는 이 칸을 읽지 않는다.
migrate 전에 이 코드가 나가면 목록(`listRooms`)이 `ChatRoomPref.hiddenAt` 을 읽다 오류가 난다. 데모 DB 는 main 빌드가 적용한다.

### 남은 문제 (이번 것)

1. 업무방(`TaskThread`)은 기기 저장에 넣지 않았다 — 업무방을 열 때는 예전처럼 스켈레톤이다
2. 저장본은 서버 화면이 올 때까지의 읽기 전용 미리보기다. 서버 없이(비행기 모드) 방을 여는 오프라인 모드는 아니다 — 앱 껍데기를 서비스 워커로 담지 않았다
3. 「사람 1:1 숨기기」 는 내가 그 방에 글을 써도 다시 보인다(마지막 글 시각으로 판정). 상대의 글만 세려면 마지막 글 작성자를 봐야 한다
4. 패널 「옴니스」 탭은 `/api/chat/rooms` 전체 목록에서 옴니스 방만 쓴다 — 가볍게 하려면 옴니스 방만 주는 API 가 낫다
5. 밀기는 Playwright(CDP 터치 · 마우스)로만 확인했다. 실제 iPhone Safari · 안드로이드 Chrome 에서의 손맛(가로 우세 1.4배 · 76/136px 칸)은 작업지시자 확인이 필요하다
6. 꾹 누르기를 iOS Safari 에서 하면 글자 선택 · 링크 미리보기가 먼저 뜰 수 있다 — base-ui 가 `-webkit-touch-callout: none` 을 주지만 실기기로 보지 않았다
7. 3103 dev 서버를 한 번 다시 띄웠다(`prisma generate` 뒤 옛 클라이언트가 `hiddenAt` 을 몰라 목록 API 가 500). 같은 설정(`NEXTAUTH_URL=http://192.168.2.144:3103 AUTH_TRUST_HOST=true … -H 0.0.0.0 -p 3103`)
8. 로컬 DB 에 화면 확인이 남긴 것: 「[화면 확인] 긴 옴니스 대화 45글」 방(정우창) · 전사방 글 「[화면 확인 …] 두 번 누르기」 한 줄 · 재현 시험 옴니스 방 4개(하나는 화면에서 삭제 확인에 썼다)

## dev 서버

`http://localhost:3103` — 띄워 둔 채로 둔다. 로그 `/private/tmp/claude-501/-Users-jeong-uchang-work-omnis-local/94daa007-779b-4ee8-9c84-fb288600d17f/scratchpad/dev3103.log`.

## 옴니스 방 — 말풍선 걷기 · 스크롤 따라가기 (2026-10-29 밤, `fix/omnis-chat-ui`)

작업지시자 요청 2건. push 하지 않았다. 규칙은 [`../manual/ux-rules.md`](../manual/ux-rules.md) 메신저 절 첫 목록에 옮겼다.

1. **말풍선.** `OmnisMessage` · `LiveOmnis` 의 본문 감싸개에서 `rounded-xl border bg-card px-3.5 py-3` 을 걷고 본문만 둔다. 아바타 · 이름 · 시각 · 도구 기록 줄 · 각주 · 확인 카드(`AgentCard`)는 그대로. 기기 저장본 미리보기(`CachedRoomPreview`)의 옴니스 글도 같은 모양으로.
2. **스크롤.** 원인: 글 · 카드 · 답 조각이 바뀔 때마다 무조건 `scrollTop = scrollHeight`. 판정을 순수 함수(`lib/agent/scroll-follow.ts` `isStuckToBottom`, 80px)로 빼고 시험 8건. 목록의 `scroll` 이벤트로 붙음/떨어짐을 갱신한다(터치 · 휠 · 키보드 공통). 떨어지면 따라가기를 멈추고 「↓ 새 답」 단추. 앞 글 붙이기는 `prependScrollDelta` + `overflow-anchor: none`(브라우저 자동 보정과 겹쳐 두 번 밀리는 것을 막음). 따라가는 스크롤은 `useLayoutEffect` 로 그리기 전에.

검증(`scripts/verify-chat-follow.mjs` — 모델 없이 보내기를 브라우저에서 조금씩 흘리는 SSE 로 바꿔 끼움):
옴니스 글 테두리 0px · 배경 투명 / 내 글 말풍선 유지 · 흐르는 동안 gap≤2px · 휠 · 키보드(PageUp) · 터치(CDP 제스처)로 올리면 top 이 움직이지 않고(h 만 늘어남) 단추 표시 · 단추 · 직접 내리기로 다시 따라감 · 앞 글 붙이기 전후 보던 글의 자리 차 ≤2px(1440 · 375). 고치기 전 코드로는 같은 시험이 「머문다」 에서 실패한다(top 2023→2432).
스크린샷: `omnis-agent/V-{1440,375}-omnis-answer.png` · `V-{1440,375}-stream-scrolled-up.png` · `V-{1440,375}-stream-following.png`


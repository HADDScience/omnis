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

1. **`pnpm run build` 를 돌리지 않았다.** `withWorkflow` 가 webpack 설정과 `/.well-known/workflow/*` 경로를 더한다. dev 에서는 「Compiled workflows (30 steps, 1 workflow)」 로 돈다. 머지 전에 운영 env 를 읽지 않는 곳에서 빌드를 돌려야 한다(이 워크트리에는 `.env.production.local` 이 없다 — 작업지시자 판단)
2. **기존 Gemini 질문 경로(`/omnis/ask` · MCP `ask_omnis` · `askOmnisRoute`)는 쓰기 도구를 확인 없이 연다.** `ROUTE_TOOL_EXCLUDE` 가 4개(ask_omnis · post_message · create_task · search_knowledge)만 빼서 update_task · update_checklist · write_omnis_card · save_company_record · delete_company_record · respond_notification · write_weekly_report · decide_record_proposal · upload_file 이 Gemini 에 열려 있다. 지시대로 그 경로는 건드리지 않았다 — 막을지 정해야 한다
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

## dev 서버

`http://localhost:3103` — 띄워 둔 채로 둔다. 로그 `/private/tmp/claude-501/-Users-jeong-uchang-work-omnis-local/94daa007-779b-4ee8-9c84-fb288600d17f/scratchpad/dev3103.log`.

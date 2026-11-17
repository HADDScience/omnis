---
kind: decision
status: active
canonical: AGENTS.md
last_verified: 2026-11-17
---

# 도구 레지스트리 — MCP · 앱 AI · 질문 경로 노출을 한 곳에 (2026-11-17)

## 왜
도구 정의(이름 · 설명 · 입력 스키마)와 실행(runTool)은 이미 MCP 한 곳(lib/omnis-mcp.ts)에 있었다.
갈라진 것은 「어디에 어떻게 여는가」 — 손으로 적은 목록 셋이었다.

| 목록 | 파일 | 뜻 |
|---|---|---|
| AGENT_READ_TOOLS · AGENT_WRITE_TOOLS · AGENT_EXCLUDED · DROP_PROPS · IP_WRITE_TOOLS | lib/agent/tools.ts | 앱 AI(옴니스 대화방) |
| ROUTE_READ_TOOLS | lib/omnis-ask.ts | 질문 경로(앱 「질문하기」 · MCP ask_omnis) — 확인 단계가 없어 읽기만 |
| (암묵) TOOLS | lib/omnis-mcp.ts | MCP 서버 |

새 쓰기 도구(record_sample)는 앱 AI 에는 열렸지만 질문 경로에는 원래 규칙대로 닫혀, ask_omnis 로 물으면 「쓰기 도구가 없다」 고 답했다.

## 설계
- lib/tools/registry.ts `TOOL_POLICY` — 도구 하나 = 한 줄: `mcp` · `agent`(read/write) · `ask`(read/preview) · `confirm`(card/param) · `ip` · `agentDropProps` · `why`
- 세 경로의 목록은 전부 레지스트리에서 나온다(기존 export 이름은 그대로 둬 부르는 쪽은 바뀌지 않는다)
- lib/omnis-mcp.ts — MCP 도구 이름마다 레지스트리 줄이 있어야 tsc 가 지나간다(REGISTERED 타입 검사)
- 질문 경로 `ask: "preview"` — confirm 으로 확인하는 쓰기 도구를 confirm 칸 없이 열고 늘 confirm 없이 부른다 → 미리보기 + 「옴니스 대화방에서 확인 카드로, MCP 는 confirm=true」 안내
- 확인 절차: 앱 AI 는 확인 카드(Workflow needsApproval), `confirm: "param"` 도구는 카드 확인 뒤 confirm=true 를 붙여 실행
- 시험: lib/tools/registry.test.ts — MCP · 앱 AI · 질문 경로 목록이 레지스트리와 같다, 한쪽만은 why 필수, 쓰기는 확인 절차 필수, 재설계 전 노출과 같다

## 같이 고친 것
- 제품 이름의 괄호 별칭(「한글 (English)」) — 한글 이름 + 규격으로 부르면 못 찾던 것(lib/crm-sample-rules.ts productNameVariants)
- 시험 모델(OMNIS_AGENT_FAKE)이 글 속 `[[도구 {입력}]]` 로 도구를 부른다 — 앱 AI 확인 카드 e2e(tests/feature/agent-record-sample.spec.ts)

## 하지 않은 것
- 정의(설명 · 스키마)를 레지스트리 파일로 옮기기 — MCP 정의가 이미 한 곳이고 1,700줄을 옮기면 바깥 클라이언트 출력이 바뀔 위험만 커진다
- 앱 AI 전용 결과물 도구(lib/agent/outputs.ts) · search_knowledge · ip_overview 의 경로별 정의는 그대로(why 에 적었다)

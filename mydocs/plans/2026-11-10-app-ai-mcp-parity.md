---
kind: decision
status: active
canonical: mydocs/plans/2026-11-10-app-ai-mcp-parity.md
last_verified: 2026-11-10
---

# 앱 AI 가 MCP 로 할 수 있는 일을 다 한다 · 기능 요청 전달

작업지시자 요청(2026-11-10).

## 1. 도구 맞추기

에이전트(옴니스 대화)는 MCP 와 같은 `runTool`(lib/omnis-mcp.ts)을 부른다 — 복사본이 없다. 권한은 대화 중인 사용자 본인(`callerFor`)이라
참여하지 않은 방 · 관리자 전용 데이터 · 지식재산권 비구성원은 MCP 와 똑같이 막힌다.

| 구분 | 도구 |
|---|---|
| 새로 연 읽기(자동) | `read_file` · `read_guide` |
| 새로 연 쓰기(확인 카드) | `respond_notification` · `delete_company_record` · `decide_record_proposal` · `upload_file` · `add_progress` · `correct_ip` · `create_ip` |
| 입력을 넓힌 쓰기 | `post_message`(task 없이 전사방 · files) · `update_task`(archived) · `write_weekly_report`(submit) |
| 뺀 것 | `ask_omnis` — 에이전트가 곧 옴니스 · `create_upload_link` — 셸(curl)용 링크, 링크가 곧 권한이라 대화 기록에 남기지 않는다 |

- 쓰기는 모두 기존 확인 카드(planHash · 한 번만 · 비밀 차단)를 거친다. 카드에 따라오는 일(알림 · 되돌릴 수 없음)을 적는다.
- 지식재산권 쓰기는 `guide` 칸을 그대로 받는다 — `read_guide` 확인 코드 규칙은 runTool(guideGate)이 지킨다.
- 질문 경로(/omnis/ask · MCP ask_omnis)는 확인이 없어 읽기만 그대로 둔다.
- 시험: `lib/agent/tools-parity.test.ts` — MCP 도구가 모두 에이전트 읽기 · 쓰기 또는 뺀 목록에 있는지.

## 2. 기능 요청

옴니스가 「지금 없는 기능」 이면 `request_feature`(확인 카드 「이 기능이 필요하다고 개발자에게 전달할까요?」)를 띄운다. 흐리면 부르기 전에 한두 줄 되묻는다.

- 저장: `FeatureRequest`(묶음 · 상태 NEW/REVIEW/DONE · 건수) + `FeatureRequestEntry`(요청자 · 옴니스 대화 roomId · runId · 내용 · 해 본 것). 표 추가만.
- 묶기: 제목을 정규화한 key(`featureKey`)가 같고 완료가 아닌 묶음에 붙인다.
- 알림: 개발자 = `ALERT_EMAIL_TO` 와 이메일이 같은 재직 계정 → 옴니스 알림(`feature_request`, 관리 화면으로 연다) + 운영 알림 메일(lib/alert-mail). 둘 다 실패해도 저장은 남는다.
- 관리 화면: `/settings/feature-requests`(관리자만, 마이 → 앱 정보에 링크). 상태는 `PATCH /api/feature-requests/[id]`.

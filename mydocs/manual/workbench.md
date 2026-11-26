---
kind: guide
status: active
canonical: mydocs/manual/workbench.md
last_verified: 2026-11-26
---

# 작업용 컴퓨터 (0단계) — Claude Managed Agents

옴니스 에이전트가 「파일을 만들거나 프로그램을 돌려야 하는 일」을 **작업용 컴퓨터**(Anthropic 이 운영하는 리눅스 샌드박스)에 넘긴다.

- 사람이 확인 카드를 눌러야 시작한다.
- 진행은 채팅방에 한 줄씩 올라온다.
- 결과 파일은 옴니스 File 로 받아 같은 방에 붙는다.
- 끝나면 세션 · vault · 단기 토큰을 지운다.

**꺼져 있으면 지금 동작 그대로다.** 켜진 사람(`WORKBENCH_USER_IDS`)에게만 도구 3개가 보인다.

## 흐름

```
옴니스 1:1 방  「12/1 면접 지원자 묶음 PDF 만들어줘」
  옴니스 에이전트 ─ start_workbench 카드(예상 비용 · 1건 상한 · 이번 달 쓴 것) ─ [시작]
    lib/workbench/service.ts startWorkbench  한도 판정 → WorkbenchJob(QUEUED) → Workflow 시작
    lib/workbench/workflow.ts
      openStep   요청자 권한 단기 MCP 토큰(ip.oauth_tokens, client omnis-workbench) → vault static_bearer → 세션(budget = 1건 상한, initial_events = 일)
      pumpStep   5초마다 새 이벤트 → 진행 한 줄(lib/workbench/progress.ts) → 채팅방
      finishStep 결과 파일(/mnt/session/outputs) → NAS File → 채팅방 · AiUsage(feature "workbench") · 세션 · vault 삭제 · 토큰 폐기
  상한에 닿으면  세션을 남기고 NEEDS_BUDGET → 「작업 계속」 → continue_workbench 카드 → 상한 한 번 더
  「작업 멈춰」  stop_workbench 카드 → interrupt → 그때까지 만든 파일 받고 치우기
```

## 지키는 것

| 무엇 | 어디서 |
|---|---|
| 에이전트는 회사 자료를 옴니스 MCP 로만, **읽기만** 한다 | MCP 쪽: `lib/omnis-mcp.ts` 가 `omnis-workbench` client 토큰에 `scope: "workbench"` 를 붙이고, 허용 목록(`lib/workbench/definitions.ts` `WORKBENCH_MCP_TOOLS`) 밖 도구를 거절한다. 에이전트 쪽: `mcp_toolset` 도 같은 목록만 켠다 |
| 발송 · 운영 쓰기 · NAS 저장을 하지 않는다 | 위 허용 목록에 쓰기가 없다. 지침(`lib/workbench/guidelines.ts`)은 `/mnt/session/outputs/requests.md` 에 요청을 남기라고 한다. 사람이 옴니스 카드로 실행한다 |
| 허용 목록은 질문 경로(`ask: "read"`)와 같은 기준이다 | 1:1 · 단톡 방(`list_chat` 포함), 개인 질문 기록, 채용 · 관리 설정이 빠진다. 0·1단계는 개인정보를 보내지 않는다는 결정을 지킨다 |
| 토큰 원문은 어디에도 남지 않는다 | 발급(`store.ts mintToken`) → 같은 단계에서 vault 로만 간다. Workflow 단계 인자는 작업 ID 뿐이다. 만료는 `WORKBENCH_MAX_MINUTES + 15분`이고, 끝나면 폐기한다 |
| 네트워크는 `limited` 다 | 패키지 저장소와 에이전트의 MCP 서버만 연다. 웹 검색 · 가져오기 도구는 끈다 |
| 비용 | 1건 상한은 세션 예산(`budget`)으로 Anthropic 이 막는다. 사람별 · 회사 월 상한은 옴니스가 시작 전에 막는다(도는 작업은 잡아 둔 예산으로 센다) |

## 운영에 켜기 (정우창이 직접)

1. **마이그레이션** `20261126180000_workbench` 를 운영에 먼저 적용하고(`pnpm run db:deploy`) 그다음 머지한다.
   - 이 마이그레이션은 `AiUsage` 에 칼럼 2개, `WorkbenchJob` 표, `ip.oauth_clients` 의 `omnis-workbench` 행 1개를 만든다.
2. **에이전트 · 환경 만들기** — 키가 속한 작업 공간에 한 번 만든다.
   ```
   WORKBENCH_ANTHROPIC_API_KEY=… WORKBENCH_MCP_URL=https://omnis.haddscience.com/api/ip-mcp npx tsx scripts/workbench-setup.ts
   ```
   - 출력된 `WORKBENCH_AGENT_ID` · `WORKBENCH_ENVIRONMENT_ID` 를 적어 둔다.
   - 키는 출력하지 않는다.
3. **Vercel 운영 환경변수**(omnis-hadd)

   | 이름 | 값 |
   |---|---|
   | `WORKBENCH_ANTHROPIC_API_KEY` | Anthropic API 키(지금은 정우창 개인 계정, 나중에 회사 계정) |
   | `WORKBENCH_AGENT_ID` · `WORKBENCH_ENVIRONMENT_ID` | 2번 결과 |
   | `WORKBENCH_USER_IDS` | 켤 사람의 User.id(쉼표). 0단계는 정우창만 |
   | `WORKBENCH_MCP_URL` | 생략하면 `PUBLIC_URL` + `/api/ip-mcp` |
   | `WORKBENCH_MODEL` | 생략하면 `claude-sonnet-5-5`. 바꾸면 2번을 `--agent <id>` 로 다시 돌린다 |
   | `WORKBENCH_TASK_LIMIT_KRW` · `WORKBENCH_USER_MONTHLY_KRW` · `WORKBENCH_COMPANY_MONTHLY_KRW` | 생략하면 3,000 · 30,000 · 30,000 |
   | `WORKBENCH_KRW_PER_USD` · `WORKBENCH_MAX_MINUTES` | 생략하면 1,468.8(부가세 포함) · 60 |

   env 는 새 배포에만 반영된다. 넣은 뒤 재배포한다.
4. **회사 계정으로 옮길 때**는 키를 바꾸고 2번을 다시 돌려 ID 두 개를 바꾼다. 코드는 그대로다.

**끄기**: `WORKBENCH_USER_IDS` 를 비우고 재배포한다. 도구 3개가 사라지고, 도는 작업은 끝까지 간다.

## 로컬 시범 (DB · 옴니스 없이)

```
npx tsx scripts/workbench-setup.ts --no-mcp            # MCP 없는 시험용 에이전트
WORKBENCH_AGENT_ID=… WORKBENCH_ENVIRONMENT_ID=… OUT=/tmp/wb npx tsx scripts/workbench-try.ts
```

`workbench-try.ts` 는 가짜 지원자 2명으로 묶음 PDF 를 만든다. 실행기(`runner.ts`)는 운영과 같고, 저장소만 메모리 · 폴더로 바꿨다.

## 확인한 실행 환경 (2026-11-26 실측)

| 항목 | 결과 |
|---|---|
| 한글 글꼴 | apt `fonts-nanum` · `fonts-nanum-extra` · `fonts-noto-cjk` 설치됨. NanumSquare · NanumSquareRound · 나눔고딕 · 나눔명조 · Noto Sans CJK. 한글 PPT → PDF 에 NanumSquareR 이 들어갔다(pdffonts) |
| LibreOffice | 24.2.7.2 기본 |
| python-pptx · pypdf | 1.0.2 · 3.17.4 기본 |
| HWPX | pip `python-hwpx` 7.0.2 설치됨 |
| HWP(5.x 바이너리) | pip `pyhwp` 는 설치 실패(`session.error`: pip could not install pyhwp). 그래서 환경 정의에서 뺐다 |
| 네트워크 | `limited` 에서 example.com 은 이름 풀이부터 막혔다. 패키지 저장소는 열렸다 |

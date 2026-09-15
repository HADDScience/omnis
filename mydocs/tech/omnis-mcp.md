---
kind: canonical
status: active
canonical: mydocs/tech/omnis-mcp.md
last_verified: 2026-09-14
---

# hadd-omnis — Omnis 의 원격 MCP 서버

hadd-ip(지식재산권만 열던 서버)를 넓힌 것이다. 2026-09-07 `omnis-hadd` 로 넓혔고, 2026-09-14 이름을
`hadd-omnis` 로 바꿨다(`serverInfo.name` · `WWW-Authenticate` realm). 주소는 그대로다.

**주소: `https://haddscience.vercel.app/omnis/api/ip-mcp`** (2026-09-07 한 도메인 이전 뒤). issuer 가 주소라
옛 주소(`omnis-hadd.vercel.app/api/ip-mcp`)로 붙인 커넥터는 다시 연결해야 한다 — 옛 주소는 307 로 넘겨주지만 MCP 클라이언트는 POST redirect 를 따라가지 않는다.

주소의 `ip-mcp` 는 이름을 바꾸면서도 두었다. issuer·resource 식별자가 주소라 경로를 바꾸면 붙어 있는 커넥터가 전부 끊긴다.
claude.ai 커넥터 목록에 보이는 이름은 서버가 아니라 **커넥터를 추가할 때 사람이 적은 이름**이다 — 「HADD IP」로 보이면 커넥터를 지우고 `hadd-omnis` 로 다시 추가한다.

| 것 | 어디 |
|---|---|
| 도구·지침·토큰 해석·파일 링크 서명 | `lib/omnis-mcp.ts` |
| 지식재산권 도구 (그대로) | `lib/ip-mcp.ts` — 설명 한 글자도 안 바꿨다 |
| 엔드포인트 + OAuth 2.1 + `/upload` · `/download` | `app/api/ip-mcp/[[...path]]/route.ts` |
| 승인 화면 | `app/ip-mcp/authorize/` |
| 화면과 함께 쓰는 알맹이 | `lib/chat-post.ts` · `lib/omnis-ask.ts` · `lib/notifications.ts`(respondToAction) · `lib/task-update.ts` · `lib/checklists.ts` · `lib/company-tools.ts` |
| 검증 | `scripts/verify-ip-mcp.ts` (OAuth·IP 37) · `scripts/verify-omnis-mcp.ts` (옴니스 도구 76) · `scripts/verify-moved-routes.ts` (옮긴 화면 라우트 13) |

## 붙이는 법

claude.ai → 설정 → 커넥터 → 커스텀 커넥터 추가 → 이름 `hadd-omnis` · 주소 `https://haddscience.vercel.app/omnis/api/ip-mcp`.
OAuth 로 Omnis 로그인 → 승인 화면 → 끝. 8시간마다 자동 갱신. 이미 붙여 둔 커넥터는
**다시 연결하지 않아도** 도구 목록만 넓어진다(`tools/list` 는 매번 서버에서 온다).

CLI(`claude mcp add`)는 개인 토큰(`hadd_…`)을 헤더로 보낸다. 개인 토큰 발급은 아직
IP 플랫폼의 「AI 도구 설치하기」(`/api/ip/mcp-token`) 에만 있고 지식재산권 구성원만 받는다 — 옮겨야 할 일.

## 권한 — 무엇이 바뀌었나

| | hadd-ip | hadd-omnis |
|---|---|---|
| 승인(approve) | `ip.members` 만 | **Omnis 활성 계정 전원** |
| 토큰 → 사람 | DB 함수가 `ip.members` 와 조인 | `ip.oauth_tokens`/`mcp_tokens` → `User` · 멤버십은 따로 붙임 |
| 지식재산권 도구 | 전부 | **호출 시점**에 멤버십 확인. 없으면 isError 로 거절 |

Prisma 는 DB 소유자로 붙으므로 `lib/omnis-mcp.ts` 가 곧 권한 경계다.
업무·체크리스트 수정은 화면 라우트와 같은 권한이다 — 로그인한 구성원이면 누구나. 알림 응답만 **본인 알림**으로 막힌다.

## 도구 33개

`lib/omnis-mcp.ts` 의 `TOOLS = [...OMNIS_TOOLS, ...IP_TOOLS]` — 옴니스 25(업무 · 파일 · 알림 19 + 회사 Context 6) · 지식재산권 8.
화면의 옴니스 질문(`lib/omnis-ask.ts`)도 `OMNIS_TOOLS` 에서 `ask_omnis` · `post_message` · `create_task` · `search_knowledge` 를 뺀 나머지를 같은 `runTool` 로 부른다.

옴니스 19 — 읽기 12, 쓰기 7:

| 도구 | 무엇 |
|---|---|
| `ask_omnis` | 화면의 「Omnis AI 에게 질문하기」와 같은 것. `lib/omnis-ask.askOmnis` |
| `search_knowledge` | 벡터 검색 조각 그대로 (출처·유사도·본문) |
| `list_tasks` `get_task` | 업무 목록·상세(번호 붙은 체크리스트·최근 대화·첨부와 파일 ID). 슬러그·ID·이름 일부로 찾는다 |
| `list_projects` `list_members` | 과제 목록 · 구성원 정식 이름 (시스템 계정은 뺀다) |
| `crm_overview` `find_org` | CRM 현황 전량 · 기관 하나의 담당자·견적·샘플·출고 |
| `list_omnis_cards` `get_omnis_card` | 지식 카드 |
| `read_file` | 첨부 읽기 — 텍스트 본문 · 엑셀은 시트별 CSV · 이미지는 image content · 나머지(PDF·워드·한글)는 내려받기 링크 |
| `list_notifications` | 본인 알림. 응답 대기(업무 수락·완료 확인)를 먼저 |
| `post_message` | **채팅에 글.** `lib/chat-post.postChatMessage` — 화면과 같은 길. `files` 로 첨부 |
| `create_task` | 업무 생성 + 담당자 수락 알림 + 채팅에 지시·카드 게시 + 색인 |
| `upload_file` | 텍스트(`content`)·작은 바이너리(`content_base64`)를 NAS 에 올리고 파일 ID 를 준다 |
| `create_upload_link` | 셸에서 `curl -F file=@…` 로 올리는 10분짜리 서명 링크 |
| `respond_notification` | 알림 버튼과 같은 것. `lib/notifications.respondToAction` |
| `update_task` | 업무 상세에서 고치는 것과 같은 것. `lib/task-update.updateTask` |
| `update_checklist` | 추가·체크·해제·삭제. `lib/checklists` |

`post_message` 는 화면과 달리 AI 재구성을 **기다려** 결과를 글로 돌려준다. 화면 경로는 응답 뒤로 미룬다 — [chat-post.md](chat-post.md).

회사 Context 6 — 읽기만 (PR #11, `lib/company-tools.ts`). 연락처 · 이메일 · 생년월일 · 과학기술인번호 · 서명은 내보내지 않는다 — [company-context.md](company-context.md).

| 도구 | 무엇 |
|---|---|
| `company_profile` | 회사 기본정보 · 연도별 재무(확정 · 잠정 · 계획) |
| `list_company_records` | 연혁 · 실적 — 지원사업 · 수상 · 학회 · 전시 … |
| `list_tax_invoices` | 세금계산서 · 연도별 매출 합 |
| `list_staff` | 인력 — 이름 · 소속 · 직급 · 직함 · 담당 · 학력 · 4대보험 |
| `list_market_companies` | 시장 · 경쟁 기업 |
| `get_context` | 대상 하나의 외래키 · 임베딩 이웃. 인력 노드는 관리자에게만 |

지식재산권 8 — `read_guide` `list_stages` `list_ip` `get_ip` `list_todo` `add_progress` `correct_ip` `create_ip` (변경 없음).

### 전송 — 스트림 GET 에는 405 (PR #17, 머지 전)

Streamable HTTP 클라이언트가 서버 메시지를 받으려고 여는 `GET`(`Accept: text/event-stream`)에 `405` · `Allow: POST, OPTIONS` 로 답한다.
이 서버는 먼저 보낼 메시지가 없다. 예전에는 모든 GET 에 200 + 서버 정보 JSON 을 주고 끊었고, 재연결이 반복되어 운영 요청의 65.6% 가 이 경로였다(2026-09-15 로그).
`.well-known/*` · `/authorize` · `/download` · 일반 GET 은 그대로다. PR #17 이 머지되기 전 main 에는 이 분기가 없다. 경위와 한도: [request-budget.md](request-budget.md).

### 쓰기는 화면과 같은 길로만

MCP 도구는 라우트가 부르는 바로 그 함수를 부른다. 그러려고 라우트에서 알맹이를 lib 로 옮겼다 —
`chat-post` · `omnis-ask`(2026-09-07), `notifications.respondToAction` · `task-update` · `checklists`(2026-09-14).
MCP 전용 지름길을 만들면 알림·AI 재구성·완료 확인·색인·활동 기록 중 하나가 빠지고, 그것은 조용히 빠진다.

`create_task` 만 예외로 `app/api/tasks` 를 부르지 않고 같은 일을 다시 한다(담당자 알림 ·
지시 원문 + 카드 채팅 게시 · 색인). 그 라우트는 신규 제품·프로젝트 트랜잭션까지 끌고
있어 지금 옮기기엔 컸다. 둘이 어긋나면 이쪽을 라우트에 맞춘다.

화면과 다르게 **MCP 에서만 더 확인하는 것** — 모델이 ID·이름을 잘못 옮기는 경우를 막는다.

- `post_message.files` — 없는 ID, 이미 다른 메시지에 붙은 파일은 거절(화면 라우트는 확인 없이 덮어쓴다).
- `update_checklist` — 가리킨 항목을 먼저 전부 해석하고, 하나라도 못 찾거나 여럿 걸리면 아무것도 바꾸지 않는다.
  순서는 remove → add → check → uncheck, 번호는 고치기 전 목록 기준.
- `update_task` — 상태·우선순위·마감 형식, 프로젝트 이름을 확인. 바꿀 필드가 없으면 거절.

### 파일 (2026-09-14)

올리기 순서는 화면(`app/api/files` POST)과 같다 — NAS(`lib/storage.putObject`)에 먼저 올리고 성공한 뒤에만 `File` 을 적는다.
그 라우트와 `lib/storage.ts` 는 배포 파일이라 고치지 않고 함수만 부른다(`ai-pairing.md`).

- **두 길인 이유.** 모델이 파일 본문을 도구 인자로 옮기는 것은 텍스트나 수 KB 짜리까지만 현실적이다. 1MB PDF 의 base64 는
  130만 자다. 셸이 있는 클라이언트(Claude Code)는 링크로 본문을 대화 밖에서 주고받는다.
- **링크는 상태 없는 서명이다.** `base64url({u, t|f, e}).HMAC-SHA256("mcp-{upload|download}." + payload)`, 비밀은 `AUTH_SECRET`/`NEXTAUTH_SECRET`.
  claude.ai 커넥터는 OAuth 토큰을 모델에게 보여주지 않으므로 링크 자체가 자격이어야 한다. 용도를 서명에 섞어 업로드 링크로
  내려받을 수 없다. 10분 동안 여러 번 쓸 수 있고, 검증할 때 계정이 닫혔으면 거절한다. 한 번만 쓰게 하려면 표가 필요하다.
- **상한 4MB** (`MAX_UPLOAD_BYTES`). Vercel 함수 본문 상한 때문이다. `upload_file` 은 base64 팽창(4/3) 때문에 실제로는 약 3MB.
  `read_file` 은 4MB 넘는 파일(NAS 에서 들여온 것)도 본문 대신 링크를 준다. 텍스트는 10만 자에서 자른다.
- **형식.** 주어진 형식이 없거나 `application/octet-stream`(curl 기본값)이면 확장자로 정하고, 텍스트에는 `; charset=utf-8` 을 붙인다.
- **PDF·워드·한글 본문은 못 푼다.** 파서 의존성을 들이지 않았다. 필요해지면 `read_file` 의 `other` 갈래에 붙인다.

## 🤖 메시지 작성자 — 시스템 계정 (2026-09-14)

`lib/chat-post.ts` 가 남기는 재구성·완료 확인 대기 메시지의 작성자는 시스템 계정 `system`(이름 `Omnis`)이다. `lib/system-user.ts`.

- **왜.** 예전에는 `HADD MCP` 사용자 → 없으면 정렬 없는 첫 ADMIN 이었다. 그 계정이 어느 DB 에도 없어 Postgres 가
  먼저 돌려준 관리자(행이 갱신되면 바뀐다)가 작성자가 됐다 — 허채정 지시·정우창 수행 업무에 「담당자 확인을 기다립니다」가
  김아리 이름으로 찍혔다.
- **마이그레이션 없음.** 코드가 처음 쓸 때 upsert 한다. id 가 `system` 인 것은 `components/chat/message-list.tsx` 가 이미 그 id 를
  시스템 메시지로 그리기 때문이다.
- **사람이 아니다.** `isActive=false` 라 로그인·SSO·`/api/users` 가 걸러낸다. `passwordHash` 는 `!` 라 어떤 비밀번호와도 맞지 않는다.
  `isActive` 를 거르지 않는 곳 두 군데에서 따로 뺐다 — AI 담당자 후보(`app/api/ai/structure-task`)와 `list_members(includeInactive)`.
- **이미 쌓인 메시지.** `scripts/backfill-system-author.ts` — 기본은 미리보기, `--apply` 가 바꾸고 원래 작성자를 JSON 으로 남긴다.
  프로덕션은 아직 돌리지 않았다.

## 검증 (2026-09-14 로컬, 워크트리 `~/work/omnis-mcp` · DB `omnis_mcp` · :3100)

```
IP_MCP_BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-ip-mcp.ts        → 37 passed, 0 failed
IP_MCP_BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-omnis-mcp.ts     → 76 passed, 0 failed
BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-system-author.ts        → 10 passed, 0 failed
BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-moved-routes.ts         → 13 passed, 0 failed
```

main `4c85a28`(PR #9) 위로 rebase 한 뒤의 결과다. 그 전 실행에서는 로컬 Gemini 키가 월 지출 상한(429)에 걸려
Gemini 를 부르는 3건이 실패했고, 상한이 풀린 뒤 통과했다.

`verify-omnis-mcp` 는 Gemini 가 살아 있으면 `post_message` 가 체크리스트를 실제로 재구성한다. 체크리스트 검증은 그 뒤
목록을 알려진 상태로 되돌리고 시작한다 — 그러지 않으면 Gemini 가 살아 있을 때만 실패한다.

거부 사례가 들어 있다 — 가짜 토큰 401, 비구성원의 `list_ip`, 모르는 도구·담당자·업무, 본문 없는/둘 다 준/4MB 넘는 업로드,
서명이 틀린·만료된·토큰 없는 업로드 링크, 업로드 링크로 내려받기, 서명이 틀린 내려받기 링크, 없는 파일, 이미 붙은 파일의 재사용,
모르는 상태·프로젝트·날짜, 바꿀 것 없는 수정, 없는 항목·범위 밖 번호(아무것도 안 바뀌는지까지), 남의 알림 응답, 허용되지 않는 응답,
두 번 누른 완료 확인(지시자 알림이 1건인지까지), 시스템 계정 로그인·담당자 지정. 통과 사례만 있는 시험은 아무것도 지키지 못한다.

## 함정

- `ip.oauth_tokens.client_id` 는 `oauth_clients` 에 FK cascade 다. 검증 스크립트에서 클라이언트를
  먼저 지웠더니 토큰이 따라 지워져 tools/list 가 401 이 났다. 정리는 맨 끝에서.
- 커넥터가 들고 있는 도구 스키마는 처음 붙일 때의 사본이다(ip-schema.md 「쓰기 게이트」). 새 도구는
  `tools/list` 로 오지만, **인자가 바뀐 도구**는 클라이언트가 옛 인자로 부를 수 있다. `post_message.files` 가 그렇다.
- `File` 이 `ChatMessage`·`Task` 를 FK 로 물고 있다. 검증 정리에서 파일을 먼저 지우고 NAS 실물(`deleteObject`)도 함께 지운다.
- 추론된 반환 타입의 객체 리터럴 유니온은 `{ error?: undefined }` 로 정규화돼 `"error" in r` 로 좁혀지지 않는다.
  lib 함수가 `{ error } | { ... }` 를 돌려주면 반환 타입을 적는다(`lib/task-update.ts`).

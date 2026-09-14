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
| 도구·지침·토큰 해석·업로드 | `lib/omnis-mcp.ts` |
| 지식재산권 도구 (그대로) | `lib/ip-mcp.ts` — 설명 한 글자도 안 바꿨다 |
| 엔드포인트 + OAuth 2.1 + 업로드 링크 | `app/api/ip-mcp/[[...path]]/route.ts` |
| 승인 화면 | `app/ip-mcp/authorize/` |
| 검증 | `scripts/verify-ip-mcp.ts` (OAuth·IP 37가지) · `scripts/verify-omnis-mcp.ts` (옴니스 도구 44가지) |

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

## 도구 22개

옴니스 14 — 읽기 10, 쓰기 4:

| 도구 | 무엇 |
|---|---|
| `ask_omnis` | 화면의 「Omnis AI 에게 질문하기」와 같은 것. `lib/omnis-ask.askOmnis` |
| `search_knowledge` | 벡터 검색 조각 그대로 (출처·유사도·본문) |
| `list_tasks` `get_task` | 업무 목록·상세(체크리스트·최근 대화·첨부). 슬러그·ID·이름 일부로 찾는다 |
| `list_projects` `list_members` | 과제 목록 · 구성원 정식 이름 |
| `crm_overview` `find_org` | CRM 현황 전량 · 기관 하나의 담당자·견적·샘플·출고 |
| `list_omnis_cards` `get_omnis_card` | 지식 카드 |
| `post_message` | **채팅에 글.** `lib/chat-post.postChatMessage` — 화면과 같은 길. `files` 로 첨부 |
| `create_task` | 업무 생성 + 담당자 수락 알림 + 채팅에 지시·카드 게시 + 색인 |
| `upload_file` | 텍스트(`content`)·작은 바이너리(`content_base64`)를 NAS 에 올리고 파일 ID 를 준다. `task` 를 주면 업무 첨부 |
| `create_upload_link` | 셸에서 `curl -F file=@…` 로 올리는 10분짜리 서명 링크 |

지식재산권 8 — `read_guide` `list_stages` `list_ip` `get_ip` `list_todo` `add_progress` `correct_ip` `create_ip` (변경 없음).

### 쓰기는 화면과 같은 길로만

`post_message` 와 `ask_omnis` 는 라우트가 부르는 바로 그 함수를 부른다. 그러려고 라우트에서
`lib/chat-post.ts` · `lib/omnis-ask.ts` 로 알맹이를 옮겼다(2026-09-07) — MCP 전용 지름길을
만들면 알림·AI 재구성·완료 확인·색인 중 하나가 빠지고, 그것은 조용히 빠진다.

`create_task` 만 예외로 `app/api/tasks` 를 부르지 않고 같은 일을 다시 한다(담당자 알림 ·
지시 원문 + 카드 채팅 게시 · 색인). 그 라우트는 신규 제품·프로젝트 트랜잭션까지 끌고
있어 지금 옮기기엔 컸다. 둘이 어긋나면 이쪽을 라우트에 맞춘다.

### 파일 올리기 (2026-09-14)

순서는 화면(`app/api/files` POST)과 같다 — NAS(`lib/storage.putObject`)에 먼저 올리고 성공한 뒤에만 `File` 을 적는다.
그 라우트와 `lib/storage.ts` 는 배포 파일이라 고치지 않고 함수만 부른다(`ai-pairing.md`).

- **두 길인 이유.** 모델이 파일 본문을 도구 인자로 옮기는 것은 텍스트나 수 KB 짜리까지만 현실적이다. 1MB PDF 의 base64 는
  130만 자다. 셸이 있는 클라이언트(Claude Code)는 `create_upload_link` 로 본문을 대화 밖에서 보낸다.
- **링크는 상태 없는 서명이다.** `base64url({u,t,e}).HMAC-SHA256(AUTH_SECRET||NEXTAUTH_SECRET)`. 표를 새로 만들지 않았다.
  claude.ai 커넥터는 OAuth 토큰을 모델에게 보여주지 않으므로 링크 자체가 자격이어야 한다. 10분 동안 여러 번 쓸 수 있고,
  검증할 때 계정이 닫혔으면 거절한다. 한 번만 쓰게 하려면 표가 필요하다.
- **상한 4MB** (`MAX_UPLOAD_BYTES`). Vercel 함수 본문 상한 때문이다. `upload_file` 은 base64 팽창(4/3) 때문에 실제로는 약 3MB.
- **형식.** 주어진 형식이 없거나 `application/octet-stream`(curl 기본값)이면 확장자로 정하고, 텍스트에는 `; charset=utf-8` 을 붙인다.
- **`post_message.files` 는 확인한다.** 없는 ID, 이미 다른 메시지에 붙은 파일은 isError. 화면 라우트는 확인 없이
  `messageId` 를 덮어쓴다 — 모델이 ID 를 잘못 옮기면 남의 첨부를 빼앗아 오므로 여기서 막는다.

## 검증 (2026-09-14 로컬, 워크트리 `~/work/omnis-mcp` · DB `omnis_mcp` · :3100)

```
IP_MCP_BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-ip-mcp.ts     → 37 passed, 0 failed
IP_MCP_BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-omnis-mcp.ts  → 41 passed, 3 failed
```

실패 3건(`search_knowledge` · `post_message` 처리 결과 · `ask_omnis`)은 로컬 Gemini 키가 월 지출 상한에 걸려
429 를 받은 것이다(dev 로그: `Your project has exceeded its monthly spending cap`). 파일 올리기 18가지는 전부 통과.

거부 사례가 들어 있다 — 가짜 토큰 401, 비구성원의 `list_ip`, 모르는 도구, 담당자 없는
`create_task`, 없는 업무, 모르는 담당자 이름, 본문 없는/둘 다 준/4MB 넘는 업로드, 서명이 틀린·만료된·토큰 없는
업로드 링크, `file` 필드 없는 업로드, 없는 파일 ID, 이미 붙은 파일의 재사용. 통과 사례만 있는 시험은 아무것도 지키지 못한다.

## 함정

- `ip.oauth_tokens.client_id` 는 `oauth_clients` 에 FK cascade 다. 검증 스크립트에서 클라이언트를
  먼저 지웠더니 토큰이 따라 지워져 tools/list 가 401 이 났다. 정리는 맨 끝에서.
- 커넥터가 들고 있는 도구 스키마는 처음 붙일 때의 사본이다(ip-schema.md 「쓰기 게이트」). 새 도구는
  `tools/list` 로 오지만, **인자가 바뀐 도구**는 클라이언트가 옛 인자로 부를 수 있다. `post_message.files` 가 그렇다.
- `File` 이 `ChatMessage`·`Task` 를 FK 로 물고 있다. 검증 정리에서 파일을 먼저 지우고 NAS 실물(`deleteObject`)도 함께 지운다.

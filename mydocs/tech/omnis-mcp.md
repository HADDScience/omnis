---
kind: canonical
status: active
canonical: mydocs/tech/omnis-mcp.md
last_verified: 2026-09-07
---

# omnis-hadd — Omnis 의 원격 MCP 서버

hadd-ip(지식재산권만 열던 서버)를 넓힌 것이다. 주소는 그대로 `<Omnis>/api/ip-mcp` —
issuer 와 resource 식별자가 주소라 바꾸면 붙어 있는 커넥터가 전부 끊긴다. 이름만 `omnis-hadd` 다.

| 것 | 어디 |
|---|---|
| 도구·지침·토큰 해석 | `lib/omnis-mcp.ts` |
| 지식재산권 도구 (그대로) | `lib/ip-mcp.ts` — 설명 한 글자도 안 바꿨다 |
| 엔드포인트 + OAuth 2.1 | `app/api/ip-mcp/[[...path]]/route.ts` |
| 승인 화면 | `app/ip-mcp/authorize/` |
| 검증 | `scripts/verify-ip-mcp.ts` (OAuth·IP 37가지) · `scripts/verify-omnis-mcp.ts` (옴니스 도구 25가지) |

## 붙이는 법

claude.ai → 설정 → 커넥터 → 커스텀 커넥터 추가 → 주소 `https://omnis-hadd.vercel.app/api/ip-mcp`.
OAuth 로 Omnis 로그인 → 승인 화면 → 끝. 8시간마다 자동 갱신. 이미 hadd-ip 로 붙여 둔 커넥터는
**다시 연결하지 않아도** 도구 목록만 넓어진다(`tools/list` 는 매번 서버에서 온다).

CLI(`claude mcp add`)는 개인 토큰(`hadd_…`)을 헤더로 보낸다. 개인 토큰 발급은 아직
IP 플랫폼의 「AI 도구 설치하기」(`/api/ip/mcp-token`) 에만 있고 지식재산권 구성원만 받는다 — 옮겨야 할 일.

## 권한 — 무엇이 바뀌었나

| | hadd-ip | omnis-hadd |
|---|---|---|
| 승인(approve) | `ip.members` 만 | **Omnis 활성 계정 전원** |
| 토큰 → 사람 | DB 함수가 `ip.members` 와 조인 | `ip.oauth_tokens`/`mcp_tokens` → `User` · 멤버십은 따로 붙임 |
| 지식재산권 도구 | 전부 | **호출 시점**에 멤버십 확인. 없으면 isError 로 거절 |

Prisma 는 DB 소유자로 붙으므로 `lib/omnis-mcp.ts` 가 곧 권한 경계다.

## 도구 20개

옴니스 12 — 읽기 10, 쓰기 2:

| 도구 | 무엇 |
|---|---|
| `ask_omnis` | 화면의 「Omnis AI 에게 질문하기」와 같은 것. `lib/omnis-ask.askOmnis` |
| `search_knowledge` | 벡터 검색 조각 그대로 (출처·유사도·본문) |
| `list_tasks` `get_task` | 업무 목록·상세(체크리스트·최근 대화·첨부). 슬러그·ID·이름 일부로 찾는다 |
| `list_projects` `list_members` | 과제 목록 · 구성원 정식 이름 |
| `crm_overview` `find_org` | CRM 현황 전량 · 기관 하나의 담당자·견적·샘플·출고 |
| `list_omnis_cards` `get_omnis_card` | 지식 카드 |
| `post_message` | **채팅에 글.** `lib/chat-post.postChatMessage` — 화면과 같은 길 |
| `create_task` | 업무 생성 + 담당자 수락 알림 + 채팅에 지시·카드 게시 + 색인 |

지식재산권 8 — `read_guide` `list_stages` `list_ip` `get_ip` `list_todo` `add_progress` `correct_ip` `create_ip` (변경 없음).

### 쓰기는 화면과 같은 길로만

`post_message` 와 `ask_omnis` 는 라우트가 부르는 바로 그 함수를 부른다. 그러려고 라우트에서
`lib/chat-post.ts` · `lib/omnis-ask.ts` 로 알맹이를 옮겼다(2026-09-07) — MCP 전용 지름길을
만들면 알림·AI 재구성·완료 확인·색인 중 하나가 빠지고, 그것은 조용히 빠진다.

`create_task` 만 예외로 `app/api/tasks` 를 부르지 않고 같은 일을 다시 한다(담당자 알림 ·
지시 원문 + 카드 채팅 게시 · 색인). 그 라우트는 신규 제품·프로젝트 트랜잭션까지 끌고
있어 지금 옮기기엔 컸다. 둘이 어긋나면 이쪽을 라우트에 맞춘다.

## 검증 (2026-09-07 로컬)

```
IP_MCP_BASE=http://localhost:3000 npx tsx scripts/verify-ip-mcp.ts     → 37 passed, 0 failed
IP_MCP_BASE=http://localhost:3000 npx tsx scripts/verify-omnis-mcp.ts  → 25 passed, 0 failed
```

거부 사례가 들어 있다 — 가짜 토큰 401, 비구성원의 `list_ip`, 모르는 도구, 담당자 없는
`create_task`, 없는 업무, 모르는 담당자 이름. 통과 사례만 있는 시험은 아무것도 지키지 못한다.

## 함정

- `ip.oauth_tokens.client_id` 는 `oauth_clients` 에 FK cascade 다. 검증 스크립트에서 클라이언트를
  먼저 지웠더니 토큰이 따라 지워져 tools/list 가 401 이 났다. 정리는 맨 끝에서.
- 커넥터가 들고 있는 도구 스키마는 처음 붙일 때의 사본이다(ip-schema.md 「쓰기 게이트」). 새 도구는
  `tools/list` 로 오지만, **인자가 바뀐 도구**는 클라이언트가 옛 인자로 부를 수 있다.

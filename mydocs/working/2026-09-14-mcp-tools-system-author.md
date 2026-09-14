---
kind: snapshot
status: active
canonical: mydocs/tech/omnis-mcp.md
last_verified: 2026-09-14
---

# 2026-09-14 — hadd-omnis 이름 · MCP 파일/알림/업무 도구 · 🤖 메시지 시스템 계정

브랜치 `feat/mcp-hadd-omnis` (워크트리 `~/work/omnis-mcp`, main `5fdc4fa` 에서). `omnis-local` 은 다른 세션이
`feat/thread-attach-mention` 을 쓰고 있어 브랜치를 바꾸지 않고 워크트리를 따로 만들었다. DB 는 `omnis` 를 `omnis_mcp` 로 복제, dev 서버 :3100.

## 작업지시

1. MCP 서버 이름 hadd-ip → hadd-omnis, 파일 업로드
2. AI 가 Omnis 자원에 접근할 때 MCP 에 빠진 것 점검 → 높음 세 가지(첨부 읽기 · 알림 응답 · 업무/체크리스트 수정) 추가
3. 허채정 지시·정우창 수행 업무에 「담당자 확인을 기다립니다」를 왜 김아리가 보냈나 → 시스템 계정으로 고친다

## 원인 — 3

`lib/chat-post.ts` 가 🤖 메시지 작성자를 `findFirst({ name: "HADD MCP" }) ?? findFirst({ role: "ADMIN" })` 로 골랐다.
`HADD MCP` 는 없고 두 번째 조회에 정렬이 없다. 로컬 스냅샷(프로덕션 복사, 최신 메시지 2026-09-10) 실측:

```
2026-09-08 05:59  허채정  TASK_DONE_PENDING  🤖 #09080558-치매진단플랫폼-킥오프-데모-준비 완료로 보입니다 — 담당자 확인을 기다립니다
2026-09-10 02:10  김아리  TASK_DONE_PENDING  🤖 #09100209-치매진단플랫폼-킥오프-데모-준비 완료로 보입니다 — 담당자 확인을 기다립니다   (지시자 허채정)
```

같은 코드가 09-08 에는 허채정, 09-10 에는 김아리를 작성자로 골랐다. 2026-09-08 시나리오 E2E 보고서가 이미 적어 둔 사실이다
(`mydocs/working/2026-09-08-scenario-e2e.md` 1번, 「판단 대기」). 프로덕션 DB 는 이번에 읽지 않았다.

## 결과

| 커밋 | 무엇 |
|---|---|
| `478035e` | 이름 hadd-omnis · `upload_file` · `create_upload_link` · `post_message.files` |
| `0836430` | 시스템 계정 · 백필 스크립트 · 시스템 계정 검증 |
| (이 문서와 함께) | `read_file` · `list_notifications` · `respond_notification` · `update_task` · `update_checklist`, 라우트 알맹이 lib 이동 |

설계와 불변식은 canonical 문서 `mydocs/tech/omnis-mcp.md` 에 있다.

## 실측

```
$ npx tsc --noEmit                                   → exit 0
$ npx eslint <바꾼 파일 14개>                         → exit 0

$ IP_MCP_BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-ip-mcp.ts
통과: 37 passed, 0 failed

$ IP_MCP_BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-omnis-mcp.ts
  ✗ search_knowledge 가 유사도와 함께 조각을 준다
  ✗ post_message 가 업무에 붙고 처리 결과를 말한다
  ✗ ask_omnis 가 답과 근거를 준다
실패: 73 passed, 3 failed

$ BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-system-author.ts
통과: 10 passed, 0 failed

$ BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-moved-routes.ts
통과: 13 passed, 0 failed
```

실패 3건은 전부 Gemini 호출이다. dev 로그:

```
Error: Gemini 임베딩 API 오류 (RETRIEVAL_QUERY): 429 … "Your project has exceeded its monthly spending cap."
```

로컬 `.env` 의 Gemini 키가 월 지출 상한에 걸렸다. 프로덕션이 같은 키를 쓰는지는 확인하지 않았다.

### 백필 (로컬 복제 DB 만)

```
$ npx tsx --env-file=.env scripts/backfill-system-author.ts
대상 DB: localhost:5433 · 미리보기
옮길 메시지 36건 — 허채정 27, 김아리 9
종류: TASK_DONE_PENDING 22, TASK_REBUILT 14

$ npx tsx --env-file=.env scripts/backfill-system-author.ts --apply
바꿈 36건 · 원래 작성자 기록 backfill-system-author-2026-09-14T062241489Z.json

$ (다시 미리보기)
옮길 메시지 0건 — 없음
```

검증이 남긴 데이터: `__` 로 시작하는 사용자·업무·파일·OAuth 클라이언트 0건.

## 남은 것

- **프로덕션 반영**: 푸시·PR·배포는 승인 뒤. 배포 뒤 프로덕션에서 백필 미리보기 → `--apply`. 마이그레이션은 없다.
- **커넥터 다시 추가**: claude.ai 의 「HADD IP」 커넥터가 옛 Supabase 주소를 가리켜 410. 이름 `hadd-omnis`, 주소 `https://haddscience.vercel.app/omnis/api/ip-mcp`.
- **점검에서 나온 중간·낮음**: 주간보고 읽기·쓰기, 지식 카드 쓰기, 업무 밖 최근 채팅, CRM 쓰기, 제품 목록, NAS 탐색, 개인 토큰 발급이 IP 구성원 전용.
- **안 고친 기존 동작**: 상세 화면에서 업무를 완료로 바꾸면 지시자에게 알림이 없다(09-08 보고서 2번). `update_task` 도 같은 길이라 같다.

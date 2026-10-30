---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-30-omnis-outputs.md
last_verified: 2026-10-30
---

# 옴니스 메신저 4단계 — 결과물 (문서 초안 · 파일 생성 · 대화 → 지식)

계획: [`../plans/2026-10-28-omnis-messenger-agent.md`](../plans/2026-10-28-omnis-messenger-agent.md) 「### 4. 결과물」 · 「folding 에서 가져올 것」 3번(자기검증 쓰기).
3단계(확인 흐름): [`2026-10-29-omnis-agent.md`](2026-10-29-omnis-agent.md), 중지(STOPPED): [`2026-10-30-chat-scale.md`](2026-10-30-chat-scale.md), 기록 제안: [`2026-10-06-record-proposals.md`](2026-10-06-record-proposals.md).
브랜치 `feat/omnis-outputs`(origin/main 8df4f49 기준), 워크트리 `../omnis-outputs`. push · PR 하지 않았다.

## 커밋

| 커밋 | 내용 |
|---|---|
| `24dd642` feat(agent): 옴니스가 docx · xlsx · pptx 를 만들고 다시 열어 검증한다 | `lib/agent/doc-files.ts` · 시험 14건 · 의존성 4개 |
| `eb52f52` feat(files): 옴니스 1:1 방에 붙은 파일은 방 주인만 목록 · 내려받기 | `lib/agent/room-files.ts` · `app/api/files/**` 셋 · MCP `read_file` |
| `f161ed5` feat(agent): 옴니스 결과물 — 초안 카드 · 파일 만들기 · 대화를 연혁 제안으로 | 도구 · 카드 · 방 화면 · 프롬프트 · 시험 9건 · 시나리오 스크립트 |
| (이 문서) docs(agent) | 결과 · 캡처 |

## 마이그레이션 — 없음

스키마를 고치지 않았다. 만든 파일의 소유자 · 방은 **File.messageId → 옴니스 글 → 방(OMNIS_DM) → 참여자(방 주인)** 연결로 남긴다.
기록 제안은 기존 `RecordProposal` 에 `trigger: "omnis_room"` 으로 들어간다(trigger 는 문자열 칸). 운영 반영에 migrate 가 따로 필요 없다.

## 고정한 패키지

`package.json` 에 `^` 없이. 모두 배포 2주가 넘은 버전.

| 패키지 | 버전 | 배포일 | 쓰는 곳 |
|---|---|---|---|
| `docx` | 9.11.0 | 2026-10-13 | 워드 만들기 |
| `pptxgenjs` | 4.0.1 | 2025-06-26 | 파워포인트 만들기 |
| `jszip` | 3.10.1 | 2022-08-02 | 다시 열어 zip(CRC) 확인 — docx · pptxgenjs 가 이미 물고 있는 버전 |
| `fast-xml-parser` | 5.11.1 | 2026-08-27 | 다시 열어 XML 파싱(`XMLValidator`) |
| `xlsx` | (이미 있음 ^0.18.5) | | 엑셀 만들기 · 다시 읽기 |

`pnpm-workspace.yaml` 은 고치지 않았다(설치 스크립트가 있는 패키지가 없다).

## 설계

### 도구 — 전부 쓰기(CAUTION), 3단계 확인 흐름 그대로

| 도구 | 카드 | 확인 단추 | 확인하면 |
|---|---|---|---|
| `write_weekly_report` (기존 MCP 도구) | 초안 카드 — 지금 본문(있으면) · 새 본문 미리보기 · [펼치기] · [복사] | 저장 | **기존 저장 경로**(`lib/weekly-report.ts` `upsertThisWeekReport` · `updateWeeklyReport`, MCP 와 같은 `runTool`). 에이전트에서는 `submit` · `draft`(Gemini 초안) 인자를 빼고 `markdown` 을 필수로 — 제출은 사람이 주간보고 화면에서 |
| `draft_document` kind=report | 초안 카드 | 저장 | 이 방에 **워드 파일** |
| `draft_document` kind=mail_reply | 초안 카드 + **[복사]**(제목 + 본문) · 받는 사람 · 제목 | 저장 | 이 방에 워드 파일(머리에 받는 사람 · 제목). **메일은 보내지 않는다** — 보내는 도구가 없다 |
| `create_file` docx · xlsx · pptx | 형식 · 구성(「시트 1개(재고 4행)」) · 내용 미리보기 | 만들기 | 만들기 → 검증 → NAS 저장 → 다시 읽어 검증 → 이 방에 파일 카드 |
| `propose_records` | 항목마다 날짜 · 종류 · 등급 · 대외비 · 제목 · 근거(어디 · 누가 · 언제), 올리지 않을 항목은 이유 | 제안 올리기 | 기존 연혁 제안 큐(`RecordProposal` PENDING) — 채택은 `/omnis/proposals?tab=records` 에서 사람이 |

- 카드 · 실행은 `lib/agent/outputs.ts`(`buildOutputPreview` · `executeOutput`), 입력 규칙(순수)은 `lib/agent/output-rules.ts`, 파일 엔진(순수)은 `lib/agent/doc-files.ts`.
  `tools.ts buildPreview` 가 결과물 도구를 `outputs.ts` 로 넘기고, `store.ts writeTool` 이 `checkExecution` · APPROVED → EXECUTED 조건부 갱신을 지난 뒤 `executeOutput` 을 부른다 — 3단계 쓰기와 같은 자리다
- 확인 카드 모양에 `preview.draft { body, copy? }` · `preview.confirmLabel` 두 칸을 더했다. 둘 다 `planHash` 에 들어간다(화면에 보인 초안 그대로에만 승인)
- **비밀 차단**: `secretBlockReason` 은 입력 전체(중첩 배열 · 객체)를 훑는다 — 표 칸 · 슬라이드 글머리 · 메일 본문 · 주간보고 본문에 비밀번호 · 키 · 주민번호가 있으면 카드가 BLOCKED. 시험 `outputs.test.ts`
- **중지**: 실행 단계가 STOPPED 를 먼저 본다(3단계 그대로). 확인 전 카드는 `saveStopped` 가 EXPIRED 로
- **한도**: 결과물도 실행당 턴 · 원 상한 안. 파일 한 개 크기 한도는 `doc-files.ts LIMITS`(본문 3만 자 · 시트 10 · 행 2,000 · 열 40 · 슬라이드 30) — 넘으면 카드가 막힌다
- **데모**(`NEXT_PUBLIC_IS_DEMO=true`): 파일 저장(`draft_document` · `create_file`) 카드는 「시연용 데모에서는 파일 저장을 쓸 수 없습니다」 로 BLOCKED(기존 `demoStorageBlocked` 와 같은 문구). 실행에서도 한 번 더 거른다. 데모 비용 상한(`OMNIS_AGENT_DAILY_KRW` 등)은 건드리지 않았다
- 실행 결과 글 앞에 「사용자가 확인해 실행을 마쳤습니다」 를 붙인다(결과물 · 주간보고만). 첫 주간보고 실측에서 결과 글이 초안 본문 그대로라 모델이 실행 뒤에도 「[저장] 을 눌러 주세요」 라고 썼다(아래 캡처 `weekly-first`). 고친 뒤 두 번(메일 · 주간보고) 모두 「저장했습니다」 로 답했다

### 보고서 · 메일 회신을 어디에 — 지식 카드가 아니라 이 방의 워드 파일

| 후보 | 판단 |
|---|---|
| 지식 카드(`OmnisCard`) | 구성원 모두가 읽고 `search_knowledge` 가 검색해 답에 쓴다. 개인이 쓰는 중인 보고서 · 외부 사람에게 보낼 메일 본문이 회사 지식으로 퍼진다. 분류 엄격 모드(2026-10-02 결정)에도 「보고서」 · 「메일」 분류가 없다 |
| 회사 기록(`CompanyRecord`) | 연혁 · 실적 표다. 맞지 않는다 |
| **방의 파일(docx)** | 보고서는 결국 워드로 내고, 방 주인만 본다. 사람이 고쳐 쓴 뒤 필요하면 직접 공유한다. 파일 엔진(`create_file`)과 같은 저장 · 검증 길 |

메일은 붙여 넣는 것이 주 용도라 카드에 [복사] 를 두었다(저장하지 않아도 복사된다).

### 파일 — 만들기 · 저장 · 다시 열어 검증 (folding doc_writers 의 자기검증 쓰기)

`saveFileToRoom`(`outputs.ts`) → `storeVerified`(`doc-files.ts`):

1. 내용(JSON)을 zod 로 거른다 — 형식이 틀리면 카드부터 막힌다
2. 만든다 — docx(`docx`, 마크다운의 제목 · 목록 · 번호 · 표 · **굵게**), xlsx(`xlsx`, 열 너비 자동 · 숫자는 숫자), pptx(`pptxgenjs`, 표지 + 본문 슬라이드 · 발표자 노트)
3. **저장 전 검증** `verifyOfficeFile`: zip 머리 · `JSZip.loadAsync(checkCRC32)` · `[Content_Types].xml` 과 형식별 필수 부품 · **모든 .xml/.rels 파싱** · xlsx 는 workbook 의 시트 목록 = 시트 부품 수 = `XLSX.read` 로 다시 읽은 이름 = 요청한 이름 · pptx 는 `sldId` 수 = 슬라이드 부품 수 = 요청(표지 포함) · docx/pptx 는 제목 글이 본문에 있는지
4. NAS 저장(운영 `SYNOLOGY_WEBDAV_BASE_PATH`, 로컬은 `.env` 의 `_dev` 하위) — 키는 `objectKeyFor(uuid, 이름)`, 기존 첨부와 같은 자리
5. **NAS 에서 다시 읽어** 바이트 길이 · sha256 이 같은지, 다시 읽은 바이트로 3 을 한 번 더
6. 4~5 중 하나라도 실패하면 **저장한 것을 지우고** 실패를 카드에 남긴다(FAILED). DB 기록(옴니스 글 + File 행, 한 트랜잭션)이 실패해도 NAS 의 것을 지운다
7. 성공하면 옴니스 글 「엑셀 표를 만들었습니다.」 에 파일이 붙어 방에 파일 카드(`MessageFiles`, 눌러 내려받기)로 보인다

임의 코드 실행(Sandbox)은 하지 않는다 — 모델은 내용만 준다.

### 대화 → 지식(연혁 제안)

- 입력: 모델이 이 옴니스 방의 대화(앞 글이 문맥에 있다) · 전사방/업무방(`list_chat` · `get_task` 로 읽은 것)에서 후보를 고르고, **근거 문장을 그대로** 옮긴다
- 서버가 근거를 찾는다(`findEvidence`): 근거 첫 줄 앞 40자를 ① 이 옴니스 방의 **사람 글** ② 전사방(`PUBLIC_MESSAGE_WHERE` = COMPANY, 업무방 글 포함)의 사람 글에서 `contains` 로. **사람끼리 방(DM · GROUP) · 남의 옴니스 방은 보지 않는다**(기존 방침). 옴니스가 쓴 글은 근거로 치지 않는다(카드 앞 요약이 자기 근거가 되지 않게). 못 찾으면 「근거 문장을 … 찾지 못함」 으로 올리지 않는다
- 겹침: 기존 `isSameEvent`(날짜 ±7/45일 · 제목 bigram)로 기존 연혁 · 올린 제안 · 같은 요청 안의 항목과 대조
- 대외비: 모델 표시 또는 근거 글에 비밀 표시(`isSecretSignal`)가 있으면 true — 기존 규칙과 같다
- 근거(`sourceRefs`)는 `kind: "message"` · 실제 글 id · 「옴니스 대화 · 정우창 2026-10-30」 · 인용 200자. **카드에 「구성원 모두가 보는 목록이고 근거 문장이 함께 보입니다」 를 적었다** — 옴니스 방은 방 주인만 보는 곳이라, 인용이 큐로 나가는 것을 사람이 알고 누르게 했다
- 자동 등록(`canAutoApply`)은 하지 않는다 — 큐에 올리는 것까지. 확신은 0.9(사람이 카드를 한 번 봤다)
- 지식 카드로 남길 것(절차 · 기준)은 기존 `write_omnis_card`(3단계)가 맡는다고 프롬프트에 적었다

### 파일 접근 — 이 브랜치의 최소한의 막음

`lib/agent/room-files.ts`. 옴니스 1:1 방 글에 붙은 파일만 판정하고, 나머지 파일은 지금 규칙 그대로 둔다.

| 곳 | 이번에 한 것 |
|---|---|
| `GET /api/files`(최근 50개 목록) | `NOT { message.room.kind = OMNIS_DM }` — **방 주인에게도** 내지 않는다(첨부 고르기에서 골라 전사방에 붙이면 방 밖으로 옮겨진다) |
| `GET /api/files/[id]` · `/raw` | 옴니스 방 파일이고 그 방 참여자가 아니면 404 |
| MCP `read_file` | 같은 판정, 「파일이 없습니다」 |
| 검색 · 색인 | 손대지 않음 — 사진 색인(PHOTO)은 이미지만, 만든 파일은 docx/xlsx/pptx 라 들어가지 않는다. 옴니스 방 글은 색인 대상이 아니다(COMPANY 만) |

## 합칠 때 할 일 (feat/omnis-attach 와)

1. **판정 한 곳으로**: feat/omnis-attach 의 파일 접근 판정이 OMNIS_DM 방 파일(=방 참여자만)을 다루면 `lib/agent/room-files.ts` 를 지우고 아래 네 자리를 그 판정으로 바꾼다.
   `app/api/files/route.ts`(GET 목록의 `where: NOT_OMNIS_ROOM_FILE`) · `app/api/files/[fileId]/route.ts` · `app/api/files/[fileId]/raw/route.ts`(각각 `omnisRoomFileBlocked` 한 줄) · `lib/omnis-mcp.ts read_file`(한 줄). 겹치는 줄은 이것뿐이다
2. **목록 규칙을 맞출 것**: 이 브랜치는 옴니스 방 파일을 `GET /api/files` 에서 **주인에게도** 뺀다. 저쪽이 「내 방 파일은 내 목록에」 로 정하면, 첨부 고르기에서 그 파일을 다른 방 글에 붙일 때 아래 3 을 먼저 막아야 한다
3. **첨부 옮기기 구멍(이 브랜치에서 안 막음)**: `lib/chat-post.ts` 의 `prisma.file.updateMany({ where: { id: { in: fileIds } }, data: { messageId } })` 가 **이미 다른 글에 붙은 파일도** 새 글로 옮긴다. 파일 id(uuid)를 아는 사람이 전사방 글에 그 id 를 넣으면 옴니스 방 파일이 전사방 첨부가 된다. MCP `post_message` 는 이미 「이미 다른 메시지에 붙은 파일」 을 거절한다 — 화면 경로도 `messageId: null` 조건이나 접근 판정을 넣어야 한다
4. **MCP 내려받기 링크**(`app/api/ip-mcp/[[...path]]/route.ts downloadViaLink`): 서명 링크는 `read_file` 이 판정을 지난 뒤에만 내주므로 지금은 막혀 있다. 저쪽 판정이 링크 시점에도 다시 보게 하면 더 단단하다
5. 옴니스 방 화면 데이터: 이 브랜치가 `lib/agent/service.ts` 의 `MESSAGE_SELECT` 에 `files` 를, `OmnisRoomMessage` 에 `files?` 를, `OmnisMessage` 에 `MessageFiles` 를 더했다. 저쪽이 「옴니스 방 첨부(사람이 올린 파일)」 를 같은 자리에 더하면 겹친다 — 한 칸(`files`)으로 합치면 된다(사람 글에도 같은 모양)
6. 스키마: 이 브랜치는 File 에 칸을 더하지 않았다. 저쪽이 `File.ownerId` · `roomId` 같은 칸을 더하면 `saveFileToRoom`(`outputs.ts`)의 File 생성에 그 값을 채운다(방 = `ctx.roomId`, 주인 = `ctx.userId`)

## 검증

### 품질 게이트

```
$ pnpm run verify
verify exit 0
✖ 40 problems (0 errors, 40 warnings)      ← origin/main 도 40(git stash -u 로 같은 명령 실측). 이번 변경 파일의 경고 0

$ pnpm run test:unit
ℹ tests 215
ℹ pass 215
ℹ fail 0
```

192 → 215(origin/main 192, 이번 23). `pnpm run build` · e2e 는 돌리지 않았다.

| 시험 | 무엇 |
|---|---|
| `lib/agent/doc-files.test.ts` (14) | 세 형식 만들고 다시 열기 통과 · zip 아님/잘림 거부 · 안의 XML 깨짐 거부 · 형식 다른 파일(필수 부품 없음) 거부 · 시트/슬라이드 수 · 제목 다르면 거부 · 저장 뒤 다시 읽어 같으면 남김 · **끝에 0 바이트가 붙으면 지우고 실패** · **잘리면 지우고 실패** · 만든 직후 검증 실패면 저장소를 건드리지 않음 · 업로드 실패에도 지우기 시도 · 파일 이름(경로 걷기) · 시트 이름 · 마크다운 · 크기 한도 |
| `lib/agent/outputs.test.ts` (9) | 메일 복사 글 · 메일 docx(실제로 만들어 검증) · 보고서 초안 · 빈 본문/모르는 종류 거부 · 연혁 항목 거부(근거 없음 · PATENT · EXCLUDE · 날짜 형식) · 근거 조각 · **옴니스 방 파일 — 주인만, 남은 거부** · 목록 조건 · **비밀(표 칸 · 슬라이드 · 메일 · 주간보고) 차단과 값 없는 말 통과** · **결과물도 카드 없이 · PENDING · EXECUTED · 다른 입력 · 다른 도구로는 실행 안 됨** |

### 실제 확인 — `next dev` 3119 · Playwright 390x844 · 로컬 DB(5433) · 정우창

dev: `env -u GEMINI_API_KEY NEXTAUTH_URL=http://localhost:3119 OMNIS_AGENT_APPROVAL_SECRET=<그 자리에서 openssl 로 만든 임시값> pnpm next dev --webpack -p 3119`, 로그는 파일로.
`pnpm exec prisma generate` 먼저. 로그인은 `scripts/agent-cookie.ts` 세션 쿠키. 모델 gpt-6.1-sol(기본).
`TOKEN=… OTHER=<윤훈 쿠키> BASE=http://localhost:3119 OUT=… node scripts/output-scenarios.mjs <weekly|mail|file|records>`. 모든 캡처 가로 넘침 0px. 끝나고 dev 를 껐다.

```
[file] 아래 표로 엑셀 파일을 만들어 줘. 파일 이름은 「재고 현황」, 시트 이름은 「재고」, 열은 품목 · 수량 · 비고.
  카드 116.1s · 상태 PENDING            ← dev 첫 컴파일 포함(워크플로 · 라우트). 뒤 시나리오는 14~24s
  실행 14.4s · 상태 EXECUTED
  결과: 만들었습니다: 재고 현황.xlsx (9KB · 시트 1개). 저장한 뒤 다시 열어 확인 — zip · XML 10개 …
  내려받기 200 · application/vnd.openxmlformats-officedocument.spreadsheetml.sheet · 8867B
  내 GET /api/files 목록에 있나: false
  다른 사람: raw 404 · 정보 404 · 목록에 있나 false · 방 주소 200     ← 방 주소는 200 에 본문 404 표식(3단계 「방 화면」 그대로), 글은 내려가지 않는다

[weekly] (첫 번째) 카드 24.5s · 실행 5.7s · EXECUTED — 그러나 실행 뒤 답이 「카드에서 [저장] 을 눌러 주세요」 → 결과 글 앞에 「실행을 마쳤습니다」 를 붙였다
[weekly] (고친 뒤) 카드 14.7s · 실행 4.1s · EXECUTED · 결과 「고쳤습니다: 2026-W44 주간보고 - 정우창 · 작성 중」 · 답 「… 저장했습니다. 현재 작성 중 상태이며, 제출하지는 않았습니다.」

[mail] 카드 23.9s · 복사한 글 "제목: RE: 애드젤 샘플 문의\n\n김연구 교수님, 안녕하세요.\n\n문의하신 애드젤 샘플 2개는 11월 12일에…"
  실행 4.3s · EXECUTED · 메일 회신 초안 - 애드젤 샘플 문의 회신.docx (10KB) · XML 17개
  내려받기 200 · …wordprocessingml.document · 10006B · 다른 사람 raw 404 · 정보 404 · 목록 false · 답 「메일은 보내지 않았습니다」

[records] 어제(2026-10-29) 경기도경제과학진흥원 「2026 바이오 기술사업화 지원사업」 최종 선정 공문을 받았어. 이 대화에서 남길 것을 정리해서 기록 제안으로 올려 줘
  카드 19.1s · 실행 6.9s · EXECUTED · 「연혁 제안 1건을 올렸습니다」
```

내려받은 파일을 다시 열었다:

```
$ tsx check-download.mts "재고 현황.xlsx" xlsx          # verifyOfficeFile + XLSX.read
다시 검증 {"bytes":8867,"entries":10,"xmlParts":10,"sheets":["재고"]}
재고 [["품목","수량","비고"],["애드젤",12,"샘플용"],["라이브젤",3,"재주문 필요"],["뉴로힐",5,""]]   ← 수량은 숫자
$ python3 zipfile.testzip → None (두 파일 모두) · file → Microsoft Excel 2007+
$ textutil -convert txt "메일 회신 초안 - 애드젤 샘플 문의 회신.docx"
애드젤 샘플 문의 회신 / 받는 사람: 김연구 교수(○○대) / 제목: RE: 애드젤 샘플 문의 / 김연구 교수님, 안녕하세요. / … / 정우창 드림
```

DB(로컬):

```
run 2cafdc2b DONE 턴 2 22.93원 카드 create_file:EXECUTED
   옴니스: 엑셀 표를 만들었습니다. [파일 재고 현황.xlsx 8867B]
run 30b49ac2 DONE 턴 4 32.65원 카드 write_weekly_report:EXECUTED     ← 첫 주간보고
run 872ca715 DONE 턴 2 6.14원  카드 propose_records:EXECUTED
run b69c0a97 DONE 턴 2 5.50원  카드 draft_document:EXECUTED
   옴니스: 메일 회신 초안을 저장했습니다. 메일은 보내지 않았습니다. [파일 메일 회신 초안 - 애드젤 샘플 문의 회신.docx 10006B]
run 7cf518d2 DONE 턴 3 17.66원 카드 write_weekly_report:EXECUTED     ← 고친 뒤 주간보고
주간보고 정우창 2026-W44 작성 중 # 주간보고 — 정우창 ⏎ 기간: 2026.10.26~11.01 (2026-W44) …
연혁 제안 {"status":"PENDING","kind":"GRANT","grade":"MAJOR","confidential":false,"title":"경기도경제과학진흥원 「2026 바이오 기술사업화 지원사업」 최종 선정",
          "occurredOn":"2026-10-29","trigger":"omnis_room","sourceRefs":[{"id":"918febf6-…","kind":"message","label":"옴니스 대화 · 정우창 2026-10-30","quote":"어제(2026-10-29) …"}]}
```

`/omnis/proposals?tab=records` 에 그 제안이 「기업현황카드 후보 · 확신 90% · 옴니스 대화 · 정우창 2026-10-30 (인용) · 채택 | 고쳐서 채택 | 제외」 로 보인다(`records-4-queue.png`).

**쓴 비용**: 질문 5번(파일 · 주간보고 2 · 메일 · 연혁), 모델 13회 · **84.88원**(`AiUsage`, gpt-6.1-sol). 같은 시간대 `AiUsage` 에 05:30~05:32 「이 파일 내용 요약해 줘」 3건(24.19원)이 더 있는데 이 작업이 아니다(다른 세션의 첨부 시험으로 보인다).

### 캡처 — `mydocs/working/omnis-outputs/` (원본 · 내려받은 파일: 스크래치패드 `…/scratchpad/omnis-outputs/`)

| 파일 | 무엇 |
|---|---|
| `weekly-1-card.png` · `weekly-2-expanded.png` · `weekly-3-done.png` | 주간보고 초안 카드(지금 본문 → 바뀜 · 새 본문 · [펼치기] [복사] · [저장]) · 펼침 · 저장 뒤 결과와 답 |
| `file-1-card.png` · `file-3-done.png` · `file-4-file-card.png` | 엑셀 만들기 카드(형식 · 구성 · 미리보기 · [만들기]) · 실행 결과 · 방의 파일 카드 |
| `mail-1-card.png` · `mail-3-done.png` · `mail-4-file-card.png` | 메일 회신 초안(받는 사람 · 제목 · 본문 · [복사] · 「메일은 보내지 않습니다」) · 저장 뒤 · 파일 카드 |
| `records-1-card.png` · `records-3-done.png` · `records-4-queue.png` | 연혁 제안 카드(근거: 이 대화 · 정우창) · 올린 뒤 · 연혁 제안 큐 |

스크래치패드 `weekly-first/` 에는 고치기 전 첫 주간보고(실행 뒤 답이 「[저장] 을 눌러 주세요」)가 있다.

## 남은 문제

1. **데모 막음은 화면에서 보지 않았다** — `IS_DEMO` 는 빌드 때 박히는 값이라 dev 를 데모로 다시 띄워야 한다. 코드는 카드(problem → BLOCKED)와 실행 두 자리
2. 주간보고 카드의 실행 결과 글이 길다 — MCP `write_weekly_report` 가 본문을 함께 돌려줘 카드 아래에 본문이 한 번 더 보인다(첫 번째 실측, `report` 없이 이번 주를 새로 만들 때). 고칠 때는 MCP 출력이 아니라 카드에서 결과를 줄인다
3. 첫 주간보고에서 모델이 완료 업무를 「이번 주 완료 여부를 확인할 수 없어 보류」 로 썼다 — 로컬 스냅샷 업무 이름이 「가나다라…」 처럼 시험용 글이라서로 보인다. 운영 자료로는 보지 않았다
4. 근거 찾기는 첫 줄 앞 40자 `contains` 다. 모델이 문장을 조금이라도 바꾸면 못 찾고 올리지 않는다(놓치는 쪽으로 안전). 전사방 검색은 색인 없는 `LIKE` 라 글이 많아지면 느려질 수 있다(운영 규모에서 재지 않았다)
5. 만든 파일은 방을 지워도(목록에서 숨김) NAS 에 남는다 — 3단계 「대화 삭제는 숨김」 방침과 같다
6. 로컬에 남긴 것: 정우창 W44 주간보고 본문(시나리오가 바꿈) · PENDING 연혁 제안 1건(「경기도경제과학진흥원 … 최종 선정」, 사실이 아닌 시험 문장) · 옴니스 방 5개 · NAS `_dev` 파일 2개. 로컬 자료라 지우지 않았다 — 연혁 제안은 큐에서 [제외] 하면 된다
7. 파일 카드는 새 탭으로 연다(`MessageFiles` 그대로, `Content-Disposition: inline`). docx · xlsx · pptx 는 브라우저가 내려받는다

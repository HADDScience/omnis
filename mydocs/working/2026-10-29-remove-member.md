---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-29-remove-member.md
last_verified: 2026-10-29
---

# 떠난 구성원 없애기 — 백업 후 삭제 (2026-10-29)

회사와 관계가 끝난 구성원 1명이 「계정만 막는 게 아니라 아예 없었으면 좋겠다」고 했다.
작업지시자가 정한 것은 셋이다.

| 결정 | 내용 |
|---|---|
| 백업 후 삭제 | 나중에 되살릴 수 있게 백업을 남기고 지운다 |
| 글 속 이름은 가린다 | 남이 쓴 업무·채팅 속 이름을 `(전 구성원)` 으로. 글 자체는 남긴다 |
| CRM 연락처는 둔다 | 다른 회사 대표로서 들어간 거래 기록이라 퇴사와 별개다 |

도구는 `scripts/remove-member.ts`. 무엇을 지우고·가리고·멈추는지는 파일 머리 주석에 있다.

## 운영에서 찾은 것 (적용 전 조사)

외래키는 DB 정의(`pg_constraint`)에서 직접 따라갔고, 외래키 밖의 언급은 모든 스키마의 모든 표를
이름 · 계정 ID · 이메일 문자열로 훑었다.

| 갈래 | 표 | 건수 |
|---|---|---|
| 지움 | `User` · `StaffProfile` · `TaskAssignee` · `Notification` · `ip.members`(지식재산권 owner 권한) | 각 1 |
| 가림 | `Task.background` 2 · `Task.sourceMessages` 5 · `Checklist.name` 2 · `ChatMessage.content` 6 | 15칸 |
| 색인 재생성 | `TASK` 5 · `CHAT_MESSAGE` 6 | 11건 |
| 둠 | `CrmContact` 1 (견적 2건 연결) · `ExternalCalendarEvent` 1 (외부 캘린더 동기화분) | |

`ip.members` 는 첫 조사(public 스키마만)에서 빠졌고, 스크립트의 「모르는 참조면 멈춘다」 가 잡았다.

## 시험 — 운영 원문 사본 DB 에서 적용 → 복원

마스킹 스냅샷은 본문이 더미라 가리기를 시험할 수 없어, 운영을 원문 그대로 `omnis_remove` 에 떠서 돌렸다.
시험이 끝난 뒤 그 DB 와 시험 백업은 지웠다.

```
### 적용
가리기 · 지우기 끝
  색인 TASK: 다시 만듦 2 · 그대로 3 · 지움 0
  색인 CHAT_MESSAGE: 다시 만듦 6 · 그대로 0 · 지움 0
### 색인 확인            (이름이 든 청크 / 가린 이름이 든 청크)
0
8
### 복원 뒤 지문 — User · StaffProfile · TaskAssignee · Notification · Task · Checklist · ChatMessage 원래와 같음
3c3
< EmbeddingChunk(content)|fdb41388…
> EmbeddingChunk(content)|0edef9c9…
```

색인만 다른 이유는 체크리스트 순서다. 한 업무의 체크리스트 3개가 **같은 밀리초**에 만들어져
`orderBy: { createdAt: "asc" }` 로는 순서가 정해지지 않는다. 행을 고치면 물리 순서가 바뀌어 다르게 읽힌다.
화면(`app/api/tasks`)도 같은 정렬이라, 가린 업무 두 장은 체크리스트 순서가 바뀌어 보일 수 있다.
체크 표시 하나만 바꿔도 생기는 기존 성질이라 이번에 고치지 않았다.

## 운영 적용

```
대상: ep-cool-heart-…neon.tech
가리기 · 지우기 끝
  색인 TASK: 다시 만듦 2 · 그대로 3 · 지움 0
  색인 CHAT_MESSAGE: 다시 만듦 6 · 그대로 0 · 지움 0
남은 언급:
  public."CrmContact" ∋ 이름 1건
  public."ExternalCalendarEvent" ∋ 이름 1건
  public."ExternalCalendarEvent" ∋ 이메일 1건
```

남은 셋은 둔다고 정한 것이다. MCP `list_members(includeInactive)` 와 `get_context` 에서도 나오지 않는다.
복원 미리보기(`--restore <백업>`)는 운영에서 5행 · 15칸을 되살릴 수 있다고 답했다.

**백업** — 노트북 `~/work/omnis-import/member-removal/`(권한 600)과 NAS `08. 개인정보/옴니스 구성원 삭제 백업/`.
두 사본 MD5 일치(`6037b11e…`). 비밀번호 해시와 개인정보가 들어 있어 저장소에는 넣지 않는다.

로컬 스냅샷 DB(`omnis`)에서도 같은 스크립트로 지웠다.

## 저장소

다시 만들어 낼 수 있는 원본에서 뺐다 — `prisma/seed.ts`(upsert 라 시드를 돌리면 계정이 되살아난다),
`scripts/set-team-positions.ts`, `data/omnis-structured/employees.json`(휴대폰 번호), `docs/SYNOLOGY_…`(임시 비밀번호).

남긴 것: `data/omnis-structured/crm-contacts.json` · `quotes.json`(CRM 결정과 같은 이유), 지난 계획서·보고서의 언급, git 이력.

```
pnpm run verify   → typecheck 통과 · lint 0 errors (기존 경고 43)
```

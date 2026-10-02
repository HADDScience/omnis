---
kind: decision
status: draft
canonical: mydocs/plans/2026-09-30-record-proposals-and-card-categories.md
last_verified: 2026-09-30
---

# 연혁 제안 · 지식카드 분류

상태: **초안 — 작업지시자 승인 전.** 요청은 hadd-history-37 세션(연혁 업무)이 사용자 지시라며 넘겼다.
스키마 변경 · 운영 마이그레이션 · 배포가 들어가 AGENTS.md 타스크 사이클 2단계(승인)를 거친다.

## 요청과 지금 코드의 차이 (2026-09-30 실측)

| 요청 | 지금 |
|---|---|
| 「채팅→지식카드 기록 제안」에 연혁을 붙인다 | 제안은 **업무가 DONE 이 될 때만** 생긴다 (`lib/task-update.ts:107`, `lib/notifications.ts:89` → `proposeFromTask`). 업무 밖 채팅은 입력이 아니다 |
| 지식카드에 카테고리를 도입 | **이미 있다.** `OmnisCategory` 표, `OmnisCard.categoryId` 필수, 화면 `/omnis/c/[categorySlug]` |
| `write_omnis_card` 에 category 인자 | **이미 있다** (`lib/omnis-mcp.ts:376`, 새 카드는 필수) |
| 기존 카드를 AI 로 분류 마이그레이션 | 운영 카드 **0장** (`list_omnis_cards` → 「지식 카드가 없습니다」). 로컬 스냅샷도 분류 3개(기업정보·인력현황·지식재산권)에 카드 0 · 제안 0 |
| AI 제안이 카테고리도 제안 | **없다.** 새 카드 제안은 `defaultCategoryId()` 가 늘 「기업정보」를 넣는다 (`lib/card-proposals.ts`) |
| 연혁 kind | `RecordKind` 8종 그대로 쓴다. 운영 연혁 160건(연혁 114 · 지원사업 24 · 학회 14 · 수상 9 · 노션 9, 로컬 스냅샷 기준) |

그래서 ② 의 실제 일은 「분류 도입」이 아니라 **AI 제안이 분류를 고르게 하고, 분류 목록을 늘리는 것**이다.
분포를 볼 카드가 없어 분류 목록은 데이터가 아니라 사람이 정한다.

## 단계

### 1. 스키마 (마이그레이션 1개)

- `RecordProposal` 새 표 — `CardProposal` 과 칸이 달라 따로 둔다
  - `status` (`CardProposalStatus` 재사용: PENDING · ACCEPTED · REJECTED · AUTO_APPLIED · SUPERSEDED)
  - `kind RecordKind` · `grade`(MAJOR 주요 · GENERAL 일반) · `confidential Boolean`
  - `occurredOn` · `periodRaw` · `title` · `organizer` · `note`
  - `sourceRefs Json` (채팅·업무 원문 링크 + 인용) · `confidence Float` · `reason`
  - 사람이 고친 값과 AI 원안을 둘 다 남긴다 (`original Json`) — 「제안=확정」 비율의 근거
  - `recordId` (채택되어 생긴 CompanyRecord), `decidedById` · `decidedAt` · `revertedAt`
- `CompanyRecord.visibility` (INTERNAL · PUBLIC, 기본 PUBLIC) — 대외비를 제목 접두어 대신 칸으로.
  인비트로큐 MOU(34a7f46b-…)는 백필에서 INTERNAL 로. 제목의 `[내부용·대외비]` 는 호환을 위해 당분간 같이 둔다
- 규칙 23: Zod 스키마 · 백필 스크립트를 같은 커밋에

### 2. 제안 생성 (`lib/record-proposals.ts`)

- 입력: 업무 DONE 훅(지식카드와 같은 자리) + 업무 밖 채팅 하루치(Vercel cron, 기존 `vercel.json` crons 에 한 줄)
- Gemini 한 번으로 후보 추출 → 등급 규칙(주요 · 일반 · 제외)과 대외비 신호(비밀·대외비·아직 공개 X)를 프롬프트에 박는다.
  「제외」는 저장하지 않는다
- 중복: 기존 CompanyRecord · 대기 중인 제안과 날짜 ±7일 + 제목 키워드 겹침이면 버린다
- 입력은 **채팅·업무만** (2026-10-02 작업지시자 답 — NAS 행사 폴더는 제외)

### 3. 판단 화면 · 자동 전환

- `/omnis/proposals` 에 「연혁」 탭 — 채택 · 수정 후 채택 · 제외. 수정 칸: 날짜 · 제목 · 종류 · 등급 · 대외비
- 채택 시 `CompanyRecord` 생성(`source: "옴니스"`), 대외비면 `visibility: INTERNAL` + 비고 「외부 자료 사용 금지」
- 정확도는 `kind × grade` 별로 센다. 누적 20건 이상 · 최근 3건 연속 원안 채택 · 정확도 ≥ 90% 면 그 유형만 자동 등록
  (비고 「자동 등록」, 사후 검토 목록에 남음). **MAJOR 와 대외비는 자동 등록 대상에서 뺀다** — 코드로 막고, 거부 사례를 검증 스크립트에 넣는다
- MCP: `list_record_proposals` · `decide_record_proposal` (쓰기는 `read_guide` 확인 코드 규약을 따른다)

### 4. 지식카드 분류

> **보류 — 카드 효과 실측 뒤 정한다** (2026-09-30 작업지시자 「카드가 도움이 되는지 먼저 실측해줘」).
> 카드 없는 기준선은 나왔다: 결정이 바뀐 질문에서 심판 평균 1.1 / 2 (일반 질문 1.75). 카드 생성·재측정은 Gemini 월 한도로 멈춤.

**운영 방식 — 엄격 모드** (2026-10-02 작업지시자 결정, hadd-history 세션 경유):
「카테고리로 할거면 아예 엄격하게 이 카테고리 안에서만 정보를 추출하는거고 … 유동적으로 관리하는 방식은
회사 데이터 운영에 대한 경험과 데이터가 쌓였을때 하는걸로 하자」

- 정해진 분류 안에서만 추출·제안·저장한다. 어느 분류에도 맞지 않으면 제안 단계에서 버린다
- 그래서 「기타」 같은 열린 분류는 두지 않는다
- 유동 모드(분류 없는 자유 추출)는 나중 단계. 지금은 추출 프롬프트가 분류 목록을 입력으로 받게만 해 두어 확장 여지를 남긴다
- 실측도 엄격 모드로 만든 카드로 한다 — 실제로 낼 방식을 재야 한다
- 분류 목록 후보(미확정): 기업정보 · 인력현황 · 지식재산권 · 회사 연혁·실적 · 제품·기술 · 업무 절차

- 분류 목록 확정(아래 질문) → 시드 마이그레이션으로 추가
- `draftCardUpdate` 가 분류 이름 중 하나를 고르게 하고, `CardProposal.categoryId` 에 넣는다. 판단 화면에서 바꿀 수 있게
- 「회사 연혁·실적」 분류는 카드 목록 머리에 `/omnis/records` 링크를 단다 (연혁은 카드가 아니라 CompanyRecord 가 정본)
- `/omnis` 목록: 분류별 묶음 + 개수 — 지금 화면이 이미 분류 타일을 그리는지 확인해 빠진 것만 붙인다

### 5. 검증 · 배포

- `pnpm run verify` · `pnpm run build` · `scripts/verify-record-proposals.ts`
  (등급·대외비·중복·자동전환 — 통과 사례와 **거부되어야 하는 사례** 둘 다)
- 레이아웃 바꾼 화면은 `narrow-audit.mjs`
- 운영: `db:deploy` 먼저 → 승인 받고 PR 머지. 보고서 `mydocs/working/2026-09-30-record-proposals.md`

## 범위 밖

- 1회차 후보 17건의 등록 — 연혁 세션이 사용자 확정을 받아 `save_company_record` 로 한다. 이 기능이 나오면 그때부터 제안으로 들어온다
- 지원사업 「신청」 단계 관리

## 작업지시자에게 물을 것

1. 지식카드 분류 목록
2. 업무 밖 채팅까지 입력으로 넣을지 (하루 1회 cron, Gemini 비용 발생) — 아니면 업무 DONE 만
3. NAS 폴더 스캔 스크립트를 이번 범위에 넣을지

---
kind: decision
status: active
canonical: mydocs/plans/2026-10-21-column-image-suggest.md
last_verified: 2026-10-21
---

# 2026-10-21 — 칼럼 초안에 이미지 제안 붙이기

> 상위 계획: [`2026-10-16-column-keyword-pipeline.md`](2026-10-16-column-keyword-pipeline.md) (결정 5 「AI 인포그래픽 버튼은 뺀다」는 그대로다 — 이번에도 이미지를 만들지 않는다).
> 실측: [`mydocs/working/2026-10-21-column-image-suggest.md`](../working/2026-10-21-column-image-suggest.md)
> 범위·완료 기준은 정우창의 작업 지시(2026-10-21)를 따른다. 사이트 몫은 사이트 저장소 같은 브랜치(`feat/column-image-suggest`).

## 무엇을

AI 초안을 만들 때 Gemini 가 **글 맨 앞(썸네일용) 하나 + 소제목마다 하나** 이미지 제안을 함께 낸다.
제안 = 추천(한두 문장) · 어디서 구할지(1~3개) · AI 생성 프롬프트(영문, 하드:라이브러리 인포그래픽 스타일).
사람이 사진을 구하거나 프롬프트를 복사해 ChatGPT·Gemini 에서 직접 그린다. **검토용이고 게시되지 않는다.**

## 저장 방식 — `ColumnDraft.imageSuggestions Json?`

기존 검토용 표시는 「게시 전에 이 상자를 지우세요」 quote **블록**이다. 이 방식을 따르지 않은 이유:

| 블록에 넣으면 | 결과 |
|---|---|
| quote 블록으로 | 남아 있으면 검토 요청이 막힌다(`reviewProblems`). 제안은 대표님 검토 때도 보여야 한다 |
| 새 블록 종류로 | 사이트 `PostBlock` · Omnis `PostBlockSchema`(= WebsitePost 스키마)가 바뀐다. 상위 계획 결정 4 와 이번 지시가 금지 |

그래서 초안 행에 별도 칸을 둔다. `null` = 제안 없이 만든 옛 초안(백필 없음). 소제목과의 연결은 블록 순번이 아니라
`heading`(만들 때의 글자) + `n`(몇 번째 소제목)이다 — 편집기가 글자 → 순번 순으로 찾는다.

- 게시: `publishInput(d)` 가 제목·부제·블록만 읽는다 → 제안은 WebsitePost 에 닿지 않는다.
- 검토 요청 전 검사: 블록만 본다 → 제안이 사진으로 세지지도, 검토를 막지도 않는다.
- PUT: `imageSuggestions` 는 선택. 안 보내면(옛 편집기) 저장값을 그대로 둔다.
- 「완료」(`done`)·지우기는 편집기에서 하고 저장 때 함께 간다.

## 마이그레이션

`20261021000000_column_image_suggestions` — `ALTER TABLE "ColumnDraft" ADD COLUMN "imageSuggestions" JSONB;` 한 줄. 널 허용, 기본값 없음.
운영 적용은 하지 않았다(실행 직전 정우창 확인).

## 출력 토큰

`callGemini` 의 `maxOutputTokens 8192` · `column*` 의 `thinkingBudget 1024` 를 그대로 둔다. 근거는 `lib/column/draft.ts` 주석과 working 문서.

## 단계

1. Omnis: 칸 + 마이그레이션 + 프롬프트·파싱(`lib/column/image-suggest.ts`) + PUT + `scripts/verify-column-image-suggest.ts`
2. 사이트: 편집기 소제목 아래 접는 상자 · 복사 · 완료/지우기 · 워드 회색 상자 · `docs/콘텐츠-관리.md` 2-6
3. 검증: 가짜 응답으로 Omnis 시험, Omnis API 목킹 Playwright 로 사이트 시험, 실제 Gemini 1회(로컬 DB)

## 배포 순서

1. 운영 Neon 에 마이그레이션 적용(`pnpm run db:deploy`) — 칸이 없는 DB 에 새 코드가 가면 초안 생성·조회가 오류난다
2. Omnis PR 머지(운영 배포)
3. 사이트 PR 머지 — 사이트를 먼저 내도 깨지지 않는다(제안이 안 올 뿐). Omnis 를 먼저 내도 옛 사이트는 `imageSuggestions` 를 보내지 않아 저장값이 유지된다

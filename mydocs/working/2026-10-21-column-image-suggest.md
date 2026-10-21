---
kind: snapshot
status: active
canonical: mydocs/plans/2026-10-21-column-image-suggest.md
last_verified: 2026-10-21
---

# 칼럼 이미지 제안 — 실측

계획: [`plans/2026-10-21-column-image-suggest.md`](../plans/2026-10-21-column-image-suggest.md).
작업 트리 `~/work/omnis-colimg` · `~/work/hadd-website-colimg`, 브랜치 둘 다 `feat/column-image-suggest`. 실행은 전부 **로컬 DB**(localhost:5433).

## 마이그레이션(로컬만)

```
$ prisma migrate deploy        # 로컬
All migrations have been successfully applied.
$ prisma migrate diff --from-url <로컬> --to-schema-datamodel prisma/schema.prisma --script
-- This is an empty migration.
```

## 실제 Gemini 호출 — 확인 안 함

로컬 `.env` 의 키로 1회 시도했고 실패했다. 재시도하지 않았다.

```
Error: Gemini API 오류 (columnDraft): 402 … "Your prepayment credits are depleted." RESOURCE_EXHAUSTED
```

402 는 `escalateGeminiFailure` 의 경보 대상(404·401·403)이 아니어서 메일·이슈는 생기지 않는다. 실패는 초안 저장 전이라 키워드 상태도 그대로다.
실제 모델이 제안 칸을 지시대로 채우는지, 출력 토큰이 아래 추정 안에 드는지는 **운영 키로 첫 초안을 만들 때 확인해야 한다.**

## 출력 토큰 — 한도는 그대로

로컬 `GeminiUsage` 의 지난 초안 3건(2026-10-16, 제안 없던 프롬프트):

| prompt | candidate | total | 생각(total − prompt − candidate) |
|---|---|---|---|
| 1,888 | 885 | 2,773 | 0 |
| 1,888 | 788 | 2,676 | 0 |
| 1,323 | 730 | 2,053 | 0 |

같은 날 `thinkingBudget` 을 주기 전 키워드 수집은 생각이 7,862 토큰(21,466 − 13,278 − 326)이라 8192 한도에 걸려 잘렸다. 예산 1024 를 준 뒤에는 0 이다.
제안은 맨 앞 1 + 소제목 3~4 개, 건당 한국어 두 칸 + 영문 한 단락 → 약 1,500 토큰 더. 본문이 상한(2,500자)이고 생각을 예산만큼 다 써도 약 4,500 토큰이라 8192 안이다.
잘리면 `bad_model_output`(응답 길이 포함)으로 떨어진다 — `COLUMN_DEBUG_FILE` 로 원문을 뜰 수 있다.

## Omnis — `scripts/verify-column-image-suggest.ts` (가짜 Gemini 응답)

```
$ npx tsx --env-file=.env scripts/verify-column-image-suggest.ts
— 파싱
✓ 맨 앞 1 + 소제목 3 → ["lead:lead::","h0:heading:첫 소제목:0","h1:heading:둘째 소제목:1","h2:heading:셋째 소제목:2"]
✓ 세 칸이 다 들어간다
✓ 제안 없는 옛 응답 → []
✓ leadImage 만 빠짐 → ["h0","h1","h2"]
✓ 망가진 제안은 버리고 나머지는 살린다
✓ 출처는 3개까지 → ["1","2","3"]
✓ 긴 소제목(1,500자)의 제안도 살린다 → 1
✓ 소제목 없는 섹션은 번호를 먹지 않는다 → 0
— 저장 형식(PUT)
✓ 빈 배열 · ✓ 완료 표시
✓ 거절: target 이 이상함 · ✓ 거절: id 없음 · ✓ 거절: 출처가 문자열 · ✓ 거절: 프롬프트가 너무 김
— 초안 생성(가짜 Gemini)
✓ 프롬프트에 제안 지시가 들어간다 → true
✓ 초안에 제안 4개 저장 → ["lead","h0","h1","h2"]
✓ 본문 블록에는 제안이 없다 → false
✓ 본문 블록 종류(안내 상자 · 소제목/본문 3쌍 · 참고 기사) → "quote,heading,text,heading,text,heading,text,links"
— 검토 요청 전 검사
✓ 제안이 있어도 사진 없음 경고는 그대로 → true
✓ 사진·출처 넣고 안내 상자 지우면 막힘 없음(제안은 남아 있음) → []
— 고치기
✓ 제안을 안 보내면(옛 편집기) 그대로 둔다 → 4
✓ 완료 표시가 저장된다 → [false,true,false,false]
✓ 지운 제안은 사라진다 → ["h1","h2"]
— 게시용 블록
✓ WebsitePost 저장 요청에 제안이 없다 → false
✓ 저장 요청의 칸 → ["category","content","date","externalHref","sourceLang","thumbnail"]
✓ 본문 근거 번호는 지워진다 → "문단"
— 옛 초안(제안 없음)
✓ imageSuggestions 는 null → null
✓ 옛 편집기 형식으로 저장된다 · 여전히 null → ["옛 초안 고침",null]
✓ 새 편집기가 빈 배열을 보내도 저장된다 → []
✓ 옛 초안 게시 요청도 만들어진다 → "옛 초안 고침"
✓ 모델이 제안을 안 줘도 초안은 만들어진다 → ["옛 제목",[]]

전부 통과
```

(출력 일부는 한 줄로 묶었다. 원문은 스크립트를 다시 돌리면 나온다.)
`publishDraft` 자체(savePost · 번역)는 돌리지 않았다. 그 앞에서 WebsitePost 로 가는 입력을 만드는 `publishInput` 을 떼어 시험했다.

## 사이트 — Omnis API 목킹 Playwright

`next build` 결과를 `next start -p 3125` 로 띄우고, `https://omnis.haddscience.com/**` 요청을 가로채 초안 3개(새 초안 · 옛 초안 `imageSuggestions: null` · 검토 중)를 돌려줬다.
스크립트는 저장소 밖(`/tmp/colimg-e2e/e2e.cjs`)이라 커밋하지 않았다.

```
✓ 제안 상자 4개(맨 앞 1 + 소제목 3) → 4
✓ 「첫째 소제목」 카드 바로 아래에 H0 제안   (둘째·셋째도 같음)
✓ 맨 앞 상자는 썸네일용 · ✓ 처음에 열려 있다 · ✓ 누르면 접힌다
✓ 복사 버튼 → 클립보드에 영문 프롬프트 · ✓ 버튼이 「복사됨」으로
✓ 클립보드 실패 → 프롬프트가 선택돼 있다 · ✓ 실패 안내가 뜬다
✓ 미리보기에는 제안이 없다
✓ 워드: 제안 상자 4개 · ✓ 영문 프롬프트 그대로 · ✓ 회색 음영(EFEFEF)
✓ 워드: 부제 → 썸네일 제안 → 소제목 → 그 제안 순서
✓ 완료하면 접힌다 · ✓ 지우면 상자 3개 · ✓ 소제목을 고쳐도 제안이 따라간다
✓ 저장: 제안 3개 · h0 완료 · h2 없음 · ✓ 블록에는 제안이 없다 · ✓ 블록은 PostBlock 종류만
✓ 옛 초안이 열린다 · 제안 상자 없음 · ✓ 옛 초안 저장: imageSuggestions 를 보내지 않는다 → ["title","summary","blocks"]
✓ 검토 중에도 제안이 보인다 · ✓ 완료·지우기 버튼이 없다 · ✓ 「둘째 소제목」 바로 다음이 제안 상자
전부 통과
```

첫 실행에서 「실패 안내가 뜬다」가 ✗ 였다 — 토스트가 그려지기 전에 확인해서다. 기다리도록 고친 뒤 통과.
사이트 ↔ 로컬 Omnis 를 실제로 잇는 확인(SSO 세션 포함)은 하지 않았다.

## 코드 리뷰 반영 (리뷰 에이전트, 코드 읽기만)

| 지적 | 처리 |
|---|---|
| 제안의 `heading` 한도 500자 < 소제목 블록 한도 2,000자 → 긴 소제목의 제안이 조용히 빠진다 | 2,000자로 맞춤. 시험 「긴 소제목(1,500자)의 제안도 살린다」 추가 |
| 워드 상자를 문단마다 테두리로 그려 줄 사이가 끊길 수 있다 | 칸 하나짜리 표로 바꿈. LibreOffice 로 PDF 렌더해 한 상자로 보이는 것 확인 |
| 워드가 완료 제안을 먼저 빼고 자리를 정해 편집기와 자리가 어긋날 수 있다 | 전체 목록으로 자리를 정한 뒤 완료를 뺀다 |
| 검토 화면(읽기 전용)이 소제목마다 PostBody 를 나눠 그려, 대체 텍스트 없는 사진의 「n/총장수」가 조각 안에서 센다 | 고치지 않음 — 관리 화면만 해당. 남은 것에 적음 |

고친 뒤 Omnis 시험 · 사이트 E2E 27건 · 두 게이트를 다시 돌려 모두 통과.

## 품질 게이트

```
Omnis  $ pnpm run verify   → ✖ 43 problems (0 errors, 43 warnings)   # 경고는 전부 기존 파일. 바꾼 파일만 eslint → 출력 없음
Omnis  $ pnpm run build    → ✓ Compiled successfully · exit 0
사이트 $ pnpm typecheck && pnpm lint && pnpm build → exit 0
```

## 남은 것

- 운영 Neon 마이그레이션 적용(확인 뒤) → Omnis 머지 → 사이트 머지
- 운영 키로 첫 초안을 만들어 제안 품질·토큰(`GeminiUsage` columnDraft 행) 확인
- 검토 화면의 사진 순번 표시(위 리뷰 4번째)
- `narrow-audit`(320~200px)은 돌리지 않았다 — 이 화면은 사이트 관리 화면이라 Omnis 스크립트의 대상이 아니다

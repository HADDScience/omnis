---
kind: decision
status: active
canonical: mydocs/tech/auth-architecture.md
last_verified: 2026-09-07
---

# 2026-09-07 — 카드뉴스 덱 번역 API · 옛 카드뉴스 10건 재작성

## 배경 · 결정

홈페이지 관리 화면의 원칙: **한국어(또는 영어) 하나만 쓰면 나머지는 자동 번역**(작업지시자, 2026-09-07).
글 기사는 이미 저장 시 서버가 번역한다. 카드뉴스는 카드가 그림이라 서버가 영문 카드를 만들 수 없다 —
굽는 단계가 브라우저에만 있다. 그래서 **텍스트 번역은 서버, 굽기는 브라우저**로 나눈다:

1. 편집기가 한국어 덱을 굽고 → `POST /api/website/translate` 로 덱과 제목·요약을 보내
2. 서버가 Gemini 로 영문 덱 + 영문 로케일(title · summary · `translatedFrom`)을 돌려주면
3. 편집기가 영문 덱을 한 번 더 구워 올리고 `content.en` 에 넣는다.
   `translatedFrom` 이 서버 해시와 같으므로 저장 시 `fillTranslations` 는 en 을 건드리지 않는다.

옛 카드뉴스 10건(82장, 아임웹 시절 이미지)은 같은 길로 새 레이아웃 덱으로 다시 쓴다. 기준은 픽셀 일치가
아니라 **원문 텍스트 전부 포함 · 고아 줄 0 · 넘침 0** (사이트 `lib/cardnews-lint.ts`). 그 재작성은 사이트 저장소의
`mydocs/plans/2026-09-07-cardnews-rebuild.md`.

작업지시자 승인: 채팅으로 "서브에이전트로 작업 진행해줘" (2026-09-07). 이 계획서는 그 지시를 기록한 것이다.

## Omnis 가 할 일

| 무엇 | 어디 |
|---|---|
| `translateDeck(deck, from, to)` — 카드의 글자 칸만 번역. 배지 · handle · 사진 · 레이아웃은 그대로 | `lib/website-translate.ts` |
| `POST /api/website/translate` — SSO. `{ from, to, locale, deck? }` → `{ locale, deck? }`. Zod 검증. Gemini 예산 안 | `app/api/website/translate/route.ts` |
| 옛 카드뉴스 재작성 스크립트 — 덱 JSON 을 받아 번역 → 사이트 검사 페이지로 렌더·검사 → NAS · Neon 반영 | `scripts/rebuild-cardnews.ts` |

## 검증

- 라우트 직접 호출: 토큰 없음 401 · 잘못된 덱 400 · 정상 → en 덱의 카드 수·타입·레이아웃·사진 src 가 원문과 같음, 글자 칸만 바뀜
- `npm run verify`

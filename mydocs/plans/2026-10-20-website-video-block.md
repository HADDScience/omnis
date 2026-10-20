---
kind: decision
status: active
canonical: mydocs/plans/2026-10-20-website-video-block.md
last_verified: 2026-10-20
---

# 홈페이지 기사 본문에 유튜브 영상 블록

상태: 2026-10-20 작업지시자 지시서로 범위·형식이 정해졌다(블록 모양, 번역 처리, 사이트 렌더·편집기, 배포 순서). 병합·배포는 사람이 한다.
사이트 저장소(`haddscience.com`)와 함께 바뀌는 작업이라 계획서는 여기 둔다(사이트 `AGENTS.md`).

## 왜

기사에 행사 영상·인터뷰를 넣으려면 지금은 링크 목록에 주소를 거는 수밖에 없다. 본문 안에서 바로 재생되게 한다.
카드뉴스 덱(카드 그림)은 대상이 아니다. 기사 본문 블록만이다.

## 블록 모양

```ts
{ type: "video", provider: "youtube", id: "6C6ythdPMa4", start?: 355, title?: "짧은 설명" }
```

- **URL 이 아니라 ID 를 저장한다.** 임베드 주소는 사이트가 `youtube-nocookie.com/embed/<id>` 로 만든다.
  저장값이 주소면 아무 곳이나 iframe 으로 끼울 수 있게 된다. ID 는 `^[A-Za-z0-9_-]{11}$` 로 거른다.
- `provider` 는 지금 `"youtube"` 하나뿐이다. 다른 곳을 붙일 때 블록 type 을 새로 만들지 않으려고 칸만 둔다.
- `start` 는 초 단위 정수(0 이상, 24시간 이하).

## 번역

- `title` 은 번역한다. 이미지 `alt`·`caption`, 링크 목록 `title` 을 번역하는 것과 같은 이유 — 화면에 보이는 글자다.
- `provider`·`id`·`start` 는 원문에서 그대로 가져온다. 모델에게 보내지도 않는다.
- 원문 해시(`sourceHash`)에는 블록 전체가 들어간다. 이미지와 달리 영상은 언어마다 다를 이유가 없어,
  한국어판에서 영상을 바꾸면 영문판도 다시 만들어지게 둔다.

## 단계

1. Omnis — `PostBlockSchema` 에 video, `website-translate.ts` 에 video 분기, 블록 type 을 표로 다루는 스크립트(`import-news-blocks.ts`) 보강
   → 검증: `scripts/verify-website-video.ts`(통과·거부 사례 + 가짜 Gemini 응답으로 번역 경로) · `pnpm run verify`
2. 사이트 — `content/types.ts`, `PostBody` 렌더, `/admin` 블록 편집기(주소 붙여 넣기 → ID·시작 시각), 칼럼 docx 내보내기
   → 검증: `pnpm typecheck && pnpm lint && pnpm build`, dev 서버에서 Playwright 로 iframe 확인
3. 문서 — 사이트 `docs/콘텐츠-관리.md`

스키마는 JSON 칸(`WebsitePost.content`) 안의 모양이라 Prisma 마이그레이션은 없다.

## 배포 순서

1. **Omnis 먼저** 병합(→ 운영 배포). 이게 나가기 전에는 Omnis 가 video 블록이 든 저장 요청을 400 으로 거절한다.
2. 그 다음 사이트 병합. 사이트를 먼저 내도 기존 글은 그대로 보이지만, 편집기에서 영상 블록을 넣고 저장하면 실패한다.

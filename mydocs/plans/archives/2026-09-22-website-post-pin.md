---
kind: decision
status: active
canonical: AGENTS.md
last_verified: 2026-09-22
---

# 홈페이지 기사 고정(HADD PICK)

상태: 2026-09-22 설계 선택지에 대해 작업지시자 확정. 구현 뒤 배포 승인 대기.
사이트 쪽 변경은 `hadd-website` 저장소가 맡고 이 문서를 가리킨다.

## 왜

대표님이 기사 하나를 "앞으로 빼 달라"고 했고, 그날은 `position` 을 손으로 0 으로 옮겨 처리했다.
그러면 목록 맨 위에 오기는 하지만 **왜 거기 있는지가 화면에 드러나지 않는다** — 날짜 순서만
깨진 것처럼 보인다. 회사가 밀고 싶은 글을 고르는 일은 앞으로도 생기므로, 순서를 손으로
흔드는 대신 **고정**이라는 상태를 따로 둔다.

## 확정된 것 (작업지시자 2026-09-22)

| 항목 | 정한 것 |
|---|---|
| 화면 | 카드 크기는 그대로. **브랜드 블루 테두리 + 진한 그림자 + 배지** |
| 배지 문구 | `HADD PICK` — 한글·영문 같은 말 |
| 개수 | 제한 없음. 뉴스·하드:라이브러리 **각각** |
| 순서 | 고정 글이 먼저, 그 안에서는 기존 `position` 순서 |

## 저장 모양

`WebsitePost` 에 열 하나를 더한다. `position` 을 건드리지 않는 **덧씌우기**다 —
고정을 풀면 원래 있던 자리로 그대로 돌아간다. 순서를 옮겨 고정을 흉내 내면 이 되돌리기가 없다.

```sql
ALTER TABLE "WebsitePost" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "WebsitePost_category_pinned_position_idx"
  ON "WebsitePost"("category", "pinned", "position");
```

기존 글은 전부 `false`. 열이 늘어날 뿐이라 **옛 코드가 도는 중에 먼저 적용해도 안전하다**.

`listPosts` 의 정렬이 `[{ position: asc }, { id: desc }]` 에서
`[{ pinned: desc }, { position: asc }, { id: desc }]` 로 바뀐다. 사이트는 받은 순서를 그대로
그리므로 사이트 쪽 정렬 코드는 손대지 않는다.

## API

- `PostInputSchema.pinned` 는 **선택**이다. 보내지 않으면 원래 값을 지킨다 —
  `category` 와 같은 이유다. 고정을 모르는 옛 관리 화면이 저장했다고 고정이 풀리면 안 된다.
- 토글은 전용 경로를 둔다. 기사 전체를 PUT 하면 본문·덱까지 다시 쓰고 번역 검사가 도는데,
  압정 한 번 누르자고 치를 값이 아니다.

```
PUT /api/website/posts/<id>/pin   { "pinned": true }   → { ok, pinned }
```

인증은 다른 홈페이지 API 와 같다(`requireWebsiteUser`). 저장 뒤 `revalidateWebsite()`.

## 사이트 (hadd-website)

- `content/types.ts` — `Post.pinned` · `NewsItem.pinned`
- `content/server.ts` — `fromDto` 에서 받고 `toNewsItem` 으로 넘긴다
- `components/ds/cards.tsx` — 고정 카드에 테두리·그림자·배지
- `content/{ko,en}.ts` — `ui.pinned = "HADD PICK"` (두 언어 같은 문자열)
- `app/admin` — 목록 줄마다 압정 토글, 고정 글에는 목록에서도 배지

## 순서

1. 마이그레이션을 운영 DB 에 적용 (되돌리기 쉬운 추가 전용)
2. Omnis 배포 — API 가 `pinned` 를 싣고 받는다
3. 사이트 배포 — 배지가 그려지고 관리 화면에 토글이 생긴다

2 보다 3 이 먼저 나가도 깨지지 않는다. `pinned` 가 없으면 사이트가 `false` 로 읽는다.

## 하지 않는 것

- 고정 개수 제한. 작업지시자가 제한 없이 가자고 했다. 남용되면 그때 막는다.
- 고정 만료(며칠 뒤 자동 해제). 지금 필요하다는 근거가 없다.
- 목록 첫 줄을 가로로 넓게 쓰는 배치. 검토했으나 카드 크기는 그대로 두기로 했다.

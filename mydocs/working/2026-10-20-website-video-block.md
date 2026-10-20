---
kind: snapshot
status: active
canonical: mydocs/working/2026-10-20-website-video-block.md
last_verified: 2026-10-20
---

# 홈페이지 기사 영상 블록 — 검증

계획: [`mydocs/plans/2026-10-20-website-video-block.md`](../plans/2026-10-20-website-video-block.md).
사이트 쪽 변경은 `haddscience.com` 저장소 `feat/video-block` 브랜치.

## Omnis

### `npx tsx --env-file=../omnis-local/.env scripts/verify-website-video.ts`

로컬 DB(`omnis-db-local`). Gemini 는 부르지 않고 fetch 를 가짜 응답으로 바꿨다.
`callGemini` 가 사용량을 기록하므로 돌릴 때마다 로컬 `GeminiUsage` 에 `websiteTranslate` 행이 3개(토큰 0) 쌓인다.

```
— 받는 것
✓ ID·시작·제목 → true
✓ ID 만 → true
✓ - _ 가 든 ID → true
✓ start 0 → true
— 거절하는 것
✓ 주소를 ID 칸에 → false
✓ 10자 → false
✓ 12자 → false
✓ 따옴표가 든 ID → false
✓ 다른 provider → false
✓ provider 없음 → false
✓ 음수 start → false
✓ 소수 start → false
✓ 문자열 start → false
✓ 24시간 넘는 start → false
— 기사 저장 요청 전체
✓ 영상 블록이 든 기사 → true
— 원문 해시
✓ 영상 ID 를 바꾸면 해시가 바뀐다 → true
✓ 시작 위치를 바꾸면 해시가 바뀐다 → true
✓ 같은 원문이면 해시가 같다 → true
— 번역
✓ 제목만 번역되고 ID·시작은 원문 → {"type":"video","provider":"youtube","id":"6C6ythdPMa4","start":355,"title":"HADD Science talk"}
✓ 모델에 영상 ID 를 보내지 않는다 → false
✓ 번역본도 스키마를 통과 → true
✓ 제목 없는 영상은 제목 없이 → {"type":"video","provider":"youtube","id":"6C6ythdPMa4"}
✓ 번역이 비면 원문 제목 → {"type":"video","provider":"youtube","id":"6C6ythdPMa4","start":355,"title":"하드사이언스 발표"}

전부 통과
```

### 품질 게이트

| 명령 | 결과 |
|---|---|
| `pnpm run verify` | exit 0. 0 errors, 43 warnings — 전부 이번에 고치지 않은 파일 |
| `DATABASE_URL=postgresql://x@localhost/x pnpm run build` | exit 0 |

## 사이트와 함께 (로컬)

목업 Omnis(포트 4599)를 띄우고 사이트 `next dev --webpack -p 3456` 을 그쪽에 붙였다. 목업은 PUT 본문을
**이 브랜치의 `PostInputSchema`** 로 검사한다.

| 확인 | 결과 |
|---|---|
| `/ko/news/999999901/` 서버 HTML | `<iframe src="https://www.youtube-nocookie.com/embed/6C6ythdPMa4?start=355" title="영상 블록 확인용" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" …>` |
| 같은 페이지, Playwright 1200px | iframe 776×437(비율 1.778), 플레이어가 영상 제목·재생 버튼을 그림 |
| 같은 페이지, 360px | iframe 297×167(비율 1.778), 가로 넘침 없음 |
| `/admin` 편집기 — 「영상」 버튼 → `vimeo.com/123` 붙여 넣기 | 「유튜브 주소를 읽지 못했습니다 …」 |
| 같은 칸에 `watch?v=6C6ythdPMa4&t=5m55s` | 시작 위치 355 · 「5분 55초부터 재생합니다」 · 미리보기 iframe `…/embed/6C6ythdPMa4?start=355` |
| 영상 블록 둘을 위·아래로 바꾸기 | 주소 칸과 미리보기가 각자 영상을 따라감 |
| 빈 영상 블록으로 저장 | 400, 화면 알림 `content.ko.blocks.3.id: 유튜브 영상 ID 는 영문·숫자·-·_ 11자입니다` |
| `youtube.com/shorts/dQw4w9WgXcQ?feature=share` 붙여 넣고 저장 | 스키마 통과, 「저장했습니다」. 보낸 블록 `{"type":"video","provider":"youtube","id":"dQw4w9WgXcQ"}` |

## 확인 안 함

- 실제 Gemini 로 영상 제목이 든 기사를 번역하는 것
- 운영 Omnis 에 저장하는 것(운영 DB 쓰기는 이번 범위가 아니다)
- 프리뷰 배포본에서의 HTTP 확인

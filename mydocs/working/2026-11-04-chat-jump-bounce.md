---
kind: snapshot
status: active
canonical: lib/chat-arrival.ts
last_verified: 2026-11-04
---

# 채팅 검색 결과에 도착하면 글이 튕긴다

- `MessageList` 가 스크롤을 끝낸 다음 프레임에 도착한 글을 0.9초 한 번 튕긴다(Web Animations). 처음 로드 범위 밖이면 앞뒤를 불러온 뒤 같은 길로 재생한다
- 강조를 한곳(`arrivalEffects`)으로 모았다. 움직임 줄이기는 튕기지 않고 말풍선 강조, 걸린 글자 표시가 되면 말풍선은 칠하지 않는다. 말풍선 강조는 2초에서 1.2초로 줄였다
- 검색어를 고치는 동안 같은 글에 머물면 튕기지 않는다. 더 갈 결과가 없을 때 Enter 는 지금 결과를 다시 보여 준다(▲▼ 단추의 비활성은 그대로)
- 폰에서 검색칸에 포커스가 있으면 입력창처럼 셸을 키보드 위 높이로 줄인다 — 도착한 글이 키보드 뒤에 있지 않게
- 메시지 검색은 전사 · 사람 방과 PC 대화 패널(`ChatPanel`)에만 있다. 업무 · 옴니스 방에는 검색이 없어 재생할 경로가 없다. 방 목록 검색은 방을 찾을 뿐 글로 가지 않는다
- 시험: `lib/chat-arrival.test.ts`, `tests/feature/chat-search-arrival.spec.ts`. 실제 아이폰은 확인하지 못했다

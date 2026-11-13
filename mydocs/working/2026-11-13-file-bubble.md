---
kind: snapshot
status: active
canonical: mydocs/working/2026-11-13-file-bubble.md
last_verified: 2026-11-13
---

# 채팅 파일 카드 — 카톡처럼 (2026-11-13)

참고 화면: `~/work/omnis-reports/file-bubble-261113/` (kakao-file-card.png · omnis-phone.png → after-*.png)

## 한 것

| 요청 | 구현 |
|---|---|
| ① 파일 카드 | `components/chat/file-card.tsx` — 이름(두 줄) · 형식 · 용량, 오른쪽 받기 단추. 누르면 카드 안에서 받는다(진행률 원 + 아래 막대 · 취소). 받은 뒤 다시 누르면 연다: 폰(터치 + 파일 공유 가능) 공유 시트, PC 는 PDF · 사진 · 영상 · 글은 새 탭, 나머지(zip · hwp · pptx)는 저장. 받은 PDF 는 첫 장(unpdf, 받은 뒤에만 불러옴), 큰 사진은 줄인 그림이 오른쪽 칸 미리보기가 된다. 말풍선 바깥 옆에 공유 단추(내 글 왼쪽 · 남의 글 오른쪽) |
| 기기 기억 | `lib/file-cache/client.ts` — Cache Storage(`omnis-files-v1`) + localStorage 목록. 합계 300MB, 넘치면 오래 안 연 것부터 지운다(`rules.ts` `planEviction`). 300MB 넘는 파일 하나는 그 탭 메모리에만. 로그아웃 때 비운다 |
| 큰 파일 | `/api/files/{id}/raw` 가 R2 서명 주소로 302 → fetch 가 따라간다(버킷 CORS GET 열림). 진행률은 Content-Length(없으면 저장된 크기) |
| 원본 없음 | `MissingAttachmentTile` 그대로 |
| ② 폰 · PC 같은 모양 | 전사 · 사람 방(`data-chat-room-chrome`)에서 첨부가 든 글은 PC 도 글 말풍선과 카드를 따로 놓는다. 파일은 한 장씩 같은 `FileCard` |
| ③ 대괄호 글 | 화면은 본문을 비워 보낸다(`message-input.tsx`). 서버는 첨부가 있으면 빈 본문을 받는다. 푸시 · 목록 미리보기 · 답장 인용은 「파일 N개」(`lib/attachment-text.ts`). 옛 「[파일 N개 첨부]」 는 DB 그대로, 화면에서만 숨긴다. 옴니스 방은 에이전트가 읽을 글이 필요해 자리글을 계속 보내고 화면에서만 숨긴다 |
| ④ 모두 저장 | `hidden` — 코드는 남김. 여러 개는 방 서랍에서 |

## 남은 것 · 모르는 것

- iPhone 실기기의 공유 시트 · 진행률은 보지 않았다(e2e 는 navigator.share 를 흉내 냄)
- 참여자만 보는 방의 파일도 받으면 기기에 남는다 — 방을 나가도 받아 둔 것은 열린다(카톡과 같다). 로그아웃 때는 지운다
- 운영 R2 큰 파일의 실제 진행률 표시는 운영에서 확인 전

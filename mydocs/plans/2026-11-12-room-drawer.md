---
kind: decision
status: active
canonical: lib/room-drawer.ts
last_verified: 2026-11-12
---

# 채팅 방 서랍 + 파일 한 번에 받기

## 목표
방에 쌓인 사진 · 파일 · 링크 · 참여자를 한 곳(서랍)에서 보고, 여러 첨부를 한 번에 받는다.
옛 브랜치 `feat/k-drawer` 에는 서랍이 없어(화면 비율 커밋뿐) 새로 만든다. 사진 모아보기(`room-photo-grid.tsx`)는 서랍의 사진 탭으로 옮긴다.

## 범위
1. 입구 — 방 머리 오른쪽 ≡(전사방 · 단톡 · 1:1 · 카톡 이식 방, PC 오른쪽 패널 안 방도 같은 부품). PC 는 오른쪽 칸, 폰은 전체 시트
2. 탭 — 사진(격자 · 최신순 · 누르면 뷰어) / 파일(이름 · 크기 · 보낸 사람 · 날짜) / 링크 / 참여자
3. 사진 · 파일 탭 — 기간(이번 주 · 이번 달 · 전체, 서울 기준) · 종류 필터, 다중 선택, 「N개 받기 · 총 크기」
4. 받기 — 서버는 주소만 준다(R2 는 서명 주소, NAS 파일은 /raw). 브라우저가 하나씩 받아 STORE zip 으로 묶는다(Vercel 응답 4.5MB 한도)
   - PC: 저장 위치 창(크롬 · 엣지)으로 디스크에 바로, 없으면 모아서 한 번에
   - 폰: 사진 · 동영상만이면 공유 시트(navigator.share files) → 「사진에 저장」, 문서가 섞이면 zip
   - 1GB 넘으면 나눠 받기 단추(묶음마다 zip)
   - zip 안 이름: `방이름_YYMM/YYYY-MM-DD_보낸사람_원래이름`, 겹치면 `(2)`
5. 카톡 자리표시(첨부 없는 `File: …` · `Photo`) — 받기 전에 「N개는 원본 없음」, zip 에 `빠진파일.txt`
6. 권한 — 방은 roomAccess, 파일은 canSeeFile(작성자 전용 · 방 밖 파일 제외). 다른 방 파일 id 는 받기에서 빠진다
7. 진행률 · 취소 — 모듈 상태라 화면을 옮겨도 하단 알약으로 남는다(채팅 방 안에서는 입력창 위로 올린다)
8. 묶음 글(한 글에 첨부 2개 이상) — 「모두 저장」

## 순서
1. 순수 규칙 `lib/room-drawer.ts` · `lib/zip-stream.ts` + 단위 시험
2. 서버 `lib/room-drawer-server.ts` · `/api/chat/drawer` · `/api/chat/drawer/download`
3. 브라우저 받기 `lib/room-download/client.ts` · 하단 표시 `components/layout/room-download-status.tsx`
4. 서랍 `components/messenger/room-drawer.tsx` · 방 머리 단추 · 사진 뷰어 연결 · 「모두 저장」
5. e2e `tests/feature/room-drawer.spec.ts`, 기존 모아보기 시험을 서랍 기준으로

---
kind: snapshot
status: active
canonical: mydocs/plans/2026-11-03-unified-composer.md
last_verified: 2026-11-03
---

# 메신저 입력창 하나로 — 결과

`RoomComposer`(components/chat/room-composer.tsx) 하나를 사람 · 전사 · 업무 · 옴니스 방과 입장 화면이 함께 그린다. 자동완성은 사람 쪽만 넘긴다.

## 실측 (2026-11-03, 격리 DB localhost:5433/omnis_e2e_*, 운영 env 없는 워크트리)

- `pnpm run verify`: 에러 0, 경고 38
- `pnpm run test:unit`: 320 통과 · 실패 0
- `pnpm run build`: 성공
- `tests/feature/room-composer.spec.ts`: 6/6 — 네 방 모양 동일(1440 · 390) · 옴니스 방 자동완성 없음 · `/업무 @이름 #업무` 가 /api/agent 로만 가고 /api/chat/messages 호출 0 · 보내는 중 입력 가능 · 두 번 보내기 1건 · 실패 시 글 복원 · 입장 화면 글 이어받기 · 패널 전송
- 전체 feature(dev 서버): 56 통과 · 1 건너뜀 · 3 실패
  - onboarding :151 — origin/main 에서도 실패(/omnis 이동 대기 60초 초과)
  - onboarding :501 — 안내 장면 시간 진행과 어긋남. 앞선 실행에서는 통과. 입력창과 무관한 장면 이동에서 멈춘다
  - record-proposals — 단독 재실행 통과

## 못 한 것

실제 아이폰 확인 · 실제 파일 업로드(데모 빌드에는 첨부가 없어 e2e 로 지나가지 않는다. `scripts/verify-people-attach.mjs` · `verify-omnis-attach.mjs` 는 안 돌렸다)


## 이어서 (2026-11-03) — main 합치기 · 업로드 재시도 · 보내는 줄 · 포커스 · 단축키

계획은 작업지시자 지시를 그대로 따른다. DB 스키마는 바꾸지 않았다(단축키는 테마처럼 이 기기 localStorage).

- main(0612ffb)을 합쳤다. 충돌 없음
- `lib/storage.ts`: PUT 이 응답 없이 끊기면(`ECONNRESET` · `socket hang up`) 1회 재시도. 지문 불일치 · 30초 한도 · HTTP 오류는 재시도하지 않는다. 진짜 TLS 서버 대조: 한 번 끊김 → 성공(PUT 2회), 계속 끊김 → 실패(2회), 403 → 실패(1회)
- `lib/serial-queue.ts`: 전사 · 사람 · 업무 방은 글마다 말풍선을 바로 띄우고 서버에는 쓴 순서대로 보낸다. 앞 글을 기다리는 동안 뒤 글은 서버로 가지 않는다. 실패한 글과 첨부만 입력칸으로 돌아오고 뒤 글은 간다
- 옴니스 방은 그대로 — 고른 순간 올리는 방식이라, 올리는 동안 글은 쓸 수 있고 보내기는 기다린다
- 포커스: PC 는 보낸 뒤 입력칸으로 돌아온다. 폰은 쓰던 중이면 키보드를 지키고, 내려 둔 키보드는 올리지 않는다
- 단축키: `lib/shortcuts.ts` · `hooks/use-shortcuts.ts` · `components/settings/keyboard-shortcuts.tsx`. D → ⌥⇧D, C/ㅊ → ⌥⇧C. ⌘K · ⌘⇧F 는 원래 조합키였고 입력칸 안에서도 받는다(규칙에 적힌 동작 유지)
- `sidebar.tsx` 의 ⌘B 는 SidebarProvider 를 쓰는 곳이 없어 동작하지 않는다. 안내 · 랜딩의 Esc · 방향키는 그 화면 안의 이동 키라 대상이 아니다
- 실제 업로드: `scripts/verify-upload-queue.mjs` — 임시 로컬 DB + 시놀로지 `_dev`, 세 방 모두 통과. `_dev` 에 시험 사진 12장이 남는다
- 앞선 dev 전체 실패(onboarding :151 · :501 · record-proposals)는 이번 변경과 무관했다. dev 서버 실행마다 실패 목록이 달라졌고(다음 실행은 chat-quality :65 · onboarding :151 · tasks-overview 2건), 빌드한 서버(CI 조건)에서는 모두 통과

못 한 것: 실제 아이폰 · 안드로이드의 키보드 동작(Playwright 터치 흉내로만 확인), 운영 시놀로지에서 끊김이 재현되는지

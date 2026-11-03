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

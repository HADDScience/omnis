---
kind: decision
status: active
canonical: AGENTS.md
last_verified: 2026-11-17
---

# 기능 요청 완료 알림 — 요청한 사람에게 (2026-11-17)

## 목표
기능 요청을 완료로 바꿀 때 그 요청을 남긴 사람에게 「생겼습니다」 를 알린다. 전에는 상태만 바뀌고 요청한 사람은 몰랐다.
전체 사용자 팝업 · 공지는 만들지 않는다(추후 검토).

## 동작
- 관리 화면(/settings/feature-requests · /admin/operations)에서 「완료」 를 누르면 창이 뜬다
  - 바뀐 것 한 줄(120자) · 바로 써 볼 곳(옴니스 안의 경로, `/` 로 시작) · 알림 켜고 끄기 · 받는 사람 벨 모양 미리보기
- 받는 사람: 그 묶음에 요청을 남긴 재직 계정, **바꾸는 사람은 뺀다**
- 알림(Notification `feature_request_done`)
  - 제목 `요청하신 기능이 생겼습니다 — <요청 제목>`
  - 내용 `<바뀐 것>` + `써 보고 불편하면 답장 주세요.`
  - entityId `<요청 id>:<경로>` — 누르면(벨 · 푸시) 그 경로로 간다(lib/schemas/notification.ts)
  - 벨에 「써 보기」 · 「답장」 단추. 답장은 /api/feedback `replyTo` 로 `[답장] <요청 제목>` 기능 요청이 되어 개발자에게 간다. 그 요청을 남긴 사람만
- 한 번만: 완료로 「넘어갈 때」 만 보낸다(조건부 updateMany). 이미 완료면 notified 0
- notice 없이 PATCH 하면 예전처럼 상태만 바뀐다
- 감사: ActivityLog `feature_request.status` 제목에 「요청한 사람 N명에게 알림」

## 파일
- lib/feature-requests-shared.ts — 순수 규칙(parseDoneNotice · doneNoticeText · entityId)
- lib/feature-requests.ts — changeFeatureStatus · requesterIds · featureForReply
- app/api/feature-requests/[id]/route.ts · app/api/feedback/route.ts
- components/settings/feature-status.tsx(완료 창) · feature-reply-dialog.tsx · components/layout/notification-bell.tsx

## 시험
- lib/feature-requests-done.test.ts
- tests/feature/feature-done-notify.spec.ts

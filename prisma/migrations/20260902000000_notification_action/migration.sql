-- 알림에 "사용자 응답" 개념 추가 (nullable, 추가형 — 기존 알림은 전부 단순 통보로 남는다)
-- actionType: 응답이 필요한 알림의 종류. lib/schemas/notification.ts 의 NotificationActionSchema 와 동기화.
-- resolvedAt: 응답 시각. actionType IS NOT NULL AND resolvedAt IS NULL → 미해결(삭제 불가).
ALTER TABLE "Notification" ADD COLUMN "actionType" TEXT;
ALTER TABLE "Notification" ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE INDEX "Notification_userId_actionType_resolvedAt_idx"
  ON "Notification"("userId", "actionType", "resolvedAt");

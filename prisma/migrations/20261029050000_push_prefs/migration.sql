-- 채팅 · 업무 · 일정 푸시 켜고 끄기(2026-10-29). 추가만 — 지금 운영 코드는 이 칸 · 표를 읽지 않는다.
-- 기본값이 곧 결정(전부 켜짐 · 방은 켜짐)이라 백필이 없다. mydocs/plans/2026-10-29-push-notifications.md

-- 방별 채팅 푸시 끄기
ALTER TABLE "ChatRoomPref" ADD COLUMN     "muted" BOOLEAN NOT NULL DEFAULT false;

-- 사람별 종류 설정 — 행이 없으면 전부 켜짐
CREATE TABLE "NotificationPref" (
    "userId" TEXT NOT NULL,
    "chatPush" BOOLEAN NOT NULL DEFAULT true,
    "taskPush" BOOLEAN NOT NULL DEFAULT true,
    "calendarPush" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

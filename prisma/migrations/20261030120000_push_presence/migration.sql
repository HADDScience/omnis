-- 쓰고 있는 기기(2026-10-30). 추가만 — 지금 운영 코드는 이 표를 읽지 않는다.
-- 빈 표가 곧 「아무 기기에서도 쓰고 있지 않다」라 백필이 없다. mydocs/plans/2026-10-30-push-active-device.md

CREATE TABLE "PushPresence" (
    "userId" TEXT NOT NULL,
    "activeAt" TIMESTAMP(3) NOT NULL,
    "endpoint" TEXT,

    CONSTRAINT "PushPresence_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "PushPresence" ADD CONSTRAINT "PushPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

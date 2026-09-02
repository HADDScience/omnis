-- SSO grant 의 1회용 강제.
-- jti 를 PK 로 두고 INSERT 를 시도하는 것 자체가 재사용 검사다.
CREATE TABLE "SsoGrant" (
    "jti" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoGrant_pkey" PRIMARY KEY ("jti")
);

-- 만료된 행을 쓸어담을 때 쓴다
CREATE INDEX "SsoGrant_expiresAt_idx" ON "SsoGrant"("expiresAt");

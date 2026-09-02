-- 자체 계정(User)에 붙이는 소셜 로그인 수단
CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- 한 소셜 계정은 한 사람에게만 붙는다
CREATE UNIQUE INDEX "UserIdentity_provider_providerAccountId_key"
    ON "UserIdentity"("provider", "providerAccountId");

-- 한 사람이 같은 제공자를 두 번 붙일 수 없다
CREATE UNIQUE INDEX "UserIdentity_userId_provider_key"
    ON "UserIdentity"("userId", "provider");

CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");

ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

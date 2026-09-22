-- 홈페이지 방문 기록. 사이트가 한 건씩 넣고 관리 화면이 집계해서 읽는다.
-- 쿠키도 IP 도 저장하지 않는다 — 방문자 구분은 사이트가 만든 하루짜리 해시뿐이다.
CREATE TABLE "WebsiteVisit" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "path" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "referrerHost" TEXT,
    "device" TEXT NOT NULL,

    CONSTRAINT "WebsiteVisit_pkey" PRIMARY KEY ("id")
);

-- 기간으로 자르는 질의가 전부다(일별 추이 · 합계).
CREATE INDEX "WebsiteVisit_at_idx" ON "WebsiteVisit"("at");

-- 인기 경로는 경로별로 모은 뒤 기간으로 자른다.
CREATE INDEX "WebsiteVisit_path_at_idx" ON "WebsiteVisit"("path", "at");

-- 홈페이지 기사에 목록 구분을 더한다. 기존 글은 모두 뉴스다.
ALTER TABLE "WebsitePost" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'news';

-- 목록은 구분별로 position 순서대로 읽는다.
CREATE INDEX "WebsitePost_category_position_idx" ON "WebsitePost"("category", "position");

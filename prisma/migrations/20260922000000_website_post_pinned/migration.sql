-- 홈페이지 기사에 고정을 더한다. 기존 글은 모두 고정되지 않은 상태다.
-- position 을 건드리지 않는 덧씌우기라, 고정을 풀면 원래 자리로 그대로 돌아간다.
ALTER TABLE "WebsitePost" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- 목록은 분류별로 고정 먼저, 그 안에서 position 순서로 읽는다.
CREATE INDEX "WebsitePost_category_pinned_position_idx" ON "WebsitePost"("category", "pinned", "position");

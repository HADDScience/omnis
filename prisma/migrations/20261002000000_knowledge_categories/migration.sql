-- 지식 카드 분류를 엄격 모드 6개로 맞춘다 (lib/knowledge-categories.ts 와 같은 목록).
-- 스키마는 그대로고 행만 넣는다. 이미 있으면 건드리지 않는다 — 운영에서 사람이 바꾼 아이콘을 덮지 않게.
INSERT INTO "OmnisCategory" ("id", "name", "icon", "sortOrder") VALUES
  (gen_random_uuid()::text, '기업정보', '🏢', 1),
  (gen_random_uuid()::text, '인력현황', '👥', 2),
  (gen_random_uuid()::text, '지식재산권', '📜', 3),
  (gen_random_uuid()::text, '회사 연혁·실적', '🏆', 4),
  (gen_random_uuid()::text, '제품·기술', '🧪', 5),
  (gen_random_uuid()::text, '업무 절차', '🗂️', 6)
ON CONFLICT ("name") DO NOTHING;

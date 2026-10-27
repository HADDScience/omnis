-- 외부 기업·인물 조사를 담을 분류를 하나 더한다 (lib/knowledge-categories.ts 와 같은 목록).
-- 엄격 모드 6개는 모두 우리 회사 내부의 것이라 제휴·미팅 전 조사가 들어갈 자리가 없었다.
-- 이미 있으면 건드리지 않는다 — 운영에서 사람이 바꾼 아이콘을 덮지 않게.
INSERT INTO "OmnisCategory" ("id", "name", "icon", "sortOrder") VALUES
  (gen_random_uuid()::text, '외부 기업·인물', '🔎', 7)
ON CONFLICT ("name") DO NOTHING;

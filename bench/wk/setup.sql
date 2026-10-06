-- WeKnora 이식 실험(bench/wk) 전용 인덱스 — 로컬 실험 DB(omnis_wklab) 에만 건다.
-- Prisma 마이그레이션이 아니다. 운영 DB 에 돌리지 않는다.
--
--   docker exec -i omnis-db-local psql -U omnis -d omnis_wklab < bench/wk/setup.sql
--
-- R1a(pg_trgm) · R1b(BM25 근사) 의 후보 필터 `content ILIKE '%키워드%'` 를 trigram GIN 으로 받는다.
-- 키워드가 두 글자면 패턴에서 trigram 이 안 나와 인덱스를 못 쓰고 순차 스캔이 된다 (청크 8천여 건이라 감당된다).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "EmbeddingChunk_content_trgm_wk" ON "EmbeddingChunk" USING gin ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "EmbeddingChunk_title_trgm_wk" ON "EmbeddingChunk" USING gin ("title" gin_trgm_ops);
ANALYZE "EmbeddingChunk";

-- 공통 층 색인 칸 (2026-11-27, P4) — mydocs/plans/2026-11-27-ontology-phase1.md §6-3
-- EmbeddingChunk 에 유형 키 · 공개 범위 토큰 칸을 더한다. 기존 행 채우기는 마이그레이션이 아니라
-- scripts/backfill-embedding-typekey.ts(건식 → 확인 → --apply)로 한다.
-- 두 칸 모두 비어 있어도 되고(visibility 는 빈 배열 기본값) PG11+ 은 기본값 칸을 더할 때 표를 다시 쓰지 않는다.
-- 그래도 ACCESS EXCLUSIVE 잠금을 잠깐 잡으므로 오래 기다리면 실패하게 한다(임베딩 쓰기 · 검색을 붙잡지 않게).
-- 다시 돌려도 된다(IF NOT EXISTS). 되돌리기: prisma/rollbacks/20261127235200_embedding_object_columns.down.sql
SET lock_timeout = '5s';

ALTER TABLE "EmbeddingChunk" ADD COLUMN IF NOT EXISTS "typeKey" TEXT;
ALTER TABLE "EmbeddingChunk" ADD COLUMN IF NOT EXISTS "visibility" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "EmbeddingChunk_typeKey_idx" ON "EmbeddingChunk"("typeKey");

-- 되돌리기: 20261127235200_embedding_object_columns (EmbeddingChunk.typeKey · visibility)
--
-- 칸은 비어 있어도 되고 기존 코드는 읽지 않아, 트리거를 걷을 때(20261127235000_object_change.down.sql) 함께 지울 필요는 없다.
-- 정말 칸까지 지울 때만 돌린다. OBJECT 조각(공통 층이 만든 색인)도 함께 지운다 — typeKey 없이는 뜻이 없다.
-- enum 값 OBJECT(20261127235100_embedding_source_object)는 Postgres 가 지울 수 없어 남긴다. 그 기록 줄도 남긴다.
-- 다시 돌려도 된다(IF EXISTS). 대상 DB 를 먼저 찍고 확인한다. 운영은 작업지시자 승인 뒤에만.

SET lock_timeout = '5s';
BEGIN;
DELETE FROM "EmbeddingChunk" WHERE "source" = 'OBJECT';
DROP INDEX IF EXISTS "EmbeddingChunk_typeKey_idx";
ALTER TABLE "EmbeddingChunk" DROP COLUMN IF EXISTS "visibility";
ALTER TABLE "EmbeddingChunk" DROP COLUMN IF EXISTS "typeKey";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127235200_embedding_object_columns';
COMMIT;

-- 공통 층 색인 원천 값 OBJECT (2026-11-27, P4) — mydocs/plans/2026-11-27-ontology-phase1.md §6-3
-- enum 값 추가만 따로 둔다. ALTER TYPE … ADD VALUE 로 더한 값은 같은 트랜잭션 안에서 쓸 수 없어서,
-- 그 값을 쓰는 칼럼 · 자료 변경(20261127235200_embedding_object_columns)과 나눈다.
-- IF NOT EXISTS 라 다시 돌려도 된다(데모 미리보기). Postgres 는 enum 값을 지울 수 없다 — 되돌리기에서도 남긴다.
-- 기존 검색(lib/embeddings.ts ALL_SOURCES)은 이 값을 읽지 않는다.
ALTER TYPE "EmbeddingSource" ADD VALUE IF NOT EXISTS 'OBJECT';

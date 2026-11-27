/**
 * EmbeddingChunk.typeKey · visibility 채우기(공통 층 P4) — 마이그레이션 20261127235200 이 칸만 만들고 비워 둔다.
 *
 *   npx tsx scripts/backfill-embedding-typekey.ts            # 건식: 채울 건수만
 *   npx tsx scripts/backfill-embedding-typekey.ts --apply    # 한 트랜잭션으로 채운다
 *   운영은 --prod 를 함께 줘야 쓴다(작업지시자 승인 뒤, db:deploy 다음)
 *
 * 다시 돌려도 된다 — 이미 같은 값인 행은 건드리지 않는다(두 번째는 0건).
 * 기존 검색(lib/embeddings.ts)은 이 칸을 읽지 않는다. 새 일반 검색(P5)이 typeKey · visibility 로 거른다.
 *
 * typeKey: OMNIS_CARD → card · TASK → task · WEEKLY_REPORT → weekly_report · CHAT_MESSAGE → chat_message ·
 *          PHOTO → photo(원천 키, 등록 유형 아님) · IP_CASE → sourceId 앞머리(trademark · patent)
 * visibility(계획 §2-4):
 *   - CHAT_MESSAGE: 그 글의 방이 전사방(COMPANY)이 아니면 [room:<방 id>]
 *   - PHOTO: 사진이 붙은 글의 방, 같은 규칙. 글이 없으면(업무 첨부 등) 빈 배열
 *   - IP_CASE: [group:ip]
 *   - 업무 · 지식 카드 · 주간보고: 빈 배열(전사 공개)
 * 계획: mydocs/plans/2026-11-27-ontology-phase1.md §6-3
 */
import "dotenv/config"
import { prisma } from "@/lib/db"

const APPLY = process.argv.includes("--apply")
const PROD_OK = process.argv.includes("--prod")

const host = /@([^/:?]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "(알 수 없음)"
const prod = host.endsWith("neon.tech")

/** 각 줄: 무엇을 · 바꿀 행을 고르는 WHERE · SET */
const STEPS: { name: string; sql: string }[] = [
  {
    name: "typeKey — 원천별 고정값",
    sql: `UPDATE "EmbeddingChunk" SET "typeKey" = CASE "source"
            WHEN 'OMNIS_CARD' THEN 'card' WHEN 'TASK' THEN 'task' WHEN 'WEEKLY_REPORT' THEN 'weekly_report'
            WHEN 'CHAT_MESSAGE' THEN 'chat_message' WHEN 'PHOTO' THEN 'photo' END
          WHERE "source" IN ('OMNIS_CARD', 'TASK', 'WEEKLY_REPORT', 'CHAT_MESSAGE', 'PHOTO')
            AND "typeKey" IS DISTINCT FROM (CASE "source"
            WHEN 'OMNIS_CARD' THEN 'card' WHEN 'TASK' THEN 'task' WHEN 'WEEKLY_REPORT' THEN 'weekly_report'
            WHEN 'CHAT_MESSAGE' THEN 'chat_message' WHEN 'PHOTO' THEN 'photo' END)`,
  },
  {
    name: "typeKey — 지식재산권(sourceId 앞머리)",
    sql: `UPDATE "EmbeddingChunk" SET "typeKey" = split_part("sourceId", ':', 1)
          WHERE "source" = 'IP_CASE' AND split_part("sourceId", ':', 1) IN ('trademark', 'patent')
            AND "typeKey" IS DISTINCT FROM split_part("sourceId", ':', 1)`,
  },
  {
    name: "visibility — 지식재산권 [group:ip]",
    sql: `UPDATE "EmbeddingChunk" SET "visibility" = ARRAY['group:ip']::text[]
          WHERE "source" = 'IP_CASE' AND "visibility" IS DISTINCT FROM ARRAY['group:ip']::text[]`,
  },
  {
    name: "visibility — 채팅 글(전사방 밖이면 room:<id>)",
    sql: `UPDATE "EmbeddingChunk" e SET "visibility" = v.vis
          FROM (SELECT m."id", CASE WHEN r."kind" = 'COMPANY' THEN ARRAY[]::text[] ELSE ARRAY['room:' || r."id"]::text[] END AS vis
                  FROM "ChatMessage" m JOIN "ChatRoom" r ON r."id" = m."roomId") v
          WHERE e."source" = 'CHAT_MESSAGE' AND e."sourceId" = v."id" AND e."visibility" IS DISTINCT FROM v.vis`,
  },
  {
    name: "visibility — 사진(붙은 글의 방)",
    sql: `UPDATE "EmbeddingChunk" e SET "visibility" = v.vis
          FROM (SELECT f."id", CASE WHEN r."kind" = 'COMPANY' THEN ARRAY[]::text[] ELSE ARRAY['room:' || r."id"]::text[] END AS vis
                  FROM "File" f JOIN "ChatMessage" m ON m."id" = f."messageId" JOIN "ChatRoom" r ON r."id" = m."roomId") v
          WHERE e."source" = 'PHOTO' AND e."sourceId" = v."id" AND e."visibility" IS DISTINCT FROM v.vis`,
  },
]

async function main() {
  console.log(`대상 DB: ${host}${prod ? " (운영)" : ""} · ${APPLY ? "쓰기" : "건식"}`)
  if (APPLY && prod && !PROD_OK) {
    console.error("운영(Neon)이다. 작업지시자 승인 뒤 --prod 를 함께 줘야 쓴다. 중단.")
    process.exit(1)
  }
  // 건식도 같은 문장을 트랜잭션 안에서 돌리고 되돌린다 — 센 건수와 쓰는 건수가 어긋나지 않게
  let total = 0
  const ROLLBACK = new Error("건식 — 되돌린다")
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'")
        for (const s of STEPS) {
          const n = await tx.$executeRawUnsafe(s.sql)
          total += n
          console.log(`  ${s.name}: ${n}건`)
        }
        if (!APPLY) throw ROLLBACK
      },
      { timeout: 120_000, maxWait: 10_000 }
    )
  } catch (e) {
    if (e !== ROLLBACK) throw e
  }
  console.log(`${APPLY ? "썼다" : "건식 — 쓰지 않았다"} · 합계 ${total}건`)
  const after = await prisma.$queryRawUnsafe<{ source: string; n: number; typed: number; scoped: number }[]>(
    `SELECT "source"::text AS source, count(*)::int n, count("typeKey")::int typed, count(*) FILTER (WHERE cardinality("visibility") > 0)::int scoped
       FROM "EmbeddingChunk" GROUP BY 1 ORDER BY 1`
  )
  for (const r of after) console.log(`  ${r.source}: ${r.n} · typeKey ${r.typed} · 범위 있음 ${r.scoped}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

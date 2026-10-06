import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

/** 한 번에 내려보내는 결과 수. 더 있으면 마지막 결과 시각을 before 로 다시 부른다 */
const PAGE = 20
/** 걸린 자리 앞뒤로 보여 줄 글자 수 */
const SNIPPET_PAD = 40

/**
 * 채팅 글자 포함 검색 (2026-10-06, mydocs/plans/archives/2026-10-06-chat-search.md).
 *
 * 의미 검색이 아니라 본문에 입력한 글자가 들어 있는지만 본다. 한국어는 `to_tsvector('simple')` 이
 * 어절째로 잘라 「견적」 으로 「견적서」 를 못 찾는다 — ILIKE 가 기대와 맞는다.
 * 지운 글 · 업무 카드 · 🤖 시스템 글은 빼고 사람이 쓴 NORMAL 글만 찾는다.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const roomId = searchParams.get("roomId")
  const q = (searchParams.get("q") ?? "").trim()
  const taskId = searchParams.get("taskId")
  const before = searchParams.get("before")
  // 보낸 사람으로 찾기 — 검색어 없이도 된다. 함께 주면 둘 다 맞는 글
  const authorId = searchParams.get("authorId")
  if (!roomId) return NextResponse.json({ error: "roomId 필수" }, { status: 400 })
  if (q.length < 2 && !authorId) return NextResponse.json({ results: [], hasMore: false, total: 0 })
  const text = q.length >= 2 ? q : null

  const startedAt = Date.now()
  // 시스템 표식은 코드에서 거른다 — Prisma 의 startsWith: "__" 는 LIKE '__%' 가 되어 두 글자 이상인 글을 전부 거른다.
  // 그래서 걸러질 몫만큼 넉넉히 가져와 PAGE 를 채운다
  const rows = await prisma.chatMessage.findMany({
    where: {
      roomId,
      ...(taskId ? { taskId } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      kind: "NORMAL",
      deletedAt: null,
      ...(authorId ? { authorId } : {}),
      // Prisma 의 contains 는 % · _ 를 이스케이프하지 않는다 — 「__」 가 두 글자 이상인 글 전부에 걸렸다
      ...(text ? { content: { contains: escapeLike(text), mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE * 2 + 1,
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
    },
  })

  // 「3/120」 의 120 — 첫 페이지에서만 센다. 시스템 표식 거르기를 SQL 로 같이 하려고 raw 로 센다
  // (left() 는 LIKE 와일드카드 함정이 없다. Postgres 의 left 는 글자 단위라 🤖 는 left(content, 1)).
  // 조건은 null 이면 꺼지는 고정 SQL 한 벌 — Prisma.sql 조각을 끼워 넣으면 next dev 번들에서 조각이 값으로 바인딩돼 문법 오류가 났다
  const pattern = text ? `%${escapeLike(text)}%` : null
  const total = before
    ? null
    : Number(
        (
          await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM "ChatMessage"
            WHERE "roomId" = ${roomId}
              AND kind = 'NORMAL' AND "deletedAt" IS NULL
              AND left(content, 2) <> '__' AND left(content, 1) <> '🤖'
              AND (${taskId}::text IS NULL OR "taskId" = ${taskId})
              AND (${authorId}::text IS NULL OR "authorId" = ${authorId})
              AND (${pattern}::text IS NULL OR content ILIKE ${pattern})`
        )[0]?.n ?? 0,
      )

  const visible = rows.filter((r) => !r.content.startsWith("__") && !r.content.startsWith("🤖"))
  const page = visible.slice(0, PAGE)
  const hasMore = visible.length > PAGE || rows.length === PAGE * 2 + 1

  return NextResponse.json({
    results: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      author: r.author,
      task: r.task,
      snippet: snippetAround(r.content, text ?? ""),
    })),
    hasMore,
    total,
    // 다음 페이지 커서. 보이는 글이 넘쳤으면 보여 준 마지막 글, 아니면(걸러진 글로 rows 만 찼으면) 가져온 마지막 행
    nextBefore: hasMore ? ((visible.length > PAGE ? page.at(-1) : rows.at(-1))?.createdAt ?? null) : null,
    elapsedMs: Date.now() - startedAt,
  })
}

/** ILIKE 패턴 안에서 % · _ · \ 를 글자 그대로 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** 걸린 첫 자리 앞뒤 SNIPPET_PAD 자. 줄바꿈은 한 칸으로 */
function snippetAround(content: string, q: string): string {
  const flat = content.replace(/\s+/g, " ").trim()
  const at = flat.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return flat.slice(0, SNIPPET_PAD * 2)
  const from = Math.max(0, at - SNIPPET_PAD)
  const to = Math.min(flat.length, at + q.length + SNIPPET_PAD)
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`
}

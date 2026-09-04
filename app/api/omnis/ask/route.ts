import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { assigneeLabel } from "@/lib/task-assignees"
import { retrieveContext, type EmbeddingSource } from "@/lib/embeddings"
import { stockBalance, quoteTotals, QUOTE_STATUS_LABEL } from "@/lib/crm"
import { answerWithOmnis } from "@/lib/ai"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { listCases, listOpenTurns } from "@/lib/ip-data"

export const runtime = "nodejs"

const SOURCE_LABEL: Record<EmbeddingSource, string> = {
  OMNIS_CARD: "옴니스 카드",
  TASK: "업무",
  WEEKLY_REPORT: "주간보고",
  CHAT_MESSAGE: "채팅",
  IP_CASE: "지식재산권",
}

const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(2, "질문을 2자 이상 입력해 주세요")
    .max(500, "질문이 너무 깁니다 (500자 이내)"),
})

const STATUS_LABEL: Record<string, string> = {
  TODO: "할 일",
  IN_PROGRESS: "진행 중",
  REVIEW: "리뷰",
  DONE: "완료",
}

/**
 * 비보관 업무 전체를 구조화된 텍스트로 만든다.
 * RAG의 top-K 검색만으로는 "지연된 업무 전부"처럼 개수 제한 없는 집계 질문에
 * 누락이 생기므로, 업무 목록은 별도로 전량을 컨텍스트에 제공한다.
 */
async function buildTaskOverview(): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: { archived: false },
    select: {
      name: true,
      status: true,
      deadline: true,
      assignees: { select: { user: { select: { id: true, name: true } } } },
    },
  })
  if (tasks.length === 0) return ""

  const now = Date.now()
  const isOverdue = (t: (typeof tasks)[number]) =>
    t.status !== "DONE" && t.deadline !== null && t.deadline.getTime() < now

  const sorted = [...tasks].sort(
    (a, b) =>
      (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity)
  )
  const overdueCount = tasks.filter(isOverdue).length
  const lines = sorted.map((t) => {
    const dl = t.deadline
      ? ` · 마감 ${t.deadline.toISOString().slice(0, 10)}${isOverdue(t) ? " (지연)" : ""}`
      : ""
    return `- ${t.name} · ${STATUS_LABEL[t.status] ?? t.status}${dl} · 담당 ${assigneeLabel(t.assignees)}`
  })
  return `전체 비보관 업무 ${tasks.length}건 · 지연 ${overdueCount}건\n${lines.join("\n")}`
}

/**
 * 지식재산권 전량을 구조화된 텍스트로 만든다.
 *
 * 업무 목록과 같은 이유다. "등록된 상표 전부", "거절결정 받은 건" 처럼 개수 제한이
 * 없는 질문은 top-K 검색으로는 조용히 몇 건을 빠뜨린다. 상표·특허를 합쳐 27건뿐이라
 * 한 줄 요약을 전량 실어도 컨텍스트가 넘치지 않는다 — 자세한 이력은 검색된 청크가 맡는다.
 */
/**
 * CRM 현황을 통째로 넘긴다.
 *
 * 재고·견적 합계 같은 것은 **계산되는 값**이라 임베딩에 넣으면 안 된다. 입고 한 번에
 * 낡고, 색인을 다시 만들기 전까지 틀린 숫자를 자신 있게 답한다. 그래서 업무·지식재산권과
 * 같은 방식으로 물어볼 때마다 세어서 넘긴다.
 *
 * 자료가 100건 남짓이라 전량을 넣어도 얼마 안 된다. 커지면 그때 줄인다.
 */
async function buildCrmOverview(): Promise<string> {
  const [materials, quotes, samples, orgs] = await Promise.all([
    prisma.crmProduct.findMany({
      where: { isMaterial: true },
      orderBy: { code: "asc" },
      include: { stockMoves: true },
    }),
    prisma.crmQuote.findMany({
      orderBy: { quotedAt: "desc" },
      include: { org: true, items: { include: { product: true } } },
    }),
    prisma.crmSampleRequest.findMany({
      orderBy: { requestedAt: "desc" },
      include: { org: true, product: true },
    }),
    prisma.crmOrg.count(),
  ])
  if (materials.length === 0 && quotes.length === 0 && samples.length === 0) return ""

  const parts: string[] = ["[CRM 현황]"]

  if (materials.length > 0) {
    parts.push(
      "원료 재고 (입고 − 출고로 계산한 현재고)",
      ...materials.map((m) => {
        const { inQty, outQty, balance } = stockBalance(m.stockMoves)
        return `- ${m.name}${m.spec ? ` (${m.spec})` : ""}: 현재고 ${balance}개 (입고 ${inQty} · 출고 ${outQty})`
      })
    )
  }

  if (quotes.length > 0) {
    const totals = quotes.map((q) => quoteTotals(q.items, q.discountAmount, q.vatRate))
    const grand = totals.reduce((a, t) => a + t.total, 0)
    parts.push(
      "",
      `견적 ${quotes.length}건 · 실 합계 ${grand.toLocaleString()}원`,
      ...quotes.map((q, i) => {
        const t = totals[i]
        const items = q.items
          .map((it) => `${it.product.name}${it.product.spec ? `(${it.product.spec})` : ""} ${it.quantity}개`)
          .join(", ")
        return `- ${q.code} ${q.quotedAt.toISOString().slice(0, 10)} ${q.org.name} · ${items} · ${QUOTE_STATUS_LABEL[q.status]} · ${t.total.toLocaleString()}원`
      })
    )
  }

  if (samples.length > 0) {
    const pending = samples.filter((s) => s.status === "PENDING").length
    parts.push(
      "",
      `샘플요청 ${samples.length}건 (미발송 ${pending}건)`,
      ...samples.map(
        (s) =>
          `- ${s.code} ${s.requestedAt.toISOString().slice(0, 10)} ${s.org.name}` +
          `${s.product ? ` · ${s.product.name}` : ""}` +
          `${s.request ? ` · ${s.request}` : ""}` +
          `${s.referral ? ` · 소개: ${s.referral}` : ""}` +
          ` · ${s.status === "SENT" ? "발송완료" : "미발송"}`
      )
    )
  }

  parts.push("", `거래 기관 ${orgs}곳`)
  return parts.join("\n")
}

async function buildIpOverview(): Promise<string> {
  const cases = await listCases()
  if (cases.length === 0) return ""

  const line = (c: (typeof cases)[number]) => {
    const bits = [`${c.id} ${c.name}`, c.status]
    if (c.holder) bits.push(c.holder)
    if (c.appNo) bits.push(`출원 ${c.appNo}`)
    if (c.regNo) bits.push(`등록 ${c.regNo}`)
    if (c.registeredOn) bits.push(`등록일 ${c.registeredOn}`)
    else if (c.filedOn) bits.push(`출원일 ${c.filedOn}`)
    return `- ${bits.join(" · ")}`
  }

  const trademarks = cases.filter((c) => c.kind === "trademark")
  const patents = cases.filter((c) => c.kind === "patent")

  const parts = [
    `상표 ${trademarks.length}건`,
    trademarks.map(line).join("\n"),
    `특허 ${patents.length}건`,
    patents.map(line).join("\n"),
  ]

  // 아직 우리가 처리해야 하는 것 — 기한이 걸린 값이라 따로 뽑아 준다.
  const turns = (await listOpenTurns()).filter((t) => t.nextTurn === "us")
  if (turns.length > 0) {
    const lines = turns.map((t) => {
      const bits = [`${t.entityId} ${t.caseName}`, t.stage]
      if (t.dueOn) bits.push(`기한 ${t.dueOn}`)
      return `- ${bits.join(" · ")}`
    })
    parts.push(`우리 차례로 남은 지식재산권 업무 ${turns.length}건`, lines.join("\n"))
  }

  return parts.join("\n")
}

/** 로그인한 사용자의 최근 질문 내역을 최신순으로 반환한다. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const queries = await prisma.omnisQuery.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  })
  return NextResponse.json(queries)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  if (!process.env.GEMINI_API_KEY) {
    return apiError(503, "AI 기능이 비활성화되어 있습니다")
  }

  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = askSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다", parsed.error.flatten())
  }
  const { question } = parsed.data

  try {
    // 1. Retrieval — 질문과 유사한 사내 지식 청크 검색
    const chunks = await retrieveContext(question, {
      limit: 8,
      minSimilarity: 0.3,
      userId: session.user.id,
    })

    // 2. 현황 요약 — 업무와 지식재산권 전량을 구조화해 컨텍스트로 제공.
    //    top-K 검색만으로는 "지연된 업무 전부", "등록된 상표 전부" 같은 집계
    //    질문에서 조용히 몇 건이 빠진다.
    const [taskOverview, ipOverview, crmOverview] = await Promise.all([
      buildTaskOverview(),
      buildIpOverview(),
      buildCrmOverview(),
    ])
    const overview = [taskOverview, ipOverview, crmOverview].filter(Boolean).join("\n\n")

    // 3. Generation — 검색 결과 + 현황 요약을 근거로 답변 생성
    const answer = await answerWithOmnis(
      question,
      chunks.map((c) => ({
        title: c.title,
        content: c.content,
        sourceLabel: SOURCE_LABEL[c.source],
      })),
      overview,
      session.user.id
    )

    const sources = chunks.map((c) => ({
      id: c.id,
      source: c.source,
      sourceId: c.sourceId,
      title: c.title,
      sourceLabel: SOURCE_LABEL[c.source],
      similarity: Math.round(c.similarity * 100),
    }))

    // 3. 질문 내역 저장
    const saved = await prisma.omnisQuery.create({
      data: { userId: session.user.id, question, answer, sources },
    })
    await writeActivity({
      userId: session.user.id,
      action: "omnis.asked",
      entity: "OMNIS_QUERY",
      entityId: saved.id,
      title: `질문: ${question}`,
    })

    return NextResponse.json({
      id: saved.id,
      question: saved.question,
      answer: saved.answer,
      sources,
      createdAt: saved.createdAt,
    })
  } catch (err) {
    console.error("[omnis/ask] 오류", err)
    return apiError(500, "답변 생성 중 오류가 발생했습니다")
  }
}

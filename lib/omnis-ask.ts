// 옴니스 질문 — 화면(app/api/omnis/ask)과 MCP(omnis-hadd)가 같은 길을 쓴다.
//
// 검색(top-K) + 현황 전량(업무·지식재산권·CRM) + 생성. 라우트에서 그대로 옮겼다(2026-09-07).
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { assigneeLabel } from "@/lib/task-assignees"
import { retrieveContext, retrieveHybrid, type EmbeddingSource, type RetrievedChunk } from "@/lib/embeddings"
import { stockBalance, quoteTotals, QUOTE_STATUS_LABEL } from "@/lib/crm"
import { answerWithOmnis, runGeminiToolLoop, type GeminiFunctionDeclaration, type ToolLoopUsage } from "@/lib/ai"
import { writeActivity } from "@/lib/api"
import { listCases, listOpenTurns } from "@/lib/ip-data"

export const SOURCE_LABEL: Record<EmbeddingSource, string> = {
  OMNIS_CARD: "옴니스 카드",
  TASK: "업무",
  WEEKLY_REPORT: "주간보고",
  CHAT_MESSAGE: "채팅",
  IP_CASE: "지식재산권",
}

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
export async function buildTaskOverview(): Promise<string> {
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
export async function buildCrmOverview(): Promise<string> {
  const [stockItems, quotes, samples, orgs, productions] = await Promise.all([
    prisma.crmProduct.findMany({
      where: { archived: false },
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
    prisma.crmProduction.findMany({
      orderBy: { producedAt: "desc" },
      take: 20,
      include: { product: true, material: true },
    }),
  ])
  const materials = stockItems.filter((p) => p.isMaterial)
  const goods = stockItems.filter((p) => !p.isMaterial)
  if (stockItems.length === 0 && quotes.length === 0 && samples.length === 0) return ""

  const parts: string[] = ["[CRM 현황]"]

  if (materials.length > 0) {
    parts.push(
      "원료 재고 — 그램으로 센다 (입고 − 출고)",
      ...materials.map((m) => {
        const { inQty, outQty, balance } = stockBalance(m.stockMoves)
        return `- ${m.name}: 현재고 ${balance}g (입고 ${inQty}g · 출고 ${outQty}g)`
      })
    )
  }

  const goodsWithStock = goods.filter((g) => g.stockMoves.length > 0)
  if (goodsWithStock.length > 0) {
    parts.push(
      "",
      "완제품 재고 — 개로 센다",
      ...goodsWithStock.map((g) => {
        const { balance } = stockBalance(g.stockMoves)
        return `- ${g.name}${g.spec ? ` (${g.spec})` : ""}: ${balance}개`
      })
    )
  }

  if (productions.length > 0) {
    parts.push(
      "",
      `생산 기록 ${productions.length}건 (최근순)`,
      ...productions.map(
        (p) =>
          `- ${p.code} ${p.producedAt.toISOString().slice(0, 10)} ${p.product.name}` +
          `${p.product.spec ? `(${p.product.spec})` : ""} ${p.quantity}개 · ${p.material.name} ${Number(p.materialGrams)}g 사용`
      )
    )
  }

  // 제품 한 개에 드는 원료량. "몇 개 더 만들 수 있나" 를 물으면 이게 있어야 답한다.
  const recipes = goods.filter((g) => g.volumeMl && g.concentrationPct)
  if (recipes.length > 0) {
    parts.push(
      "",
      "배합 (1wt% 는 1ml 당 0.01g)",
      ...recipes.map((g) => {
        const per = (Number(g.volumeMl) * Number(g.concentrationPct)) / 100
        return `- ${g.name}${g.spec ? ` (${g.spec})` : ""}: ${g.volumeMl}ml · ${g.concentrationPct}wt% → 1개에 ${per}g`
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

export async function buildIpOverview(): Promise<string> {
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


export interface AskSource { id: string; source: EmbeddingSource; sourceId: string; title: string; sourceLabel: string; similarity: number }

export interface AskMeta {
  mode: "route" | "baseline"
  model: string
  /** 모델 호출 횟수 (route 는 2 이상) */
  calls: number
  usage: ToolLoopUsage
  /** 전체 · 모델 호출 합계 · 도구(검색·DB) 합계 */
  ms: { total: number; llm: number; tools: number }
  trace: { step: number; tool: string; args: Record<string, unknown>; resultChars: number; ms: number }[]
}

export interface AskResult {
  id: string
  question: string
  answer: string
  sources: AskSource[]
  createdAt: Date
  /** 비용·시간 관찰용. 화면은 안 쓰고 e2e·벤치가 읽는다 */
  meta: AskMeta
}

/** 어느 길로 답할지. 기본은 도구 라우팅. 되돌릴 일이 있으면 OMNIS_ASK_MODE=baseline */
export function askMode(): "route" | "baseline" {
  return process.env.OMNIS_ASK_MODE === "baseline" ? "baseline" : "route"
}

export interface RouteOptions {
  model?: string
  thinking?: { budget?: number; level?: "minimal" | "low" | "medium" | "high" }
  /** 기록(OmnisQuery·활동) 없이 답만 — 벤치용 */
  dryRun?: boolean
}

/** 질문 한 번 — 검색·생성·기록까지. 실패는 그대로 던진다(호출자가 응답 형식을 정한다). */
export async function askOmnis(question: string, userId: string): Promise<AskResult> {
  if (askMode() === "route") return askOmnisRoute(question, userId)
  return askOmnisBaseline(question, userId)
}

const ROUTE_TOOL_EXCLUDE = new Set(["ask_omnis", "post_message", "create_task", "search_knowledge"])

function routeSystemPrompt(today: string, userName: string): string {
  return `당신은 HADD Science 의 사내 지식 비서 "옴니스" 입니다. 오늘은 ${today} 이고, 질문한 사람은 ${userName} 입니다.
직원의 질문에 답하려면 도구를 골라 부르세요. 한 번에 여러 도구를 불러도 됩니다. 최대 5번까지 부를 수 있습니다.

도구 고르는 법:
- 대화 내용·진행 상황·"누가 뭐라고 했나" 는 search_knowledge 로 찾으세요. 사람 이름·기관명·제품명처럼 고유명사가 있으면 그것을 query 에 넣으세요.
- 업무 목록·마감·지연·담당자는 list_tasks (지연 업무는 overdue=true, 내 업무는 mine=true), 한 업무의 체크리스트·최근 대화는 get_task.
- 재고·견적·샘플·거래 기관은 crm_overview 또는 find_org, 상표·특허는 ip_overview, 정리된 지식은 list_omnis_cards → get_omnis_card.
- 첫 도구 결과로 충분하면 바로 답하세요. 부족할 때만 더 부르세요.

답변 규칙:
- 도구 결과에 있는 내용만으로 답하세요. 결과에 없으면 추측하지 말고 "관련 내용을 찾지 못했습니다" 라고 답하세요.
- search_knowledge 결과를 근거로 쓰면 문장 끝에 [1], [2] 처럼 그 결과의 번호를 표기하세요. 다른 도구 결과는 번호 없이 씁니다.
- 건수·금액·재고는 도구 결과의 값을 그대로 쓰세요. "전부" 를 물으면 하나도 빠뜨리지 말고 나열하세요.
- 한국어로 간결하게. 항목이 여러 개면 마크다운 목록이나 표를 쓰세요.`
}

/**
 * 도구 라우팅 — 모델이 필요한 자료만 도구로 꺼내 답한다.
 * 검색(search_knowledge)은 여기서 직접 처리한다: 출처 목록에 청크 메타가 필요해서다.
 * 나머지 도구는 MCP 서버(lib/omnis-mcp)의 runTool 을 그대로 쓴다 — 화면과 MCP 가 같은 길.
 */
export async function askOmnisRoute(question: string, userId: string, opts: RouteOptions = {}): Promise<AskResult> {
  const t0 = performance.now()
  const { OMNIS_TOOLS, runTool } = await import("@/lib/omnis-mcp")
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } })
  if (!user) throw new Error("사용자를 찾지 못했습니다")
  const caller = { userId, name: user.name, role: user.role === "ADMIN" ? ("ADMIN" as const) : ("MEMBER" as const), ip: null }
  const model = opts.model ?? process.env.OMNIS_ASK_MODEL ?? "gemini-3.8-flash"
  const thinking = opts.thinking ?? (model.startsWith("gemini-2.5") ? { budget: 0 } : { level: "low" as const })

  const tools: GeminiFunctionDeclaration[] = [
    {
      name: "search_knowledge",
      description: "의미 + 키워드 검색. 질문에 가까운 채팅·업무·지식 카드·주간보고·지식재산권 조각을 돌려준다. 대화 내용·진행 상황·결정을 물으면 먼저 쓴다.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "검색어. 고유명사(사람·기관·제품)를 포함한다" },
          sources: { type: "array", items: { type: "string", enum: ["TASK", "CHAT_MESSAGE", "OMNIS_CARD", "WEEKLY_REPORT", "IP_CASE"] }, description: "생략하면 전부" },
          limit: { type: "integer", description: "기본 8, 최대 20" },
        },
        required: ["query"],
      },
    },
    ...OMNIS_TOOLS.filter((t) => !ROUTE_TOOL_EXCLUDE.has(t.name)).map((t) => {
      const schema = t.inputSchema as { type: string; properties?: Record<string, unknown>; required?: string[] }
      const hasProps = schema.properties && Object.keys(schema.properties).length > 0
      return { name: t.name, description: t.description, ...(hasProps ? { parameters: schema } : {}) }
    }),
    { name: "ip_overview", description: "상표·특허 전량 한 줄 요약과 우리 차례로 남은 지식재산권 업무. 상표·특허·출원·등록을 물으면 쓴다." },
  ]

  const found = new Map<string, RetrievedChunk>()
  const runOne = async (call: { name: string; args: Record<string, unknown> }): Promise<string> => {
    if (call.name === "search_knowledge") {
      const q = typeof call.args.query === "string" ? call.args.query : question
      const sources = Array.isArray(call.args.sources)
        ? call.args.sources.filter((s): s is EmbeddingSource => typeof s === "string" && s in SOURCE_LABEL)
        : undefined
      const limit = Math.min(Math.max(Number(call.args.limit) || 8, 1), 20)
      const { chunks } = await retrieveHybrid(q, { limit, sources, userId })
      if (chunks.length === 0) return "비슷한 조각이 없습니다."
      return chunks
        .map((c) => {
          if (!found.has(c.id)) found.set(c.id, c)
          const n = [...found.keys()].indexOf(c.id) + 1
          return `[${n}] ${SOURCE_LABEL[c.source]} · ${c.title}\n${c.content.slice(0, 1500)}`
        })
        .join("\n\n")
    }
    if (call.name === "ip_overview") return (await buildIpOverview()) || "지식재산권 자료가 없습니다."
    const r = await runTool(call.name, call.args, caller)
    return "error" in r ? `오류: ${r.error}` : r.text
  }

  const today = new Date().toISOString().slice(0, 10)
  const loop = await runGeminiToolLoop(routeSystemPrompt(today, user.name), question, tools, runOne, {
    model, thinking, maxSteps: 6, endpoint: "omnisAsk.route", userId,
  })
  const answer = loop.text || (loop.error ? `답을 정리하지 못했습니다 (${loop.error}). 질문을 더 구체적으로 바꿔 주세요.` : "관련 내용을 찾지 못했습니다.")

  const sources: AskSource[] = [...found.values()].map((c) => ({
    id: c.id, source: c.source, sourceId: c.sourceId, title: c.title, sourceLabel: SOURCE_LABEL[c.source], similarity: Math.round(c.similarity * 100),
  }))
  const meta: AskMeta = {
    mode: "route", model, calls: loop.calls, usage: loop.usage,
    ms: { total: Math.round(performance.now() - t0), llm: loop.llmMs, tools: loop.toolMs }, trace: loop.trace,
  }

  if (opts.dryRun) return { id: "", question, answer, sources, createdAt: new Date(), meta }

  const saved = await prisma.omnisQuery.create({ data: { userId, question, answer, sources: sources as unknown as Prisma.InputJsonValue } })
  await writeActivity({ userId, action: "omnis.asked", entity: "OMNIS_QUERY", entityId: saved.id, title: `질문: ${question}` })
  return { id: saved.id, question: saved.question, answer: saved.answer, sources, createdAt: saved.createdAt, meta }
}

/** 이전 방식 — 벡터 top-8 + 업무·지식재산권·CRM 전량 요약. OMNIS_ASK_MODE=baseline 일 때만 */
export async function askOmnisBaseline(question: string, userId: string): Promise<AskResult> {
  const t0 = performance.now()
  // 1. Retrieval — 질문과 유사한 사내 지식 청크 검색
  const chunks = await retrieveContext(question, {
    limit: 8,
    minSimilarity: 0.3,
    userId: userId,
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
    userId
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
    data: { userId: userId, question, answer, sources },
  })
  await writeActivity({
    userId: userId,
    action: "omnis.asked",
    entity: "OMNIS_QUERY",
    entityId: saved.id,
    title: `질문: ${question}`,
  })

  return {
    id: saved.id, question: saved.question, answer: saved.answer, sources, createdAt: saved.createdAt,
    meta: {
      mode: "baseline", model: "gemini-2.5-flash", calls: 1,
      usage: { promptTokens: 0, candidateTokens: 0, thinkingTokens: 0, cachedTokens: 0 },
      ms: { total: Math.round(performance.now() - t0), llm: 0, tools: 0 }, trace: [],
    },
  }
}

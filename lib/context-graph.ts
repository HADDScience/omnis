// Context 그래프 — 지금 DB 에서 파생한다. LLM 호출이 없다(GraphRAG 가 아니다).
//
//   실선 = 외래키. 사실이고 늘 최신이다.
//   점선 = 저장 때 이미 만들어 둔 임베딩 사이의 코사인 유사도. 「의미상 가깝다」 는 추정이다.
//
// 한 번에 전체를 그리지 않고 대상 하나를 가운데 두고 한 단계만 펼친다. 이웃을 누르면 그게 새 가운데가 된다.
// 의미 간선은 조밀하다(업무 이웃 5개 중 0.75 이상이 500/500 — 2026-09-14 실측). 그래서
//   - 채팅 조각은 이웃 후보에서 뺀다. 넣으면 이웃 40개가 전부 채팅이다. 채팅은 업무 옆 패널에 조각으로 보여 준다.
//   - 종류가 다른 대상은 상위 3개, 같은 종류(업무↔업무)는 다른 프로젝트 것만 2개.
// 설계: mydocs/plans/2026-09-14-company-context.md 「1. Context 를 어떻게 보여 줄까」
import { prisma } from "@/lib/db"
import { TASK_STATUS_LABELS } from "@/lib/constants"
import { won } from "@/lib/crm"
import { RECORD_KIND_LABEL, ymd } from "@/lib/company-context"
import type { RecordKind } from "@/generated/prisma/client"
import {
  NODE_TYPE_LABEL,
  type ContextChunk,
  type ContextEdge,
  type ContextNode,
  type ContextNodeType,
  type Neighborhood,
} from "@/lib/context-graph-types"

export * from "@/lib/context-graph-types"

const REL_LIMIT = 20
const MIN_SIMILARITY = 0.7
const CHUNK_CHARS = 1_200

type EmbedSource = "TASK" | "OMNIS_CARD" | "IP_CASE" | "WEEKLY_REPORT"

export function parseNodeKey(key: string): { type: ContextNodeType; id: string } | null {
  const i = key.indexOf(":")
  if (i < 1) return null
  const type = key.slice(0, i) as ContextNodeType
  const id = key.slice(i + 1)
  return type in NODE_TYPE_LABEL && id ? { type, id } : null
}

const node = (type: ContextNodeType, id: string, label: string, sub: string | null, href: string | null): ContextNode => ({
  key: `${type}:${id}`,
  type,
  label,
  sub,
  href,
})

const statusLabel = (s: string) => (TASK_STATUS_LABELS as Record<string, string>)[s] ?? s

const N = {
  task: (t: { id: string; name: string; status: string }) => node("task", t.id, t.name, statusLabel(t.status), `/tasks/${t.id}`),
  project: (p: { id: string; name: string; status: string }) => node("project", p.id, p.name, p.status, "/tasks/projects"),
  user: (u: { id: string; name: string; position: string | null }) => node("user", u.id, u.name, u.position, null),
  product: (p: { id: string; name: string }) => node("product", p.id, p.name, null, null),
  org: (o: { id: string; name: string; code: string }) => node("org", o.id, o.name, o.code, `/crm/orgs/${o.id}`),
  quote: (q: { id: string; code: string; quotedAt: Date }) => node("quote", q.id, q.code, ymd(q.quotedAt), `/crm/quotes/${q.id}`),
  sample: (s: { id: string; code: string; requestedAt: Date }) => node("sample", s.id, s.code, ymd(s.requestedAt), "/crm/samples"),
  invoice: (i: { id: string; issuedOn: Date; supplyKrw: bigint; direction: string }) =>
    node("invoice", i.id, `${i.direction === "SALE" ? "매출" : "매입"} ${ymd(i.issuedOn)}`, won(Number(i.supplyKrw)), "/crm/invoices"),
  record: (r: { id: string; title: string; kind: RecordKind; startsOn: Date | null }) =>
    node(
      "record",
      r.id,
      r.title,
      [RECORD_KIND_LABEL[r.kind], ymd(r.startsOn)].filter(Boolean).join(" · "),
      `/omnis/records?q=${encodeURIComponent(r.title.slice(0, 20))}`
    ),
  card: (c: { id: string; title: string }) => node("card", c.id, c.title, null, `/omnis/${c.id}`),
  report: (r: { id: string; title: string }) => node("report", r.id, r.title, null, `/reports/${r.id}`),
  staff: (s: { id: string; name: string; haddRole: string | null; affiliation: string | null }) =>
    node("staff", s.id, s.name, [s.affiliation, s.haddRole].filter(Boolean).join(" · ") || null, "/omnis/staff"),
}

const userSel = { id: true, name: true, position: true } as const
const taskSel = { id: true, name: true, status: true } as const
const projSel = { id: true, name: true, status: true } as const
const recordSel = { id: true, title: true, kind: true, startsOn: true } as const
const chunkSel = { id: true, source: true, title: true, content: true } as const

function builder(center: ContextNode) {
  const nodes = new Map<string, ContextNode>()
  const edges: ContextEdge[] = []
  const truncated: string[] = []
  return {
    nodes,
    edges,
    truncated,
    /** out = 가운데 → 이웃, in = 이웃 → 가운데 */
    link(n: ContextNode | null | undefined, label: string, dir: "out" | "in" = "out", kind: "fk" | "vector" = "fk") {
      if (!n || n.key === center.key) return
      if (!nodes.has(n.key)) nodes.set(n.key, n)
      const e: ContextEdge = dir === "out" ? { from: center.key, to: n.key, kind, label } : { from: n.key, to: center.key, kind, label }
      if (!edges.some((x) => x.from === e.from && x.to === e.to && x.label === e.label)) edges.push(e)
    },
    more(label: string, total: number, shown: number) {
      if (total > shown) truncated.push(`${label} ${total}건 중 최근 ${shown}건만 그렸다`)
    },
  }
}

const clip = (c: { id: string; source: string; title: string; content: string }): ContextChunk => ({
  ...c,
  content: c.content.length > CHUNK_CHARS ? `${c.content.slice(0, CHUNK_CHARS)}…` : c.content,
})

async function chunksOf(source: EmbedSource, sourceId: string) {
  const rows = await prisma.embeddingChunk.findMany({ where: { source, sourceId }, orderBy: { chunkIndex: "asc" }, select: chunkSel })
  return rows.map(clip)
}

/** 가운데 대상의 임베딩과 가까운 다른 대상 — 점선 간선 */
async function linkVectorNeighbors(
  b: ReturnType<typeof builder>,
  source: EmbedSource,
  sourceId: string,
  opts: { projectId?: string | null } = {}
) {
  const rows = await prisma.$queryRaw<{ source: EmbedSource; sourceId: string; title: string; similarity: number }[]>`
    WITH c AS (
      SELECT "embedding" FROM "EmbeddingChunk"
      WHERE "source" = ${source}::"EmbeddingSource" AND "sourceId" = ${sourceId} AND "embedding" IS NOT NULL
      ORDER BY "chunkIndex" LIMIT 1
    )
    SELECT e."source"::text AS "source", e."sourceId", e."title", 1 - (e."embedding" <=> c."embedding") AS "similarity"
    FROM "EmbeddingChunk" e, c
    WHERE e."embedding" IS NOT NULL
      AND e."source" <> 'CHAT_MESSAGE'
      AND NOT (e."source" = ${source}::"EmbeddingSource" AND e."sourceId" = ${sourceId})
    ORDER BY e."embedding" <=> c."embedding"
    LIMIT 60
  `
  const seen = new Set<string>()
  const close = rows.filter((r) => {
    const k = `${r.source}|${r.sourceId}`
    if (seen.has(k) || Number(r.similarity) < MIN_SIMILARITY) return false
    seen.add(k)
    return true
  })
  const picked = close.filter((r) => r.source !== source).slice(0, 3)

  let same = close.filter((r) => r.source === source)
  if (source === "TASK" && same.length) {
    const tasks = await prisma.task.findMany({ where: { id: { in: same.map((r) => r.sourceId) } }, select: { id: true, projectId: true } })
    const projectOf = new Map(tasks.map((t) => [t.id, t.projectId]))
    same = same.filter((r) => projectOf.has(r.sourceId) && (!opts.projectId || projectOf.get(r.sourceId) !== opts.projectId))
  }
  picked.push(...same.filter((r) => !b.nodes.has(`${typeOf(r.source)}:${r.sourceId}`)).slice(0, 2))

  for (const r of picked) {
    const type = typeOf(r.source)
    const key = `${type}:${r.sourceId}`
    if (b.nodes.has(key)) continue // 이미 실선으로 이어진 대상에 점선을 겹치지 않는다
    const href = type === "task" ? `/tasks/${r.sourceId}` : type === "card" ? `/omnis/${r.sourceId}` : type === "report" ? `/reports/${r.sourceId}` : null
    b.link(node(type, r.sourceId, r.title, `유사도 ${Number(r.similarity).toFixed(2)}`, href), Number(r.similarity).toFixed(2), "out", "vector")
  }
}

function typeOf(source: EmbedSource): ContextNodeType {
  return source === "TASK" ? "task" : source === "OMNIS_CARD" ? "card" : source === "IP_CASE" ? "ip" : "report"
}

function done(center: ContextNode, b: ReturnType<typeof builder>, chunks: ContextChunk[] = [], chunkNote: string | null = null): Neighborhood {
  return { center, nodes: [...b.nodes.values()], edges: b.edges, chunks, chunkNote, truncated: b.truncated }
}

/** 대상 하나를 가운데 두고 한 단계 이웃 · 벡터 조각을 모은다. 없거나 볼 권한이 없으면 null */
export async function loadNeighborhood(key: string, opts: { isAdmin: boolean }): Promise<Neighborhood | null> {
  const parsed = parseNodeKey(key)
  if (!parsed) return null
  const { type, id } = parsed

  switch (type) {
    case "task": {
      const t = await prisma.task.findUnique({
        where: { id },
        select: {
          ...taskSel,
          projectId: true,
          instructor: { select: userSel },
          assignees: { select: { user: { select: userSel } } },
          project: { select: projSel },
          product: { select: { id: true, name: true } },
        },
      })
      if (!t) return null
      const center = N.task(t)
      const b = builder(center)
      b.link(N.user(t.instructor), "지시", "in")
      for (const a of t.assignees) b.link(N.user(a.user), "담당", "in")
      if (t.project) b.link(N.project(t.project), "프로젝트")
      if (t.product) b.link(N.product(t.product), "제품")
      // 채팅 조각은 이 업무 스레드의 메시지만 — 업무를 열 수 있는 사람은 이미 보는 내용이다
      const messageIds = (
        await prisma.chatMessage.findMany({ where: { taskId: id }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 300 })
      ).map((m) => m.id)
      const [own, chat, total] = await Promise.all([
        chunksOf("TASK", id),
        prisma.embeddingChunk.findMany({
          where: { source: "CHAT_MESSAGE", sourceId: { in: messageIds } },
          orderBy: { updatedAt: "desc" },
          take: 12,
          select: chunkSel,
        }),
        prisma.embeddingChunk.count({ where: { source: "CHAT_MESSAGE", sourceId: { in: messageIds } } }),
        linkVectorNeighbors(b, "TASK", id, { projectId: t.projectId }),
      ])
      const note = total > chat.length ? `업무 스레드 채팅 조각 ${total}개 중 최근 ${chat.length}개` : null
      return done(center, b, [...own, ...chat.map(clip)], note)
    }

    case "project": {
      const p = await prisma.project.findUnique({
        where: { id },
        select: {
          ...projSel,
          product: { select: { id: true, name: true } },
          tasks: { select: taskSel, orderBy: { updatedAt: "desc" }, take: REL_LIMIT },
          records: { select: recordSel, orderBy: { startsOn: "desc" }, take: REL_LIMIT },
          _count: { select: { tasks: true, records: true } },
        },
      })
      if (!p) return null
      const center = N.project(p)
      const b = builder(center)
      if (p.product) b.link(N.product(p.product), "제품")
      for (const t of p.tasks) b.link(N.task(t), "프로젝트", "in")
      for (const r of p.records) b.link(N.record(r), "과제", "in")
      b.more("업무", p._count.tasks, p.tasks.length)
      b.more("연혁·실적", p._count.records, p.records.length)
      return done(center, b, [], "프로젝트 자체는 임베딩하지 않는다 — 업무를 누르면 조각이 보인다")
    }

    case "user": {
      const u = await prisma.user.findUnique({
        where: { id },
        select: {
          ...userSel,
          staffProfile: { select: { id: true, name: true, haddRole: true, affiliation: true } },
          instructedTasks: { select: taskSel, orderBy: { updatedAt: "desc" }, take: 10 },
          assignedTasks: { select: { task: { select: taskSel } }, orderBy: { assignedAt: "desc" }, take: 10 },
          _count: { select: { instructedTasks: true, assignedTasks: true } },
        },
      })
      if (!u) return null
      const center = N.user(u)
      const b = builder(center)
      if (opts.isAdmin && u.staffProfile) b.link(N.staff(u.staffProfile), "인력 정보")
      for (const a of u.assignedTasks) b.link(N.task(a.task), "담당")
      for (const t of u.instructedTasks) b.link(N.task(t), "지시")
      b.more("담당 업무", u._count.assignedTasks, u.assignedTasks.length)
      b.more("지시 업무", u._count.instructedTasks, u.instructedTasks.length)
      return done(center, b)
    }

    case "product": {
      const p = await prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          projects: { select: projSel, orderBy: { updatedAt: "desc" }, take: REL_LIMIT },
          tasks: { select: taskSel, orderBy: { updatedAt: "desc" }, take: 10 },
          _count: { select: { projects: true, tasks: true } },
        },
      })
      if (!p) return null
      const center = N.product(p)
      const b = builder(center)
      for (const x of p.projects) b.link(N.project(x), "제품", "in")
      for (const t of p.tasks) b.link(N.task(t), "제품", "in")
      b.more("프로젝트", p._count.projects, p.projects.length)
      b.more("업무", p._count.tasks, p.tasks.length)
      return done(center, b)
    }

    case "org": {
      const o = await prisma.crmOrg.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          code: true,
          quotes: { select: { id: true, code: true, quotedAt: true }, orderBy: { quotedAt: "desc" }, take: REL_LIMIT },
          sampleRequests: { select: { id: true, code: true, requestedAt: true }, orderBy: { requestedAt: "desc" }, take: REL_LIMIT },
          taxInvoices: { select: { id: true, issuedOn: true, supplyKrw: true, direction: true }, orderBy: { issuedOn: "desc" }, take: REL_LIMIT },
          _count: { select: { quotes: true, sampleRequests: true, taxInvoices: true } },
        },
      })
      if (!o) return null
      const center = N.org(o)
      const b = builder(center)
      for (const q of o.quotes) b.link(N.quote(q), "견적", "in")
      for (const s of o.sampleRequests) b.link(N.sample(s), "샘플요청", "in")
      for (const i of o.taxInvoices) b.link(N.invoice(i), "세금계산서", "in")
      b.more("견적", o._count.quotes, o.quotes.length)
      b.more("샘플요청", o._count.sampleRequests, o.sampleRequests.length)
      b.more("세금계산서", o._count.taxInvoices, o.taxInvoices.length)
      return done(center, b)
    }

    case "quote": {
      const q = await prisma.crmQuote.findUnique({
        where: { id },
        select: {
          id: true,
          code: true,
          quotedAt: true,
          org: { select: { id: true, name: true, code: true } },
          taxInvoices: { select: { id: true, issuedOn: true, supplyKrw: true, direction: true } },
        },
      })
      if (!q) return null
      const center = N.quote(q)
      const b = builder(center)
      b.link(N.org(q.org), "견적")
      for (const i of q.taxInvoices) b.link(N.invoice(i), "견적", "in")
      return done(center, b)
    }

    case "sample": {
      const s = await prisma.crmSampleRequest.findUnique({
        where: { id },
        select: { id: true, code: true, requestedAt: true, org: { select: { id: true, name: true, code: true } } },
      })
      if (!s) return null
      const center = N.sample(s)
      const b = builder(center)
      b.link(N.org(s.org), "샘플요청")
      return done(center, b)
    }

    case "invoice": {
      const i = await prisma.taxInvoice.findUnique({
        where: { id },
        select: {
          id: true,
          issuedOn: true,
          supplyKrw: true,
          direction: true,
          org: { select: { id: true, name: true, code: true } },
          quote: { select: { id: true, code: true, quotedAt: true } },
        },
      })
      if (!i) return null
      const center = N.invoice(i)
      const b = builder(center)
      if (i.org) b.link(N.org(i.org), "세금계산서")
      if (i.quote) b.link(N.quote(i.quote), "견적")
      return done(center, b)
    }

    case "record": {
      const r = await prisma.companyRecord.findUnique({ where: { id }, select: { ...recordSel, project: { select: projSel } } })
      if (!r) return null
      const center = N.record(r)
      const b = builder(center)
      if (r.project) b.link(N.project(r.project), "과제")
      return done(center, b)
    }

    case "card": {
      const c = await prisma.omnisCard.findUnique({ where: { id }, select: { id: true, title: true, updatedBy: { select: userSel } } })
      if (!c) return null
      const center = N.card(c)
      const b = builder(center)
      if (c.updatedBy) b.link(N.user(c.updatedBy), "수정", "in")
      const [chunks] = await Promise.all([chunksOf("OMNIS_CARD", id), linkVectorNeighbors(b, "OMNIS_CARD", id)])
      return done(center, b, chunks)
    }

    case "ip": {
      const chunks = await chunksOf("IP_CASE", id)
      if (chunks.length === 0) return null
      const center = node("ip", id, chunks[0].title, id.startsWith("patent:") ? "특허" : "상표", null)
      const b = builder(center)
      await linkVectorNeighbors(b, "IP_CASE", id)
      return done(center, b, chunks, "지식재산권은 옴니스 DB 가 아니라 IP 데이터에서 온다 — 외래키 연결이 없어 점선만 있다")
    }

    case "report": {
      const r = await prisma.weeklyReport.findUnique({ where: { id }, select: { id: true, title: true, owner: { select: userSel } } })
      if (!r) return null
      const center = N.report(r)
      const b = builder(center)
      b.link(N.user(r.owner), "작성", "in")
      const [chunks] = await Promise.all([chunksOf("WEEKLY_REPORT", id), linkVectorNeighbors(b, "WEEKLY_REPORT", id)])
      return done(center, b, chunks)
    }

    case "staff": {
      if (!opts.isAdmin) return null
      const s = await prisma.staffProfile.findUnique({
        where: { id },
        select: { id: true, name: true, haddRole: true, affiliation: true, user: { select: userSel } },
      })
      if (!s) return null
      const center = N.staff(s)
      const b = builder(center)
      if (s.user) b.link(N.user(s.user), "인력 정보", "in")
      return done(center, b, [], "인력 정보는 임베딩하지 않는다 — 개인정보라 AI 검색에 넣지 않는다")
    }
  }
}

/** 이름 · 제목으로 가운데에 둘 대상을 찾는다. 빈 검색어면 최근 것을 제안한다 */
export async function searchContext(q: string): Promise<ContextNode[]> {
  const s = q.trim().slice(0, 100)
  if (!s) {
    const [projects, tasks, orgs] = await Promise.all([
      prisma.project.findMany({ where: { archived: false }, select: projSel, orderBy: { updatedAt: "desc" }, take: 6 }),
      prisma.task.findMany({ select: taskSel, orderBy: { updatedAt: "desc" }, take: 6 }),
      prisma.crmOrg.findMany({ where: { taxInvoices: { some: {} } }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" }, take: 6 }),
    ])
    return [...projects.map(N.project), ...tasks.map(N.task), ...orgs.map(N.org)]
  }
  const c = { contains: s, mode: "insensitive" as const }
  const [tasks, projects, users, orgs, cards, records, products, quotes, ips] = await Promise.all([
    prisma.task.findMany({ where: { name: c }, select: taskSel, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.project.findMany({ where: { name: c }, select: projSel, orderBy: { updatedAt: "desc" }, take: 5 }),
    prisma.user.findMany({ where: { name: c }, select: userSel, take: 5 }),
    prisma.crmOrg.findMany({ where: { name: c }, select: { id: true, name: true, code: true }, take: 5 }),
    prisma.omnisCard.findMany({ where: { title: c }, select: { id: true, title: true }, take: 5 }),
    prisma.companyRecord.findMany({ where: { title: c }, select: recordSel, orderBy: { startsOn: "desc" }, take: 5 }),
    prisma.product.findMany({ where: { name: c }, select: { id: true, name: true }, take: 3 }),
    prisma.crmQuote.findMany({ where: { code: c }, select: { id: true, code: true, quotedAt: true }, take: 3 }),
    prisma.embeddingChunk.findMany({ where: { source: "IP_CASE", title: c, chunkIndex: 0 }, select: { sourceId: true, title: true }, take: 5 }),
  ])
  return [
    ...projects.map(N.project),
    ...tasks.map(N.task),
    ...users.map(N.user),
    ...orgs.map(N.org),
    ...products.map(N.product),
    ...cards.map(N.card),
    ...records.map(N.record),
    ...quotes.map(N.quote),
    ...ips.map((x) => node("ip", x.sourceId, x.title, x.sourceId.startsWith("patent:") ? "특허" : "상표", null)),
  ]
}

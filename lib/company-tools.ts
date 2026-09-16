// 회사 Context 를 옴니스 질문 · MCP 도구로 연다 (lib/omnis-mcp 의 runTool 이 부른다).
//
// 개인정보는 도구로 내보내지 않는다 — 연락처 · 이메일 · 생년월일 · 과학기술인번호 · 서명 · 직인.
// 이것들은 인력 화면(관리자)에서만 본다. 도구 결과는 모델 공급자와 외부 MCP 커넥터로 나가기 때문이다.
// 설계: mydocs/plans/2026-09-14-company-context.md 「구현 순서 6」
import { prisma } from "@/lib/db"
import { BASIS_LABEL, RECORD_KIND_LABEL, invoiceRevenue, periodText, ymd } from "@/lib/company-context"
import { loadNeighborhood, searchContext, NODE_TYPE_LABEL, type ContextNode } from "@/lib/context-graph"
import { CompanyRecordSchema } from "@/lib/schemas/company"
import { recordData, recordDedupeKey } from "@/lib/company-edit"
import { writeActivity } from "@/lib/api"
import type { Prisma, RecordKind } from "@/generated/prisma/client"

const money = (v: bigint | number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("ko-KR")}원`)
const RECORD_KINDS = Object.keys(RECORD_KIND_LABEL) as RecordKind[]

export async function companyProfileText(): Promise<string> {
  const [p, years] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { id: "hadd" } }),
    prisma.companyYear.findMany({ orderBy: [{ year: "desc" }, { basis: "asc" }] }),
  ])
  const out: string[] = []
  if (p) {
    out.push(
      "# 회사 기본정보",
      `- 상호: ${p.nameKo}${p.nameEn ? ` (${p.nameEn})` : ""}`,
      `- 사업자등록번호: ${p.bizRegNo ?? "—"}`,
      `- 사업자 형태: ${p.bizType ?? "—"}`,
      `- 업종: ${[p.industry, p.industryCode && `(${p.industryCode})`].filter(Boolean).join(" ") || "—"}`,
      `- 설립일: ${ymd(p.foundedOn) ?? "—"}`,
      `- 홈페이지: ${p.homepage ?? "—"}`,
      `- 본사: ${p.hqAddress ?? "—"}`,
      `- 연구소: ${p.labAddress ?? "—"}`,
      `- 연구협력기관: ${p.partnerAddress ?? "—"}`,
      `- 기준일: ${ymd(p.asOfDate) ?? "—"}`,
      ""
    )
  } else out.push("회사 기본정보가 아직 없습니다.", "")

  out.push("# 연도별 재무 — 매출은 공급가액(부가세 제외). 확정 = 결산서 · 잠정 = 결산 전 세금계산서 합 · 계획 = 예상·추정. 단계가 다른 숫자를 더하지 말 것")
  const confirmed = new Set(years.filter((y) => y.basis === "CONFIRMED").map((y) => y.year))
  for (const y of years) {
    const bits = [
      `매출 ${money(y.revenueKrw)}`,
      y.revenueProductKrw !== null || y.revenueServiceKrw !== null ? `제품 ${money(y.revenueProductKrw)} · 용역 ${money(y.revenueServiceKrw)}` : null,
      y.assetsKrw !== null ? `자산 ${money(y.assetsKrw)} · 부채 ${money(y.liabilitiesKrw)} · 자본 ${money(y.equityKrw)}` : null,
      y.netIncomeKrw !== null ? `순이익 ${money(y.netIncomeKrw)}` : null,
      y.headcount !== null ? `상시근로자 ${y.headcount}명` : null,
      y.accountLabel ? `결산서 매출 계정 ${y.accountLabel}` : null,
      y.note ? `비고: ${y.note}` : null,
    ].filter(Boolean)
    out.push(`- ${y.year} ${BASIS_LABEL[y.basis]} · ${bits.join(" · ")}`)
  }
  const thisYear = new Date().getUTCFullYear()
  for (const year of [thisYear, thisYear - 1].filter((x) => !confirmed.has(x))) {
    const r = await invoiceRevenue(year)
    if (r.invoices > 0) {
      out.push(`- ${year} 잠정 · 매출 ${money(r.total)} · 제품 ${money(r.product)} · 용역 ${money(r.service)} · 세금계산서 ${r.invoices}장, ${ymd(r.lastIssuedOn)} 발행분까지 · 결산 전`)
    }
  }
  return out.join("\n")
}

export async function companyRecordsText(args: Record<string, unknown>): Promise<string> {
  const q = typeof args.query === "string" ? args.query.trim() : ""
  const kind = RECORD_KINDS.includes(args.kind as RecordKind) ? (args.kind as RecordKind) : null
  const year = Number.isInteger(Number(args.year)) && Number(args.year) > 1990 ? Number(args.year) : null
  const where: Prisma.CompanyRecordWhereInput = {
    ...(kind ? { kind } : {}),
    ...(year ? { startsOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { organizer: { contains: q, mode: "insensitive" } },
            { subject: { contains: q, mode: "insensitive" } },
            { partner: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.companyRecord.findMany({ where, orderBy: [{ startsOn: { sort: "desc", nulls: "last" } }], take: 80 }),
    prisma.companyRecord.count({ where }),
  ])
  if (rows.length === 0) return "조건에 맞는 연혁·실적이 없습니다."
  const lines = rows.map((r) => {
    const bits = [
      periodText(r),
      `[${RECORD_KIND_LABEL[r.kind]}] ${r.title}`,
      r.organizer,
      r.status,
      r.role && `역할 ${r.role}`,
      r.prize,
      r.subject && `과제 ${r.subject}`,
      r.fundingKrw !== null && Number(r.fundingKrw) > 0 ? `지원금 ${money(r.fundingKrw)}` : null,
      r.ownCashKrw !== null && Number(r.ownCashKrw) > 0 ? `자부담 현금 ${money(r.ownCashKrw)}` : null,
      r.ownInKindKrw !== null && Number(r.ownInKindKrw) > 0 ? `자부담 현물 ${money(r.ownInKindKrw)}` : null,
      r.grantNo && `과제번호 ${r.grantNo}`,
      r.venue,
      r.partner && `대리점 ${r.partner}`,
    ].filter(Boolean)
    // id 를 함께 준다 — 이게 없으면 고칠 줄을 get_context 로 한 건씩 캐야 한다(2026-09-16)
    return `- ${bits.join(" · ")} · id ${r.id}`
  })
  return [`연혁·실적 ${rows.length}건${total > rows.length ? ` (전체 ${total}건 중 최근 ${rows.length}건 — 조건을 좁혀 다시 부르세요)` : ""}`, ...lines].join("\n")
}

export async function taxInvoicesText(args: Record<string, unknown>): Promise<string> {
  const year = Number.isInteger(Number(args.year)) && Number(args.year) > 1990 ? Number(args.year) : null
  const org = typeof args.org === "string" ? args.org.trim() : ""
  const rows = await prisma.taxInvoice.findMany({
    where: {
      ...(year ? { issuedOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}),
      ...(org
        ? {
            OR: [
              { org: { name: { contains: org, mode: "insensitive" } } },
              { buyerName: { contains: org, mode: "insensitive" } },
              { supplierName: { contains: org, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { issuedOn: "desc" },
    include: { items: { orderBy: { lineNo: "asc" } }, org: { select: { name: true } }, quote: { select: { code: true } } },
    take: 100,
  })
  if (rows.length === 0) return "조건에 맞는 세금계산서가 없습니다."
  const sums = new Map<string, { product: number; service: number; n: number }>()
  const lines = rows.map((i) => {
    const y = String(i.issuedOn.getUTCFullYear())
    if (i.direction === "SALE") {
      const s = sums.get(y) ?? { product: 0, service: 0, n: 0 }
      s.n++
      for (const it of i.items) {
        if (it.category === "용역") s.service += Number(it.supplyKrw)
        else s.product += Number(it.supplyKrw)
      }
      sums.set(y, s)
    }
    return `- ${ymd(i.issuedOn)} ${i.direction === "SALE" ? "매출" : "매입"}${i.kind === "수정" ? "(수정)" : ""} · ${i.org?.name ?? (i.direction === "SALE" ? i.buyerName : i.supplierName)} · 공급가액 ${money(i.supplyKrw)} · 합계 ${money(i.totalKrw)} · ${i.items.map((it) => `${it.name}(${it.category})`).join(", ")}${i.quote ? ` · 견적 ${i.quote.code}` : ""}`
  })
  const summary = [...sums.entries()].map(([y, s]) => `- ${y} 매출 ${s.n}장 · 공급가액 합 ${money(s.product + s.service)} (제품 ${money(s.product)} · 용역 ${money(s.service)})`)
  return [`세금계산서 ${rows.length}장 — 매출 합은 공급가액(부가세 제외)이며 결산 매출과 몇천 원 다를 수 있다`, ...summary, "", ...lines].join("\n")
}

export async function staffText(): Promise<string> {
  const rows = await prisma.staffProfile.findMany({
    orderBy: [{ employment: "asc" }, { name: "asc" }],
    select: { name: true, affiliation: true, position: true, haddRole: true, employment: true, insured: true, duties: true, education: true, major: true, joinedOn: true },
  })
  const employed = rows.filter((r) => r.employment === "EMPLOYED")
  const former = rows.filter((r) => r.employment === "FORMER")
  if (employed.length === 0) return "인력 정보가 없습니다."
  return [
    `재직 ${employed.length}명 · 하드사이언스 4대보험 가입 ${employed.filter((r) => r.insured).length}명. 연락처·생년월일·과학기술인번호·서명은 도구로 주지 않는다 — 관리자가 HADD DB 인력 화면에서 본다`,
    ...employed.map((r) =>
      `- ${[
        r.name,
        r.affiliation,
        r.position,
        r.haddRole && `하드사이언스 ${r.haddRole}`,
        r.insured ? "4대보험 가입" : "4대보험 미가입(겸직·외부 소속)",
        r.duties && `담당 ${r.duties}`,
        [r.education, r.major].filter(Boolean).join(" · ") || null,
        r.joinedOn && `입사 ${ymd(r.joinedOn)}`,
      ]
        .filter(Boolean)
        .join(" · ")}`
    ),
    former.length ? `비재직 ${former.length}명: ${former.map((r) => `${r.name}(${r.affiliation ?? "소속 미상"})`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export async function marketCompaniesText(args: Record<string, unknown>): Promise<string> {
  const q = typeof args.query === "string" ? args.query.trim() : ""
  const segment = typeof args.segment === "string" ? args.segment.trim() : ""
  const rows = await prisma.marketCompany.findMany({
    where: {
      ...(segment ? { segment: { contains: segment, mode: "insensitive" } } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { products: { contains: q, mode: "insensitive" } }, { country: { contains: q } }] }
        : {}),
    },
    orderBy: [{ segment: "asc" }, { name: "asc" }],
  })
  if (rows.length === 0) return "조건에 맞는 시장기업이 없습니다."
  return [
    `시장기업 ${rows.length}곳 — 매출·자본금·업력은 조사 원문 그대로다`,
    ...rows.map((c) =>
      `- ${[c.name, c.country, c.segment, c.products && `주력 ${c.products}`, c.ceo && `대표 ${c.ceo}`, c.foundedRaw && `설립 ${c.foundedRaw}`, c.revenueRaw && `매출 ${c.revenueRaw}`, c.animalAlternative ? "동물대체시험법" : null, c.homepage]
        .filter(Boolean)
        .join(" · ")}`
    ),
  ].join("\n")
}

const nodeLine = (n: ContextNode) => `${NODE_TYPE_LABEL[n.type]} ${n.label}${n.sub ? ` (${n.sub})` : ""} · key ${n.key}`

export async function contextText(args: Record<string, unknown>, isAdmin: boolean): Promise<{ text: string } | { error: string }> {
  let key = typeof args.node === "string" ? args.node.trim() : ""
  const q = typeof args.query === "string" ? args.query.trim() : ""
  let others: ContextNode[] = []
  if (!key) {
    if (!q) return { error: "node 또는 query 를 주세요." }
    const hits = await searchContext(q)
    if (hits.length === 0) return { text: `'${q}' 에 맞는 대상이 없습니다. search_knowledge 로 내용을 찾아보세요.` }
    const exact = hits.find((h) => h.label === q)
    key = (exact ?? hits[0]).key
    others = hits.filter((h) => h.key !== key).slice(0, 8)
  }
  const d = await loadNeighborhood(key, { isAdmin })
  if (!d) return { error: `'${key}' 대상을 찾을 수 없거나 볼 수 없습니다.` }
  const peer = (e: { from: string; to: string }) => d.nodes.find((n) => n.key === (e.from === d.center.key ? e.to : e.from))
  const fk = d.edges.filter((e) => e.kind === "fk")
  const vec = d.edges.filter((e) => e.kind === "vector")
  return {
    text: [
      `# ${nodeLine(d.center)}`,
      `DB 로 이어진 것 ${fk.length}:`,
      ...fk.map((e) => {
        const n = peer(e)
        return n ? `- [${e.label}] ${nodeLine(n)}` : null
      }).filter(Boolean),
      ...d.truncated.map((t) => `(${t})`),
      vec.length ? `의미상 가까운 것 ${vec.length} (임베딩 유사도 — 추정이지 사실이 아니다):` : "",
      ...vec.map((e) => {
        const n = peer(e)
        return n ? `- ${nodeLine(n)}` : null
      }).filter(Boolean),
      others.length ? `\n이름이 비슷한 다른 후보 (필요하면 node 로 다시 부르세요):\n${others.map((n) => `- ${nodeLine(n)}`).join("\n")}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  }
}

/**
 * 연혁 한 줄 남기기 · 고치기 (MCP · 2026-09-16).
 *
 * 화면과 같은 규칙을 쓴다 — 같은 Zod 스키마, 같은 멱등 키, 같은 활동 기록.
 * 구성원이면 누구나 부른다(2026-09-16) — 사건을 겪은 사람이 그 자리에서 적어야 연혁이 낡지 않는다.
 * 누가 남겼는지는 활동 기록에 있다.
 */
export async function saveCompanyRecordText(
  args: Record<string, unknown>,
  caller: { userId: string; role: "ADMIN" | "MEMBER" }
): Promise<{ text: string } | { error: string }> {

  const recordId = typeof args.record_id === "string" ? args.record_id : null
  const before = recordId ? await prisma.companyRecord.findUnique({ where: { id: recordId } }) : null
  if (recordId && !before) return { error: "없는 연혁입니다 — list_company_records 로 확인하세요" }

  // 고칠 때는 지금 값을 바탕에 깔고 넘어온 칸만 덮는다. 안 그러면 안 보낸 칸이 비워진다.
  const base: Record<string, unknown> = before
    ? {
        kind: before.kind,
        title: before.title,
        organizer: before.organizer,
        startsOn: before.startsOn?.toISOString().slice(0, 10) ?? null,
        endsOn: before.endsOn?.toISOString().slice(0, 10) ?? null,
        periodRaw: before.periodRaw,
        status: before.status,
        note: before.note,
        subject: before.subject,
        role: before.role,
        fundingKrw: before.fundingKrw === null ? null : String(before.fundingKrw),
        ownCashKrw: before.ownCashKrw === null ? null : String(before.ownCashKrw),
        ownInKindKrw: before.ownInKindKrw === null ? null : String(before.ownInKindKrw),
        grantNo: before.grantNo,
        prize: before.prize,
        venue: before.venue,
        partner: before.partner,
        category: before.category,
      }
    : {}

  const given = Object.fromEntries(Object.entries(args).filter(([k, v]) => k !== "record_id" && v !== undefined))
  const parsed = CompanyRecordSchema.safeParse({ ...base, ...given })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "잘못된 입력" }

  const data = recordData(parsed.data)
  const dedupeKey = recordDedupeKey({
    kind: data.kind,
    title: data.title,
    organizer: data.organizer,
    partner: data.partner,
    startsOn: parsed.data.startsOn,
    periodRaw: data.periodRaw,
  })

  try {
    const row = before
      ? await prisma.companyRecord.update({ where: { id: before.id }, data: { dedupeKey, ...data } })
      : await prisma.companyRecord.create({ data: { dedupeKey, source: "옴니스", ...data } })
    await writeActivity({
      userId: caller.userId,
      action: before ? "company.record.updated" : "company.record.created",
      entity: "COMPANY_RECORD",
      entityId: row.id,
      title: `${before ? "연혁 수정" : "연혁 추가"}: [${RECORD_KIND_LABEL[row.kind]}] ${row.title}`,
      metadata: { via: "mcp" },
    })
    return {
      text: `${before ? "고쳤습니다" : "남겼습니다"} — [${RECORD_KIND_LABEL[row.kind]}] ${row.title} · ${row.periodRaw ?? "기간 없음"}${row.status ? ` · ${row.status}` : ""}\nid ${row.id}`,
    }
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { error: "같은 연혁이 이미 있습니다" }
    throw err
  }
}

/**
 * 연혁 한 줄 지우기 (MCP · 2026-09-16).
 *
 * 중복으로 들어간 줄을 MCP 에서 바로 정리하라고 열었다. 행을 지운다 —
 * 연혁은 가리키는 것도 색인도 없다. 누가 지웠는지는 활동 기록에 남는다.
 */
export async function deleteCompanyRecordText(
  args: Record<string, unknown>,
  caller: { userId: string }
): Promise<{ text: string } | { error: string }> {
  const id = typeof args.record_id === "string" ? args.record_id.trim() : ""
  if (!id) return { error: "record_id 가 필요합니다 — list_company_records 의 id 를 씁니다" }

  const row = await prisma.companyRecord.findUnique({ where: { id } })
  if (!row) return { error: "없는 연혁입니다" }

  await prisma.companyRecord.delete({ where: { id } })
  await writeActivity({
    userId: caller.userId,
    action: "company.record.deleted",
    entity: "COMPANY_RECORD",
    entityId: id,
    title: `연혁 삭제: [${RECORD_KIND_LABEL[row.kind]}] ${row.title}`,
    metadata: { via: "mcp", startsOn: row.startsOn?.toISOString().slice(0, 10) ?? null },
  })
  return { text: `지웠습니다 — [${RECORD_KIND_LABEL[row.kind]}] ${row.title} · ${row.periodRaw ?? "기간 없음"}` }
}

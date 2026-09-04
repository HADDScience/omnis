/**
 * 엑셀 CRM 을 옴니스로 옮긴다.
 *
 *   npx tsx scripts/import-crm-xlsx.ts [--apply]
 *
 * --apply 없이 돌리면 아무것도 쓰지 않고 무엇이 들어갈지와 어긋난 곳만 보여 준다.
 * 돈이 걸린 자료라 기본값을 dry-run 으로 뒀다.
 *
 * 이번 회차 범위는 기관·담당자·HRP·제품·견적이다. 샘플요청·출고·재고는
 * 모델이 아직 없다 (계획서 4~5단계).
 */
import { readFileSync } from "fs"
import * as XLSX from "xlsx"
import { PrismaClient, CrmOrgType, CrmMembershipStatus, CrmQuoteStatus } from "../generated/prisma"

const XLSX_PATH =
  process.env.CRM_XLSX ??
  "/Users/jeong-uchang/NAS/home/HADD SCIENCE/CRM/HADDScience_CRM_260527.xlsx"

const APPLY = process.argv.includes("--apply")
const prisma = new PrismaClient()

const ORG_TYPE: Record<string, CrmOrgType> = {
  대학: CrmOrgType.UNIVERSITY,
  연구원: CrmOrgType.RESEARCH,
  기업: CrmOrgType.COMPANY,
  병원: CrmOrgType.HOSPITAL,
}

/** 손으로 친 오타를 제품마스터 이름으로 되돌린다. 작업지시자 승인 2026-09-04. */
const PRODUCT_ALIAS: Record<string, string> = {
  "애드젠 (ADD GEL 1%)": "애드젤 (ADD GEL 1%)",
}

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v).trim() || null)
const num = (v: unknown) => (typeof v === "number" ? Math.round(v) : 0)

function sheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name]
  if (!ws) throw new Error(`시트 없음: ${name}`)
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null })
}

/**
 * 엑셀의 날짜 칸은 '날짜'지 '시각'이 아니다.
 *
 * xlsx 가 cellDates 로 돌려주는 Date 는 시간대 변환 때문에 자정에서 몇십 초씩
 * 어긋난다 (2024-09-24 가 2024-09-23T14:59:08Z 로 왔다). 그대로 두면 화면에서
 * 하루가 밀린다. 가장 가까운 UTC 자정으로 맞춰 날짜만 남긴다.
 */
function toDate(v: unknown): Date {
  const d =
    v instanceof Date
      ? v
      : typeof v === "number"
        ? new Date(Math.round((v - 25569) * 86400 * 1000))
        : new Date(String(v))
  const DAY = 86400000
  return new Date(Math.round(d.getTime() / DAY) * DAY)
}

const notes: string[] = []
const warn = (s: string) => notes.push(s)

async function main() {
  const wb = XLSX.read(readFileSync(XLSX_PATH), { cellDates: true })
  console.log(`파일: ${XLSX_PATH}`)
  console.log(APPLY ? "모드: 실제 반영 (--apply)\n" : "모드: 미리보기 (쓰지 않음)\n")

  // ── 기관 ──────────────────────────────────────────────
  const orgRows = sheet(wb, "기관마스터").filter((r) => str(r["기관코드"]))
  const orgs = orgRows.map((r) => {
    const t = str(r["유형"]) ?? ""
    if (t && !ORG_TYPE[t]) warn(`기관 유형을 모르겠다: "${t}" (${str(r["기관명"])}) → OTHER`)
    return {
      code: str(r["기관코드"])!,
      name: str(r["기관명"])!,
      type: ORG_TYPE[t] ?? CrmOrgType.OTHER,
      address: str(r["주소"]),
      note: str(r["비고"]),
    }
  })

  // ── 담당자 ────────────────────────────────────────────
  const contactRows = sheet(wb, "컨택포인트").filter((r) => str(r["컨택 ID"]))
  const NO_NAME = "(이름 미상)"
  const contacts = contactRows.map((r) => {
    const name = str(r["담당자명"])
    if (!name)
      warn(
        `${str(r["컨택 ID"])} (${str(r["기관명"])}) — 담당자명이 비어 있다. "${NO_NAME}" 으로 넣는다. 화면에서 채워 주세요`
      )
    return {
    code: str(r["컨택 ID"])!,
    orgCode: str(r["기관코드(자동)"])!,
    name: name ?? NO_NAME,
    title: str(r["직함"]),
    phone: str(r["휴대폰"]),
    email: str(r["이메일"]),
    note: str(r["비고"]),
    }
  })

  // ── HRP ───────────────────────────────────────────────
  const hrpRows = sheet(wb, "HRP Membership").filter((r) => str(r["HRP 번호"]))
  const memberships = hrpRows.map((r) => ({
    code: str(r["HRP 번호"])!,
    orgCode: str(r["기관코드(자동)"])!,
    contactCode: str(r["컨택ID(자동)"]),
    status: str(r["상태"]) === "활성" ? CrmMembershipStatus.ACTIVE : CrmMembershipStatus.INACTIVE,
    discountAmount: num(r["할인액(원)"]),
  }))

  // ── 제품 ──────────────────────────────────────────────
  const prodRows = sheet(wb, "제품마스터").filter((r) => str(r["제품코드"]))
  const products = prodRows.map((r) => {
    const kind = str(r["타입"])
    const note = str(r["비고"])
    return {
      code: str(r["제품코드"])!,
      name: str(r["제품명"])!,
      spec: str(r["규격"]),
      kind,
      unitPrice: num(r["단가(원)"]) || null,
      isMaterial: kind === "원료" || (note ?? "").includes("원료"),
      note,
    }
  })

  /** 견적의 제품명 → 제품코드. 이름이 겹치면 단가가 있는 쪽을 고른다. */
  function findProduct(rawName: string): string | null {
    const name = PRODUCT_ALIAS[rawName] ?? rawName
    const hits = products.filter((p) => p.name === name)
    if (hits.length === 0) return null
    if (hits.length > 1) {
      const priced = hits.filter((p) => p.unitPrice)
      const pick = (priced.length ? priced : hits)[0]
      warn(
        `제품명 "${name}" 이 ${hits.length}개(${hits.map((h) => `${h.code}/${h.spec}`).join(", ")}) — ${pick.code} 로 붙였다`
      )
      return pick.code
    }
    return hits[0].code
  }

  // ── 견적 ──────────────────────────────────────────────
  const quoteRows = sheet(wb, "견적").filter((r) => str(r["견적 NO"]))
  const quotes = quoteRows.map((r) => {
    const supply = num(r["공급가(원)"])
    const subtotal = num(r["소계"])
    const recorded = num(r["HRP 할인액"])
    const applied = supply - subtotal // 실제로 깎인 금액
    if (recorded !== applied) {
      warn(
        `${str(r["견적 NO"])} — 할인액 ${recorded.toLocaleString()} 이 적혀 있지만 소계에서 빠진 건 ${applied.toLocaleString()} 이다. 실제 적용액으로 넣는다`
      )
    }
    const prodName = str(r["제품명"])!
    const code = findProduct(prodName)
    if (!code) warn(`${str(r["견적 NO"])} — 제품 "${prodName}" 을 제품마스터에서 못 찾았다`)
    return {
      code: str(r["견적 NO"])!,
      quotedAt: toDate(r["견적일자"]),
      orgName: str(r["기관명"])!,
      contactName: str(r["담당자명"]),
      membershipCode: str(r["HRP번호(자동)"]),
      discountAmount: applied,
      status: str(r["상태"]) === "완료" ? CrmQuoteStatus.DONE : CrmQuoteStatus.SENT,
      taxInvoicedAt: r["세금계산서 발행일"] ? toDate(r["세금계산서 발행일"]) : null,
      note: str(r["비고"]),
      item: { productCode: code, quantity: num(r["수량"]), unitPrice: num(r["단가(자동)"]) },
      _supply: supply,
      _subtotal: subtotal,
      _total: num(r["실 합계"]),
    }
  })

  // ── 검산 ──────────────────────────────────────────────
  const sum = (f: (q: (typeof quotes)[number]) => number) => quotes.reduce((a, q) => a + f(q), 0)
  const supplyTotal = sum((q) => q._supply)
  const grandTotal = sum((q) => q._total)
  const recomputed = quotes.reduce((a, q) => {
    const sub = q.item.quantity * q.item.unitPrice - q.discountAmount
    return a + sub + Math.round(sub * 0.1)
  }, 0)

  console.log("─── 옮길 것 ───")
  console.log(`  기관        ${orgs.length}`)
  console.log(`  담당자      ${contacts.length}`)
  console.log(`  HRP         ${memberships.length}`)
  console.log(`  제품        ${products.length} (원료 ${products.filter((p) => p.isMaterial).length})`)
  console.log(`  견적        ${quotes.length}`)
  console.log("\n─── 검산 ───")
  console.log(`  총 공급가        ${supplyTotal.toLocaleString()}  (엑셀 대시보드 39,951,550)`)
  console.log(`  총 실합계        ${grandTotal.toLocaleString()}  (엑셀 대시보드 42,186,705)`)
  console.log(`  품목에서 재계산  ${recomputed.toLocaleString()}  ${recomputed === grandTotal ? "✓ 일치" : "✗ 불일치"}`)
  console.log(`  실제 적용 할인   ${sum((q) => q.discountAmount).toLocaleString()}  (엑셀 대시보드 4,400,000)`)

  if (notes.length) {
    console.log(`\n─── 짚어 둘 것 ${notes.length}건 ───`)
    for (const n of notes) console.log(`  · ${n}`)
  }

  if (!APPLY) {
    console.log("\n미리보기라 아무것도 쓰지 않았다. 반영하려면 --apply")
    return
  }

  // ── 반영 ──────────────────────────────────────────────
  // code 가 unique 라 upsert 로 몇 번을 돌려도 같은 상태가 된다.
  await prisma.$transaction(async (tx) => {
    for (const o of orgs) await tx.crmOrg.upsert({ where: { code: o.code }, create: o, update: o })

    const orgRowsDb = await tx.crmOrg.findMany()
    const orgId = new Map(orgRowsDb.map((o) => [o.code, o.id] as const))
    const orgIdByName = new Map(orgRowsDb.map((o) => [o.name, o.id] as const))

    for (const c of contacts) {
      const oid = orgId.get(c.orgCode)
      if (!oid) throw new Error(`담당자 ${c.code} — 기관코드 ${c.orgCode} 를 기관마스터에서 못 찾았다`)
      const fields = { name: c.name, title: c.title, phone: c.phone, email: c.email, note: c.note }
      await tx.crmContact.upsert({
        where: { code: c.code },
        create: { code: c.code, ...fields, org: { connect: { id: oid } } },
        update: { ...fields, org: { connect: { id: oid } } },
      })
    }
    const contactId = new Map((await tx.crmContact.findMany()).map((c) => [c.code, c.id]))
    const contactByOrgName = new Map(
      (await tx.crmContact.findMany()).map((c) => [`${c.orgId}::${c.name}`, c.id])
    )

    for (const m of memberships) {
      const oid = orgId.get(m.orgCode)
      if (!oid) throw new Error(`HRP ${m.code} — 기관코드 ${m.orgCode} 없음`)
      const cid = m.contactCode ? contactId.get(m.contactCode) : undefined
      const fields = {
        status: m.status,
        discountAmount: m.discountAmount,
        org: { connect: { id: oid } },
        contact: cid ? { connect: { id: cid } } : { disconnect: true },
      }
      await tx.crmMembership.upsert({
        where: { code: m.code },
        create: { code: m.code, ...fields, contact: cid ? { connect: { id: cid } } : undefined },
        update: fields,
      })
    }
    const membershipId = new Map((await tx.crmMembership.findMany()).map((m) => [m.code, m.id]))

    for (const p of products)
      await tx.crmProduct.upsert({ where: { code: p.code }, create: p, update: p })
    const productId = new Map((await tx.crmProduct.findMany()).map((p) => [p.code, p.id]))

    for (const q of quotes) {
      const oid = orgIdByName.get(q.orgName)
      if (!oid) throw new Error(`견적 ${q.code} — 기관 "${q.orgName}" 없음`)
      const cid = q.contactName ? (contactByOrgName.get(`${oid}::${q.contactName}`) ?? null) : null
      const mid = q.membershipCode ? membershipId.get(q.membershipCode) : undefined
      const common = {
        quotedAt: q.quotedAt,
        discountAmount: q.discountAmount,
        status: q.status,
        taxInvoicedAt: q.taxInvoicedAt,
        note: q.note,
      }
      const saved = await tx.crmQuote.upsert({
        where: { code: q.code },
        create: {
          code: q.code,
          ...common,
          org: { connect: { id: oid } },
          contact: cid ? { connect: { id: cid } } : undefined,
          membership: mid ? { connect: { id: mid } } : undefined,
        },
        update: {
          ...common,
          org: { connect: { id: oid } },
          contact: cid ? { connect: { id: cid } } : { disconnect: true },
          membership: mid ? { connect: { id: mid } } : { disconnect: true },
        },
      })
      // 다시 돌려도 품목이 불어나지 않게 지우고 새로 넣는다
      await tx.crmQuoteItem.deleteMany({ where: { quoteId: saved.id } })
      if (q.item.productCode) {
        await tx.crmQuoteItem.create({
          data: {
            quote: { connect: { id: saved.id } },
            product: { connect: { id: productId.get(q.item.productCode)! } },
            quantity: q.item.quantity,
            unitPrice: q.item.unitPrice,
          },
        })
      }
    }
  }, { timeout: 120000, maxWait: 20000 })

  const after = {
    기관: await prisma.crmOrg.count(),
    담당자: await prisma.crmContact.count(),
    HRP: await prisma.crmMembership.count(),
    제품: await prisma.crmProduct.count(),
    견적: await prisma.crmQuote.count(),
    품목: await prisma.crmQuoteItem.count(),
  }
  console.log("\n─── 반영 후 DB ───")
  for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(8)}${v}`)
}

main()
  .catch((e) => {
    console.error("실패:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

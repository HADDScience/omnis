/**
 * 엑셀 CRM 을 옴니스로 옮긴다.
 *
 *   npx tsx scripts/import-crm-xlsx.ts [--apply]
 *
 * --apply 없이 돌리면 아무것도 쓰지 않고 무엇이 들어갈지와 어긋난 곳만 보여 준다.
 * 돈이 걸린 자료라 기본값을 dry-run 으로 뒀다.
 *
 * 기관·담당자·HRP·제품·견적·샘플요청·출고·재고 전부를 옮긴다.
 */
import { readFileSync } from "fs"
import * as XLSX from "xlsx"
import {
  PrismaClient,
  CrmOrgType,
  CrmMembershipStatus,
  CrmQuoteStatus,
  CrmSampleStatus,
  CrmShipmentKind,
  CrmShipmentStatus,
  CrmStockDirection,
} from "../generated/prisma"

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

/**
 * 시트를 행 배열로. `headerRow` 는 헤더가 첫 줄이 아닐 때 쓴다 —
 * 재고 시트는 0번 줄이 "▣ 입고 기록" 제목이고 헤더가 1번 줄에 있다.
 */
function sheet(wb: XLSX.WorkBook, name: string, headerRow = 0): Row[] {
  const ws = wb.Sheets[name]
  if (!ws) throw new Error(`시트 없음: ${name}`)
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, range: headerRow })
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

  // ── 샘플요청 ──────────────────────────────────────────
  const sampleRows = sheet(wb, "샘플요청").filter((r) => str(r["No."]))
  const samples = sampleRows.map((r) => {
    const prodName = str(r["제품명"])
    const code = prodName ? findProduct(prodName) : null
    if (prodName && !code)
      warn(`샘플 ${str(r["No."])} — 제품 "${prodName}" 을 제품마스터에서 못 찾았다`)
    const sent = str(r["발송여부"]) === "발송완료"
    return {
      code: str(r["No."])!,
      requestedAt: toDate(r["요청일자"]),
      orgName: str(r["기관명"])!,
      contactName: str(r["담당자명"]),
      productCode: code,
      request: str(r["요청사항"]),
      referral: str(r["소개경로"]),
      status: sent ? CrmSampleStatus.SENT : CrmSampleStatus.PENDING,
      sentAt: r["발송일"] ? toDate(r["발송일"]) : null,
      note: str(r["비고"]),
    }
  })

  // ── 출고 ──────────────────────────────────────────────
  const SHIP_KIND: Record<string, CrmShipmentKind> = {
    판매: CrmShipmentKind.SALE,
    샘플: CrmShipmentKind.SAMPLE,
    증정: CrmShipmentKind.GIFT,
  }
  const SHIP_STATUS: Record<string, CrmShipmentStatus> = {
    준비중: CrmShipmentStatus.PREPARING,
    배송중: CrmShipmentStatus.SHIPPING,
    배송완료: CrmShipmentStatus.DELIVERED,
  }
  const shipRows = sheet(wb, "출고").filter((r) => str(r["출고번호"]))
  const shipments = shipRows.map((r) => {
    const prodCode = str(r["제품코드(자동)"]) ?? (str(r["제품명"]) ? findProduct(str(r["제품명"])!) : null)
    if (!prodCode) warn(`출고 ${str(r["출고번호"])} — 제품을 못 찾았다 ("${str(r["제품명"])}")`)
    const kindRaw = str(r["출고유형"]) ?? ""
    if (kindRaw && !SHIP_KIND[kindRaw]) warn(`출고 ${str(r["출고번호"])} — 모르는 출고유형 "${kindRaw}" → 판매`)
    return {
      code: str(r["출고번호"])!,
      shippedAt: toDate(r["출고일"]),
      kind: SHIP_KIND[kindRaw] ?? CrmShipmentKind.SALE,
      orgName: str(r["기관명"])!,
      productCode: prodCode,
      quantity: num(r["수량"]) || 1,
      status: SHIP_STATUS[str(r["배송상태"]) ?? ""] ?? CrmShipmentStatus.PREPARING,
      /** 견적번호/요청번호 — 견적이면 견적에, 샘플요청 번호면 샘플에 잇는다 */
      refCode: str(r["견적번호/요청번호(FK)"]),
      note: str(r["비고"]),
    }
  })

  // ── 재고 입고 ─────────────────────────────────────────
  // 재고 시트는 왼쪽이 입고 기록, 오른쪽이 요약이다. 요약은 옮기지 않는다 —
  // 현재고는 장부에서 계산해야지 어딘가 적힌 숫자를 믿으면 안 된다.
  const stockRows = sheet(wb, "재고", 1).filter((r) => r["입고일자"])
  const stockIns = stockRows.map((r) => {
    const spec = str(r["원료 규격"])
    const code = str(r["제품코드(자동)"]) ?? null
    if (!code) warn(`입고 ${spec} — 제품코드가 비어 있다`)
    return {
      movedAt: toDate(r["입고일자"]),
      productCode: code,
      quantity: num(r["입고량(개)"]),
      note: str(r["비고"]),
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
  console.log(`  샘플요청    ${samples.length}`)
  console.log(`  출고        ${shipments.length}`)
  console.log(`  재고 입고   ${stockIns.length}`)
  console.log("\n─── 검산 ───")
  console.log(`  총 공급가        ${supplyTotal.toLocaleString()}  (엑셀 대시보드 39,951,550)`)
  console.log(`  총 실합계        ${grandTotal.toLocaleString()}  (엑셀 대시보드 42,186,705)`)
  console.log(`  품목에서 재계산  ${recomputed.toLocaleString()}  ${recomputed === grandTotal ? "✓ 일치" : "✗ 불일치"}`)
  console.log(`  실제 적용 할인   ${sum((q) => q.discountAmount).toLocaleString()}  (엑셀 대시보드 4,400,000)`)

  // 재고: 장부 합계가 엑셀 요약 칸과 맞는지 본다.
  // 엑셀 요약은 SUMIFS 수식이라 값이 맞아야 정상이다 — 안 맞으면 옮기는 쪽이 틀렸다.
  const stockByProduct = new Map<string, number>()
  for (const m of stockIns)
    if (m.productCode)
      stockByProduct.set(m.productCode, (stockByProduct.get(m.productCode) ?? 0) + m.quantity)
  const summaryRows = sheet(wb, "재고", 1).filter((r) => str(r["원료 규격_1"]) ?? str(r["총 입고량"]))
  console.log("  재고 입고 합계")
  for (const [code, qty] of stockByProduct) {
    const p = products.find((x) => x.code === code)
    const excel = summaryRows.find((r) => str(r["원료 규격_1"]) === p?.name)
    const want = excel ? num(excel["총 입고량"]) : null
    console.log(
      `    ${p?.name ?? code}  ${qty}${want != null ? `  (엑셀 요약 ${want}) ${qty === want ? "✓" : "✗"}` : ""}`
    )
  }

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

  // ── 샘플요청 · 출고 · 재고 반영 ────────────────────────
  await prisma.$transaction(async (tx) => {
    const orgIdByName = new Map((await tx.crmOrg.findMany()).map((o) => [o.name, o.id] as const))
    const contactByOrgName = new Map(
      (await tx.crmContact.findMany()).map((c) => [`${c.orgId}::${c.name}`, c.id] as const)
    )
    const productId = new Map((await tx.crmProduct.findMany()).map((p) => [p.code, p.id] as const))
    const quoteId = new Map((await tx.crmQuote.findMany()).map((q) => [q.code, q.id] as const))

    for (const s of samples) {
      const oid = orgIdByName.get(s.orgName)
      if (!oid) throw new Error(`샘플 ${s.code} — 기관 "${s.orgName}" 없음`)
      const cid = s.contactName ? (contactByOrgName.get(`${oid}::${s.contactName}`) ?? null) : null
      const common = {
        requestedAt: s.requestedAt,
        request: s.request,
        referral: s.referral,
        status: s.status,
        sentAt: s.sentAt,
        note: s.note,
      }
      const rel = {
        org: { connect: { id: oid } },
        contact: cid ? { connect: { id: cid } } : undefined,
        product: s.productCode ? { connect: { id: productId.get(s.productCode)! } } : undefined,
      }
      await tx.crmSampleRequest.upsert({
        where: { code: s.code },
        create: { code: s.code, ...common, ...rel },
        update: {
          ...common,
          org: { connect: { id: oid } },
          contact: cid ? { connect: { id: cid } } : { disconnect: true },
          product: s.productCode
            ? { connect: { id: productId.get(s.productCode)! } }
            : { disconnect: true },
        },
      })
    }
    const sampleId = new Map(
      (await tx.crmSampleRequest.findMany()).map((s) => [s.code, s.id] as const)
    )

    for (const sh of shipments) {
      const oid = orgIdByName.get(sh.orgName)
      if (!oid) throw new Error(`출고 ${sh.code} — 기관 "${sh.orgName}" 없음`)
      if (!sh.productCode) throw new Error(`출고 ${sh.code} — 제품을 못 찾았다`)
      const qid = sh.refCode ? quoteId.get(sh.refCode) : undefined
      const sid = sh.refCode ? sampleId.get(sh.refCode) : undefined
      if (sh.refCode && !qid && !sid)
        warn(`출고 ${sh.code} — 참조번호 "${sh.refCode}" 가 견적에도 샘플요청에도 없다`)
      const common = {
        shippedAt: sh.shippedAt,
        kind: sh.kind,
        quantity: sh.quantity,
        status: sh.status,
        note: sh.note,
      }
      await tx.crmShipment.upsert({
        where: { code: sh.code },
        create: {
          code: sh.code,
          ...common,
          org: { connect: { id: oid } },
          product: { connect: { id: productId.get(sh.productCode)! } },
          quote: qid ? { connect: { id: qid } } : undefined,
          sampleRequest: sid ? { connect: { id: sid } } : undefined,
        },
        update: {
          ...common,
          org: { connect: { id: oid } },
          product: { connect: { id: productId.get(sh.productCode)! } },
          quote: qid ? { connect: { id: qid } } : { disconnect: true },
          sampleRequest: sid ? { connect: { id: sid } } : { disconnect: true },
        },
      })
    }

    // 입고는 code 가 없어 upsert 할 열쇠가 없다. 사람이 적은 줄(shipmentId 없음)만
    // 지우고 다시 넣는다 — 여러 번 돌려도 두 배가 되지 않게.
    await tx.crmStockMove.deleteMany({ where: { shipmentId: null } })
    for (const m of stockIns) {
      if (!m.productCode) continue
      await tx.crmStockMove.create({
        data: {
          movedAt: m.movedAt,
          direction: CrmStockDirection.IN,
          quantity: m.quantity,
          note: m.note,
          product: { connect: { id: productId.get(m.productCode)! } },
        },
      })
    }
  }, { timeout: 120000, maxWait: 20000 })

  const after = {
    기관: await prisma.crmOrg.count(),
    담당자: await prisma.crmContact.count(),
    HRP: await prisma.crmMembership.count(),
    제품: await prisma.crmProduct.count(),
    견적: await prisma.crmQuote.count(),
    품목: await prisma.crmQuoteItem.count(),
    샘플요청: await prisma.crmSampleRequest.count(),
    출고: await prisma.crmShipment.count(),
    재고이동: await prisma.crmStockMove.count(),
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

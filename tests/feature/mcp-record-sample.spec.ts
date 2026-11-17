/**
 * MCP 샘플 전달 기록(#231) — find_org 부분 일치 · confirm 없이는 쓰지 않음 · 없는 기관은 묻고 만든다 · 재고 · 활동 기록.
 * 기관 · 제품 이름은 지어낸 것이다.
 */
import { createHash, randomBytes } from "node:crypto"
import { expect, test, type APIRequestContext } from "@playwright/test"
import { PrismaClient } from "../../generated/prisma/client"
import type { DemoUser } from "./_setup"

const stamp = Date.now()
const ORG = `(주)시험샘플바이오${stamp}`
const NEW_ORG = `시험새기관${stamp}`
const PRODUCT = `시험샘플젤${stamp}`
const MEMBER: DemoUser = "사원1"
const TOKEN_NAME = `시험 샘플 ${stamp}`

test.describe("MCP 샘플 전달 기록", () => {
  const prisma = new PrismaClient()
  let token = ""
  let userId = ""
  let orgId = ""
  let productId = ""

  async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
    const res = await request.post("/api/ip-mcp", {
      headers: { authorization: `Bearer ${token}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    })
    expect(res.ok(), "MCP 응답").toBe(true)
    const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } }
    return { text: body.result?.content?.map((c) => c.text).join("\n") ?? "", isError: body.result?.isError ?? false }
  }

  const samplesOf = (id: string) => prisma.crmSampleRequest.findMany({ where: { orgId: id }, include: { shipments: { include: { stockMoves: true } } } })

  test.beforeAll(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { name: MEMBER }, select: { id: true } })).id
    orgId = (await prisma.crmOrg.create({ data: { name: ORG, code: `ORGT${stamp}`, type: "COMPANY" } })).id
    productId = (await prisma.crmProduct.create({ data: { name: PRODUCT, spec: "1ml", code: `PRDT${stamp}` } })).id
    token = `hadd_${randomBytes(24).toString("hex")}`
    const hash = createHash("sha256").update(token).digest("hex")
    await prisma.$executeRaw`INSERT INTO ip.mcp_tokens (user_id, name, token_hash, prefix) VALUES (${userId}, ${TOKEN_NAME}, ${hash}, ${token.slice(0, 12)})`
  })

  test.afterAll(async () => {
    const orgs = await prisma.crmOrg.findMany({ where: { name: { in: [ORG, NEW_ORG] } }, select: { id: true } })
    const ids = orgs.map((o) => o.id)
    const shipments = await prisma.crmShipment.findMany({ where: { orgId: { in: ids } }, select: { id: true } })
    const samples = await prisma.crmSampleRequest.findMany({ where: { orgId: { in: ids } }, select: { id: true } })
    await prisma.crmStockMove.deleteMany({ where: { shipmentId: { in: shipments.map((s) => s.id) } } })
    await prisma.crmShipment.deleteMany({ where: { id: { in: shipments.map((s) => s.id) } } })
    await prisma.crmSampleRequest.deleteMany({ where: { orgId: { in: ids } } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: [...ids, ...samples.map((s) => s.id)] } } })
    await prisma.crmOrg.deleteMany({ where: { id: { in: ids } } })
    await prisma.crmProduct.deleteMany({ where: { id: productId } })
    await prisma.$executeRaw`DELETE FROM ip.mcp_tokens WHERE name = ${TOKEN_NAME}`
    await prisma.$disconnect()
  })

  test("find_org 는 법인 표기 · 띄어쓰기가 달라도 찾는다", async ({ request }) => {
    const r = await call(request, "find_org", { query: `시험샘플 바이오${stamp}` })
    expect(r.isError).toBe(false)
    expect(r.text).toContain(ORG)
    const none = await call(request, "find_org", { query: `없는기관${stamp}` })
    expect(none.text).toContain("맞는 기관이 없습니다")
  })

  test("confirm 없이는 쓰지 않고 남길 내용만 돌려준다", async ({ request }) => {
    const r = await call(request, "record_sample", { org: `시험샘플바이오${stamp}`, product: `${PRODUCT} 1ml`, quantity: 2 })
    expect(r.isError).toBe(false)
    expect(r.text).toContain("아직 기록하지 않았습니다")
    expect(r.text).toContain(ORG)
    expect(await samplesOf(orgId)).toHaveLength(0)
  })

  test("확인하면 샘플요청 · 샘플 출고 · 재고 출고 · 활동 기록이 함께 남는다", async ({ request }) => {
    const r = await call(request, "record_sample", { org: `시험샘플바이오${stamp}`, product: `${PRODUCT} 1ml`, quantity: 2, contact: "없는담당", confirm: true })
    expect(r.isError, r.text).toBe(false)
    expect(r.text).toContain("기록했습니다")
    const rows = await samplesOf(orgId)
    expect(rows).toHaveLength(1)
    const [s] = rows
    expect(s.status).toBe("SENT")
    expect(s.productId).toBe(productId)
    expect(s.note).toContain("없는담당")
    expect(s.shipments).toHaveLength(1)
    expect(s.shipments[0]).toMatchObject({ kind: "SAMPLE", quantity: 2, status: "DELIVERED" })
    expect(s.shipments[0].stockMoves).toMatchObject([{ direction: "OUT", productId }])
    const log = await prisma.activityLog.findFirst({ where: { entity: "crm.sample", entityId: s.id } })
    expect(log?.userId).toBe(userId)
  })

  test("없는 기관은 만들지 않고 거절한다 — create_org=true 일 때만 새로 만든다", async ({ request }) => {
    const refused = await call(request, "record_sample", { org: NEW_ORG, confirm: true })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("CRM 에 없습니다")
    expect(await prisma.crmOrg.count({ where: { name: NEW_ORG } })).toBe(0)

    const made = await call(request, "record_sample", { org: NEW_ORG, create_org: true, org_type: "RESEARCH", content: "카탈로그와 함께", confirm: true })
    expect(made.isError, made.text).toBe(false)
    expect(made.text).toContain("새 기관")
    const org = await prisma.crmOrg.findUniqueOrThrow({ where: { name: NEW_ORG } })
    expect(org.type).toBe("RESEARCH")
    const rows = await samplesOf(org.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].request).toBe("카탈로그와 함께")
    // 제품 · 수량이 없으면 출고 · 재고는 건드리지 않는다
    expect(rows[0].shipments).toHaveLength(0)
    expect(await prisma.activityLog.count({ where: { entity: "crm.org", entityId: org.id } })).toBe(1)
  })

  test("모르는 제품 · 앞날은 거절한다", async ({ request }) => {
    const p = await call(request, "record_sample", { org: ORG, product: `없는젤${stamp}`, quantity: 1, confirm: true })
    expect(p.isError).toBe(true)
    expect(p.text).toContain("제품 목록에 없습니다")
    const d = await call(request, "record_sample", { org: ORG, date: "2999-01-01", confirm: true })
    expect(d.isError).toBe(true)
    expect(await samplesOf(orgId)).toHaveLength(1)
  })
})

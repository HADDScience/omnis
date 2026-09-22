import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { nextDatedCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"
import { prisma } from "@/lib/db"
import { inquiryAcceptSchema, inquiryRejectSchema } from "@/lib/website-inquiry"

export const runtime = "nodejs"

/**
 * 홈페이지 문의 검토 — 승인 · 반려 · 스팸.
 *
 * 승인만이 CRM 을 만든다. 반려·스팸은 문의의 상태만 바꾸고 기관 목록을 건드리지 않는다 —
 * 그것이 문의함을 CRM 밖에 둔 이유다.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ inquiryId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { inquiryId } = await params

  const body = (await req.json().catch(() => null)) as { action?: string } | null
  if (body?.action === "reject") return reject(inquiryId, session.user.id, body)
  if (body?.action === "accept") return accept(inquiryId, session.user.id, body)
  return NextResponse.json({ error: "action 은 accept 또는 reject 입니다" }, { status: 400 })
}

async function reject(inquiryId: string, userId: string, body: unknown) {
  const parsed = inquiryRejectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 입력" }, { status: 400 })
  }

  // NEW 인 것만 바꾼다 — 이미 승인해 견적까지 만든 문의를 나중에 스팸으로 덮으면
  // 견적은 남고 문의만 스팸이 되어 장부와 어긋난다.
  const claimed = await prisma.websiteInquiry.updateMany({
    where: { id: inquiryId, status: "NEW" },
    data: {
      status: parsed.data.status,
      reviewNote: parsed.data.reviewNote ?? null,
      reviewedById: userId,
      reviewedAt: new Date(),
    },
  })
  if (claimed.count === 0) {
    return NextResponse.json({ error: "이미 처리된 문의입니다" }, { status: 409 })
  }
  return NextResponse.json({ ok: true, status: parsed.data.status })
}

async function accept(inquiryId: string, userId: string, body: unknown) {
  const parsed = inquiryAcceptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "잘못된 입력" }, { status: 400 })
  }
  const { orgId, contactId, outcome, note } = parsed.data

  const org = await prisma.crmOrg.findUnique({ where: { id: orgId }, select: { id: true } })
  if (!org) return NextResponse.json({ error: "기관을 찾을 수 없습니다" }, { status: 404 })

  // 담당자가 그 기관 소속인지 본다 — POST /api/crm/quotes 와 같은 검사다
  if (contactId) {
    const c = await prisma.crmContact.findUnique({ where: { id: contactId }, select: { orgId: true } })
    if (!c || c.orgId !== orgId) {
      return NextResponse.json({ error: "담당자가 이 기관 소속이 아닙니다" }, { status: 400 })
    }
  }

  // 코드가 부딪히면 트랜잭션 전체가 되돌아간 뒤 번호를 다시 뽑아 재시도한다 —
  // 선점한 status 도 함께 되돌아가므로 두 번째 시도가 다시 NEW 를 본다.
  const result = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      // 두 탭에서 동시에 승인해도 문서가 하나만 생기게 먼저 선점한다
      // (lib/notifications.ts 의 respondToAction 과 같은 방식).
      const claimed = await tx.websiteInquiry.updateMany({
        where: { id: inquiryId, status: "NEW" },
        data: {
          status: "ACCEPTED",
          reviewNote: note ?? null,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      })
      if (claimed.count === 0) return { conflict: true as const }

      const inquiry = await tx.websiteInquiry.findUniqueOrThrow({ where: { id: inquiryId } })
      const now = new Date()
      // 문의 본문을 문서에 옮긴다 — 담당자가 무엇을 채울지 그 화면에서 읽는다
      const fromInquiry = `홈페이지 문의 (${inquiry.id})\n${inquiry.message}`.slice(0, 2000)

      let quoteId: string | null = null
      let sampleId: string | null = null
      let code: string | null = null

      if (outcome === "quote") {
        const codes = (await tx.crmQuote.findMany({ select: { code: true } })).map((q) => q.code)
        // 품목은 비워 둔다. 무엇을 얼마에 줄지는 담당자가 정한다.
        const quote = await tx.crmQuote.create({
          data: {
            code: nextDatedCode(now, codes),
            quotedAt: now,
            orgId,
            contactId: contactId ?? null,
            status: "DRAFT",
            note: fromInquiry,
          },
        })
        quoteId = quote.id
        code = quote.code
      } else if (outcome === "sample") {
        const codes = (await tx.crmSampleRequest.findMany({ select: { code: true } })).map((r) => r.code)
        // 제품은 비워 둔다 — 폼에 제품 칸이 없어서 무엇을 원하는지는 본문에만 있다.
        const sample = await tx.crmSampleRequest.create({
          data: {
            code: nextDatedCode(now, codes),
            requestedAt: now,
            orgId,
            contactId: contactId ?? null,
            request: inquiry.message.slice(0, 2000),
            referral: "홈페이지 문의",
            note: `홈페이지 문의 (${inquiry.id})`,
          },
        })
        sampleId = sample.id
        code = sample.code
      }

      await tx.websiteInquiry.update({
        where: { id: inquiryId },
        data: { orgId, contactId: contactId ?? null, quoteId, sampleId },
      })

      return { conflict: false as const, outcome, orgId, contactId: contactId ?? null, quoteId, sampleId, code }
    })
  )

  if (result.conflict) return NextResponse.json({ error: "이미 처리된 문의입니다" }, { status: 409 })
  return NextResponse.json({ ok: true, ...result }, { status: 201 })
}

import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import {
  findDuplicate,
  inquiryIntakeSchema,
  inquiryRecipientIds,
  isRateLimited,
  topicLabel,
} from "@/lib/website-inquiry"

/**
 * 홈페이지 /contact 폼이 보낸 문의를 받는다.
 *
 * **서버 간 호출이다.** 사이트의 `app/api/contact/route.ts` 가 공유 비밀을 들고 부른다.
 * 브라우저를 여기에 직접 붙이지 않은 이유는, 그러면 이 주소가 공개돼 봇이 사이트를
 * 거치지 않고 바로 때리기 때문이다. 그래서 CORS 를 주지 않는다 —
 * 같은 `/api/website/` 아래여도 posts 쪽(관리 화면 브라우저 · SSO Bearer)과 다르다.
 *
 * 계약의 정본: mydocs/plans/2026-09-22-website-inquiry-to-crm.md
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } })
}

/** 길이가 다르면 timingSafeEqual 이 던진다 — 먼저 걸러 낸다. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  // 비밀을 빠뜨린 배포가 공개 쓰기 엔드포인트가 되지 않게 한다.
  // 401 이 아니라 503 인 것은, 부르는 쪽이 「내 비밀이 틀렸다」 와 「저쪽이 아직 안 섰다」 를
  // 구분해야 하기 때문이다 — 사이트는 503 에 메일 되돌림을 띄운다.
  const expected = process.env.WEBSITE_INQUIRY_SECRET
  if (!expected) return json({ error: "unavailable" }, 503)

  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!given || !secretMatches(given, expected)) return json({ error: "forbidden" }, 401)

  const parsed = inquiryIntakeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return json(
      { error: "invalid_inquiry", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      400
    )
  }
  const input = parsed.data

  try {
    const duplicate = await findDuplicate(input.email, input.message)
    if (duplicate) return json({ ok: true, id: duplicate.id, duplicate: true }, 200)

    if (await isRateLimited(input.email, input.ip)) return json({ error: "rate_limited" }, 429)

    const inquiry = await prisma.websiteInquiry.create({
      data: input,
      select: { id: true, name: true, organization: true, topic: true, message: true },
    })

    // 알림이 실패해도 접수는 성공이다 — 문의를 잃는 것보다 알림을 놓치는 편이 낫고,
    // 놓쳐도 /crm/inquiries 목록에 NEW 로 남는다.
    try {
      const title = `새 홈페이지 문의: ${inquiry.name}${inquiry.organization ? `(${inquiry.organization})` : ""}`
      const content = `${topicLabel(inquiry.topic)} · ${inquiry.message.slice(0, 80)}`
      const recipients = await inquiryRecipientIds()
      await Promise.all(
        recipients.map((userId) =>
          createNotification(userId, "website_inquiry", title, content, inquiry.id)
        )
      )
    } catch (e) {
      console.error("[website-inquiry] 알림 실패", inquiry.id, e)
    }

    return json({ ok: true, id: inquiry.id }, 201)
  } catch (e) {
    // DB 가 죽어도 500 을 내지 않는다. 사이트는 503 을 보고 메일 되돌림을 띄운다.
    console.error("[website-inquiry] 접수 실패", e)
    return json({ error: "unavailable" }, 503)
  }
}

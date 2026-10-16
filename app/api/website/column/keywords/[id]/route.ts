import { NextRequest } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import type { KeywordSource } from "@/lib/column/collect"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"

/**
 * 키워드 하나에 대한 손질(POST). 누른 사람만 기록한다(2026-10-16 결정 — 로테이션 없음).
 * PATCH 가 아니라 POST 인 까닭: 관리 화면은 다른 오리진이라 CORS 를 지나는데, websiteCors 의
 * 허용 메서드에 PATCH 가 없다.
 *   reserve · release   다른 사람이 같은 키워드로 동시에 쓰지 않게 하는 표시
 *   discard · restore   보드에서 내리기 / 되돌리기
 *   removeSource        주제와 느슨하게 맞는 근거 기사를 사람이 뺀다
 */
export const dynamic = "force-dynamic"
export const OPTIONS = websiteOptions

type Props = { params: Promise<{ id: string }> }

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve") }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("discard") }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("removeSource"), url: z.string().url() }),
])

export async function POST(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const { id } = await params
  const body = BodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return websiteJson({ error: "invalid_body" }, 400, origin)

  const k = await prisma.columnKeyword.findUnique({ where: { id }, include: { drafts: { select: { id: true } } } })
  if (!k) return websiteJson({ error: "not_found" }, 404, origin)
  const me = authed.user.id
  const busyByOther = k.status === "reserved" && k.reservedById !== null && k.reservedById !== me

  switch (body.data.action) {
    case "reserve":
      if (k.status !== "candidate") return websiteJson({ error: "bad_state", message: "후보 상태의 키워드만 예약할 수 있습니다" }, 409, origin)
      await prisma.columnKeyword.update({ where: { id }, data: { status: "reserved", reservedById: me, reservedAt: new Date() } })
      break
    case "release":
      if (k.status !== "reserved") return websiteJson({ error: "bad_state" }, 409, origin)
      if (busyByOther) return websiteJson({ error: "reserved_by_other", message: "다른 사람이 예약했습니다" }, 409, origin)
      if (k.drafts.length) return websiteJson({ error: "has_drafts", message: "초안이 있는 키워드는 초안을 지워야 예약이 풀립니다" }, 409, origin)
      await prisma.columnKeyword.update({ where: { id }, data: { status: "candidate", reservedById: null, reservedAt: null } })
      break
    case "discard":
      if (busyByOther || k.drafts.length) return websiteJson({ error: "in_use", message: "예약됐거나 초안이 있는 키워드는 버릴 수 없습니다" }, 409, origin)
      await prisma.columnKeyword.update({ where: { id }, data: { status: "discarded", reservedById: null, reservedAt: null } })
      break
    case "restore":
      if (k.status !== "discarded") return websiteJson({ error: "bad_state" }, 409, origin)
      await prisma.columnKeyword.update({ where: { id }, data: { status: "candidate" } })
      break
    case "removeSource": {
      const sources = (Array.isArray(k.sources) ? k.sources : []) as unknown as KeywordSource[]
      const next = sources.filter((s) => s.url !== (body.data as { url: string }).url)
      if (next.length === sources.length) return websiteJson({ error: "not_found", message: "그 근거가 없습니다" }, 404, origin)
      if (!next.length) return websiteJson({ error: "last_source", message: "근거가 하나뿐이면 뺄 수 없습니다 — 키워드를 버려 주세요" }, 409, origin)
      const dates = next.map((s) => s.date).filter((d): d is string => !!d).sort()
      await prisma.columnKeyword.update({
        where: { id },
        data: { sources: next as object, timelyAt: dates.length ? new Date(dates.at(-1) as string) : null },
      })
      break
    }
  }
  return websiteJson({ ok: true }, 200, origin)
}

import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { pathPattern, uiEventBatchSchema } from "@/lib/ui-metrics/rules"
import { uiMetricsServerEnabled } from "@/lib/ui-metrics/server"

export const runtime = "nodejs"

/**
 * 사용 기록 묶음을 받는다(탭을 숨길 때 sendBeacon 으로도 온다).
 * 누구인지는 세션에서만 읽고, 경로는 화면이 보낸 것을 믿지 않고 여기서 다시 지운다.
 */
export async function POST(req: Request) {
  if (!uiMetricsServerEnabled()) return new NextResponse(null, { status: 204 })
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const parsed = uiEventBatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 })

  const { sha, events } = parsed.data
  await prisma.uiEvent.createMany({
    data: events.map((e) => ({ userId, name: e.name, value: e.value, path: pathPattern(e.path), commitSha: sha })),
  })
  return new NextResponse(null, { status: 204 })
}

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { apiError, parseJson, writeActivity } from "@/lib/api"
import { auth } from "@/lib/auth"
import { bumpOnboardingVersion, countDueAt, currentOnboardingVersion } from "@/lib/onboarding-version-store"

export const runtime = "nodejs"

async function admin() {
  const session = await auth()
  if (!session?.user?.id) return { fail: apiError(401, "인증 필요") }
  if ((session.user as { role?: string }).role !== "ADMIN") return { fail: apiError(403, "관리자만 할 수 있습니다") }
  return { userId: session.user.id }
}

/** 지금 판과, 한 판 올리면 다시 보게 될 활성 사용자 수 — 확인 대화에 쓴다 */
export async function GET() {
  const a = await admin()
  if ("fail" in a) return a.fail
  const version = await currentOnboardingVersion()
  return NextResponse.json({ version, due: await countDueAt(version + 1) }, { headers: { "Cache-Control": "no-store" } })
}

const ReplaySchema = z.object({ from: z.number().int().positive() }).strict()

/** 모두에게 온보딩 다시 띄우기 — 판을 하나 올린다(코드 · 배포 없음). 다음 화면부터 바로 뜬다 */
export async function POST(req: NextRequest) {
  const a = await admin()
  if ("fail" in a) return a.fail
  const parsed = ReplaySchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, "잘못된 요청입니다")
  const due = await countDueAt(parsed.data.from + 1)
  const bumped = await bumpOnboardingVersion(parsed.data.from, a.userId)
  if (!bumped) return apiError(409, "그새 판이 바뀌었습니다. 화면을 새로 보고 다시 눌러 주세요")
  await writeActivity({
    userId: a.userId,
    action: "onboarding.replayed",
    entity: "AppSetting",
    entityId: "onboarding_version",
    title: `모두에게 온보딩 다시 띄우기 — ${bumped.from}판 → ${bumped.to}판 (${due}명)`,
    metadata: { ...bumped, due },
  })
  return NextResponse.json({ version: bumped.to, due })
}

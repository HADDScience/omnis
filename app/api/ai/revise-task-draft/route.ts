import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { reviseTaskDraft } from "@/lib/ai"
import { ReviseDraftRequestSchema } from "@/lib/schemas/task-ai"
import type { Prisma } from "@/generated/prisma/client"

/**
 * 작성 중인 업무 초안을 자연어 지시로 고친다.
 *
 * 필드를 하나씩 눌러 고치는 대신 "담당자는 혜린님으로, 마감 다음주"처럼 말로 적게 한다.
 * 그 지시와 전후 값을 `AiDraftRevision` 에 남긴다 —
 * 사람이 AI의 어떤 판단을 어떻게 되돌리는지가 쌓이는 자리다.
 * 지금은 보관만 하고 읽는 화면은 없다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const parsed = ReviseDraftRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "수정 지시와 현재 값이 필요합니다" }, { status: 400 })
  }
  const { source, instruction, current } = parsed.data

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "AI 키가 없어 말로 고치기를 쓸 수 없습니다. 필드를 직접 수정해 주세요." },
      { status: 503 }
    )
  }

  const [projects, products, members] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true, product: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  let draft
  try {
    draft = await reviseTaskDraft(
      current,
      instruction,
      {
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          productName: p.product?.name ?? null,
        })),
        products,
        members,
      },
      session.user.id
    )
  } catch (err) {
    console.error("[ai/revise-task-draft] 수정 실패", { userId: session.user.id, err })
    return NextResponse.json(
      { error: "말로 고치기에 실패했습니다. 다시 시도하거나 필드를 직접 수정해 주세요." },
      { status: 502 }
    )
  }

  // 기록 실패가 사용자의 수정을 막지는 않는다 — 보관은 부차적 목적이다.
  try {
    await prisma.aiDraftRevision.create({
      data: {
        userId: session.user.id,
        source: source ?? null,
        instruction,
        before: current as unknown as Prisma.InputJsonValue,
        after: draft as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    console.error("[ai/revise-task-draft] 기록 저장 실패", { userId: session.user.id, err })
  }

  return NextResponse.json(draft)
}

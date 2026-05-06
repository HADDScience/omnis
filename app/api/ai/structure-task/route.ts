import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { structureTask } from "@/lib/ai"
import { fallbackAiDraft } from "@/lib/schemas/task-ai"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  // 기존 호출: { messages: string[] }
  // TaskCmdModal 호출: { rawMessage: string, extraInstruction?: string, currentFields?: {...} }
  let messages: string[] = body.messages ?? []
  if (!messages?.length && body.rawMessage) {
    messages = [body.rawMessage]
    if (body.extraInstruction) messages.push(`[추가 지시] ${body.extraInstruction}`)
    if (body.currentFields) {
      const cf = body.currentFields
      const parts: string[] = []
      if (cf.title) parts.push(`제목: ${cf.title}`)
      if (cf.ownerName) parts.push(`담당: ${cf.ownerName}`)
      if (cf.deadlineLabel) parts.push(`마감: ${cf.deadlineLabel}`)
      if (cf.projectName) parts.push(`프로젝트: ${cf.projectName}`)
      if (parts.length) messages.push(`[현재 필드] ${parts.join(" · ")}`)
    }
  }

  if (!messages?.length) {
    return NextResponse.json({ error: "messages 또는 rawMessage 필수" }, { status: 400 })
  }

  // DB에서 프로젝트/제품/팀원 목록 조회 (#12: TaskCategory 폐기로 categories 미조회)
  const [projects, productList, members] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false },
      select: {
        id: true,
        name: true,
        product: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  const context = {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      productName: p.product?.name ?? null,
    })),
    products: productList,
    members,
  }

  // "기타" 제품 ID (AI가 분류 못하면 기본값)
  const etcProduct = productList.find((p) => p.name === "기타")
  const fallbackProductId = etcProduct?.id ?? null

  // Gemini API 키가 없으면 fallback
  if (!process.env.GEMINI_API_KEY) {
    const draft = fallbackAiDraft(messages)
    return NextResponse.json({
      ...draft,
      productId: fallbackProductId,
      _fallback: true,
    })
  }

  try {
    const draft = await structureTask(messages, context, session.user.id)
    if (!draft.productId) draft.productId = fallbackProductId
    return NextResponse.json(draft)
  } catch (err) {
    console.error("Gemini API 오류:", err)
    const draft = fallbackAiDraft(messages)
    return NextResponse.json({
      ...draft,
      productId: fallbackProductId,
      _fallback: true,
    })
  }
}

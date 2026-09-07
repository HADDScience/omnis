import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson } from "@/lib/api"
import { askOmnis } from "@/lib/omnis-ask"

export const runtime = "nodejs"

const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(2, "질문을 2자 이상 입력해 주세요")
    .max(500, "질문이 너무 깁니다 (500자 이내)"),
})

/** 로그인한 사용자의 최근 질문 내역을 최신순으로 반환한다. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const queries = await prisma.omnisQuery.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  })
  return NextResponse.json(queries)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  if (!process.env.GEMINI_API_KEY) {
    return apiError(503, "AI 기능이 비활성화되어 있습니다")
  }

  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = askSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다", parsed.error.flatten())
  }
  const { question } = parsed.data

  try {
    return NextResponse.json(await askOmnis(question, session.user.id))
  } catch (err) {
    console.error("[omnis/ask] 오류", err)
    return apiError(500, "답변 생성 중 오류가 발생했습니다")
  }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { retrieveContext, type EmbeddingSource } from "@/lib/embeddings"
import { answerWithOmnis } from "@/lib/ai"
import { apiError, parseJson, writeActivity } from "@/lib/api"

export const runtime = "nodejs"

const SOURCE_LABEL: Record<EmbeddingSource, string> = {
  OMNIS_CARD: "옴니스 카드",
  TASK: "업무",
  WEEKLY_REPORT: "주간보고",
  CHAT_MESSAGE: "채팅",
}

const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(2, "질문을 2자 이상 입력해 주세요")
    .max(500, "질문이 너무 깁니다 (500자 이내)"),
})

const STATUS_LABEL: Record<string, string> = {
  TODO: "할 일",
  IN_PROGRESS: "진행 중",
  REVIEW: "리뷰",
  DONE: "완료",
}

/**
 * 비보관 업무 전체를 구조화된 텍스트로 만든다.
 * RAG의 top-K 검색만으로는 "지연된 업무 전부"처럼 개수 제한 없는 집계 질문에
 * 누락이 생기므로, 업무 목록은 별도로 전량을 컨텍스트에 제공한다.
 */
async function buildTaskOverview(): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: { archived: false },
    select: {
      name: true,
      status: true,
      deadline: true,
      owner: { select: { name: true } },
    },
  })
  if (tasks.length === 0) return ""

  const now = Date.now()
  const isOverdue = (t: (typeof tasks)[number]) =>
    t.status !== "DONE" && t.deadline !== null && t.deadline.getTime() < now

  const sorted = [...tasks].sort(
    (a, b) =>
      (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity)
  )
  const overdueCount = tasks.filter(isOverdue).length
  const lines = sorted.map((t) => {
    const dl = t.deadline
      ? ` · 마감 ${t.deadline.toISOString().slice(0, 10)}${isOverdue(t) ? " (지연)" : ""}`
      : ""
    return `- ${t.name} · ${STATUS_LABEL[t.status] ?? t.status}${dl} · 담당 ${t.owner?.name ?? "미정"}`
  })
  return `전체 비보관 업무 ${tasks.length}건 · 지연 ${overdueCount}건\n${lines.join("\n")}`
}

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
    // 1. Retrieval — 질문과 유사한 사내 지식 청크 검색
    const chunks = await retrieveContext(question, {
      limit: 8,
      minSimilarity: 0.3,
      userId: session.user.id,
    })

    // 2. 업무 현황 — 비보관 업무 전체를 구조화해 컨텍스트로 제공 (집계 질문 누락 방지)
    const taskOverview = await buildTaskOverview()

    // 3. Generation — 검색 결과 + 업무 현황을 근거로 답변 생성
    const answer = await answerWithOmnis(
      question,
      chunks.map((c) => ({
        title: c.title,
        content: c.content,
        sourceLabel: SOURCE_LABEL[c.source],
      })),
      taskOverview,
      session.user.id
    )

    const sources = chunks.map((c) => ({
      id: c.id,
      source: c.source,
      sourceId: c.sourceId,
      title: c.title,
      sourceLabel: SOURCE_LABEL[c.source],
      similarity: Math.round(c.similarity * 100),
    }))

    // 3. 질문 내역 저장
    const saved = await prisma.omnisQuery.create({
      data: { userId: session.user.id, question, answer, sources },
    })
    await writeActivity({
      userId: session.user.id,
      action: "omnis.asked",
      entity: "OMNIS_QUERY",
      entityId: saved.id,
      title: `질문: ${question}`,
    })

    return NextResponse.json({
      id: saved.id,
      question: saved.question,
      answer: saved.answer,
      sources,
      createdAt: saved.createdAt,
    })
  } catch (err) {
    console.error("[omnis/ask] 오류", err)
    return apiError(500, "답변 생성 중 오류가 발생했습니다")
  }
}

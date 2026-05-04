import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { rebuildTask } from "@/lib/ai"
import { persistMentions } from "@/lib/mentions"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const roomId = searchParams.get("roomId")
  if (!roomId) return NextResponse.json({ error: "roomId 필수" }, { status: 400 })

  const after = searchParams.get("after")

  const messages = await prisma.chatMessage.findMany({
    where: {
      roomId,
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    },
  })

  return NextResponse.json(messages)
}

function extractMentionSlug(content: string): { slug: string; restText: string } | null {
  const match = content.match(/#([a-z0-9가-힣_-]+)/i)
  if (!match) return null
  const slug = match[1]
  // 멘션 태그를 제거한 나머지 전체 텍스트 (앞 + 뒤)
  const restText = (content.slice(0, match.index!) + content.slice(match.index! + match[0].length)).trim()
  return { slug, restText }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { roomId, content, taskId, fileIds, fileNames } = body

  if (!roomId || !content?.trim()) {
    return NextResponse.json({ error: "roomId, content 필수" }, { status: 400 })
  }

  const trimmedContent = content.trim()
  const attachedFileNames: string[] = fileNames || []
  const mention = extractMentionSlug(trimmedContent)
  let linkedTaskId = taskId || null
  let taskUpdate: { action: string; statusLabel?: string; summary?: string } | null = null

  // 먼저 메시지 저장 (즉시 응답을 위해)
  const message = await prisma.chatMessage.create({
    data: {
      roomId,
      authorId: session.user.id,
      content: trimmedContent,
      taskId: linkedTaskId,
    },
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    },
  })

  // 파일 연결
  if (fileIds && fileIds.length > 0) {
    await prisma.file.updateMany({
      where: { id: { in: fileIds } },
      data: { messageId: message.id },
    })
  }

  // ChatMention 자동 추출 (#업무명, @사람 멘션을 스레드 뷰 라우팅용으로 DB에 저장)
  await persistMentions(message.id, trimmedContent).catch(() => {})

  if (mention) {
    const task = await prisma.task.findUnique({
      where: { slug: mention.slug },
      select: { id: true, name: true, status: true, background: true, expectedResult: true, ownerId: true, instructorId: true },
    })

    if (task && mention.restText.length > 0) {
      // 메시지를 업무에 연결
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: { taskId: task.id },
      })
      linkedTaskId = task.id

      // 파일도 업무에 연결
      if (fileIds && fileIds.length > 0) {
        await prisma.file.updateMany({
          where: { id: { in: fileIds } },
          data: { taskId: task.id },
        })
      }

      const notifyUserId = task.ownerId === session.user.id ? task.instructorId : task.ownerId

      if (process.env.GEMINI_API_KEY) {
        // 이 업무에 연결된 모든 메시지 + 파일 수집
        const allMessages = await prisma.chatMessage.findMany({
          where: { taskId: task.id },
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { name: true } },
            files: { select: { name: true } },
          },
        })

        const checklists = await prisma.checklist.findMany({
          where: { taskId: task.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, done: true },
        })

        const result = await rebuildTask(
          task.name,
          task.background,
          task.expectedResult,
          checklists.map((c) => ({ name: c.name, done: c.done })),
          allMessages.map((m) => ({
            author: m.author.name,
            content: m.content,
            files: m.files.map((f) => f.name),
          }))
        )

        if (result.action === "complete") {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: "DONE", workEnd: new Date() },
          })
          await prisma.checklist.updateMany({
            where: { taskId: task.id, done: false },
            data: { done: true },
          })
          taskUpdate = { action: "complete", statusLabel: "완료", summary: `#${mention.slug} 업무 전체 완료 처리 · 체크리스트 전부 체크` }
          await createNotification(notifyUserId, "task_status_changed", "업무 완료", `${session.user.name}님이 #${mention.slug} 업무를 완료했습니다.`, task.id)

        } else if (result.action === "pause") {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: "TODO" },
          })
          taskUpdate = { action: "pause", statusLabel: "할 일", summary: `#${mention.slug} 업무 '할 일'로 되돌림` }
          await createNotification(notifyUserId, "task_status_changed", "업무 보류", `${session.user.name}님이 #${mention.slug} 업무를 '할 일'로 되돌렸습니다.`, task.id)

        } else if (result.action === "resume") {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: "IN_PROGRESS", workStart: new Date() },
          })
          taskUpdate = { action: "resume", statusLabel: "진행 중", summary: `#${mention.slug} 업무 재개` }
          await createNotification(notifyUserId, "task_status_changed", "업무 재개", `${session.user.name}님이 #${mention.slug} 업무를 재개했습니다.`, task.id)

        } else if (result.action === "rebuild") {
          // 업무 카드 전체 재구성
          const updateData: Record<string, unknown> = {}
          if (result.background) updateData.background = result.background
          if (result.expectedResult) updateData.expectedResult = result.expectedResult
          if (result.name) updateData.name = result.name

          if (task.status === "DONE") {
            updateData.status = "IN_PROGRESS"
          }

          if (Object.keys(updateData).length > 0) {
            await prisma.task.update({ where: { id: task.id }, data: updateData })
          }

          // 체크리스트 재구성
          if (result.checklist && result.checklist.length > 0) {
            // 기존 체크리스트 삭제 후 새로 생성
            await prisma.checklist.deleteMany({ where: { taskId: task.id } })
            await prisma.checklist.createMany({
              data: result.checklist.map((c) => ({
                name: c.name,
                done: c.done,
                taskId: task.id,
                ownerId: task.ownerId,
              })),
            })
          }

          // 체크리스트 전부 완료 시 업무도 완료 처리
          if (result.checklist && result.checklist.length > 0 && result.checklist.every((c) => c.done)) {
            await prisma.task.update({
              where: { id: task.id },
              data: { status: "DONE", workEnd: new Date() },
            })
          }

          // rebuild 요약 생성
          const changes: string[] = []
          if (result.name && result.name !== task.name) changes.push(`업무명 변경`)
          if (result.checklist) {
            const doneItems = result.checklist.filter((c) => c.done).length
            const totalItems = result.checklist.length
            changes.push(`체크리스트 ${doneItems}/${totalItems} 완료`)
          }
          if (result.background && result.background !== task.background) changes.push(`배경 수정`)
          if (result.expectedResult && result.expectedResult !== task.expectedResult) changes.push(`기대결과 수정`)

          taskUpdate = {
            action: "rebuild",
            statusLabel: "업무 업데이트됨",
            summary: `#${mention.slug} 재구성 · ${changes.join(" · ") || "내용 갱신"}`,
          }
          await createNotification(notifyUserId, "task_rebuilt", `업무 업데이트: #${mention.slug}`, `${session.user.name}님의 메시지로 업무 카드가 재구성되었습니다.`, task.id)
        }
        // "info", "none"은 아무 동작 없음 (메시지만 연결됨)
      } else {
        // Gemini 없으면 fallback
        const action = fallbackClassify(mention.restText)
        if (action === "complete") {
          await prisma.task.update({ where: { id: task.id }, data: { status: "DONE", workEnd: new Date() } })
          await prisma.checklist.updateMany({ where: { taskId: task.id, done: false }, data: { done: true } })
          taskUpdate = { action: "complete", statusLabel: "완료" }
        }
      }
    } else if (task) {
      await prisma.chatMessage.update({ where: { id: message.id }, data: { taskId: task.id } })
    }
  }

  // Gemini 판단 결과를 시스템 메시지로 DB에 저장
  if (taskUpdate) {
    const systemUser = await prisma.user.findFirst({ where: { name: "HADD MCP" } })
      ?? await prisma.user.findFirst({ where: { role: "ADMIN" } })
    if (systemUser) {
      await prisma.chatMessage.create({
        data: {
          roomId,
          authorId: systemUser.id,
          content: `🤖 ${taskUpdate.summary || taskUpdate.statusLabel || "업무 업데이트"}`,
          taskId: linkedTaskId,
        },
      })
    }
  }

  // 업데이트된 메시지 다시 조회
  const updatedMessage = await prisma.chatMessage.findUnique({
    where: { id: message.id },
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    },
  })

  return NextResponse.json(
    { ...updatedMessage, _taskUpdate: taskUpdate },
    { status: 201 }
  )
}

function fallbackClassify(text: string): string {
  if (/완료|끝|다 했/.test(text)) return "complete"
  if (/중지|멈춰|중단|보류/.test(text)) return "pause"
  if (/시작|진행|재개|다시/.test(text)) return "resume"
  return "none"
}

async function createNotification(userId: string, type: string, title: string, content: string, entityId: string) {
  await prisma.notification.create({
    data: { userId, type, title, content, entityId },
  })
}

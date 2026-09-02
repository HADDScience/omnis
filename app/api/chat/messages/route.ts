import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { auth } from "@/lib/auth"
import { rebuildTask } from "@/lib/ai"
import { persistMentions } from "@/lib/mentions"
import { syncEmbeddings, syncEmbeddingsSafe } from "@/lib/embeddings"
import { CHAT_PAGE_SIZE } from "@/lib/constants"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const roomId = searchParams.get("roomId")
  if (!roomId) return NextResponse.json({ error: "roomId 필수" }, { status: 400 })

  const after = searchParams.get("after")
  const before = searchParams.get("before")
  const taskId = searchParams.get("taskId")

  // after: 폴링(새 메시지) / before: 무한 스크롤(이전 메시지) / 둘 다 없음: 초기 로드(최신 페이지)
  const isPolling = !!after

  const messages = await prisma.chatMessage.findMany({
    where: {
      roomId,
      ...(taskId ? { taskId } : {}),
      ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    // 폴링은 오름차순 누적, 그 외에는 최신순 한 페이지를 가져온 뒤 뒤집어 반환
    orderBy: { createdAt: isPolling ? "asc" : "desc" },
    take: isPolling ? 200 : CHAT_PAGE_SIZE,
    include: {
      author: { select: { id: true, name: true } },
      // TASK_CREATED 메시지가 생성된 업무의 프리뷰 카드를 그릴 수 있도록 핵심 필드 포함
      task: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          priority: true,
          deadline: true,
          owner: { select: { id: true, name: true } },
          _count: { select: { checklists: true } },
        },
      },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    },
  })

  // 초기 로드·이전 메시지는 desc로 가져왔으므로 화면 표시용 오름차순으로 정렬
  return NextResponse.json(isPolling ? messages : messages.reverse())
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
  const { roomId, content, taskId, fileIds } = body

  if (!roomId || !content?.trim()) {
    return NextResponse.json({ error: "roomId, content 필수" }, { status: 400 })
  }

  const trimmedContent = content.trim()
  await prisma.chatRoom.upsert({
    where: { id: roomId },
    update: {},
    create: { id: roomId, name: roomId === "default-room" ? "하드사이언스 인턴방" : "새 채팅방" },
  })

  const mention = extractMentionSlug(trimmedContent)
  let linkedTaskId = taskId || null
  let taskUpdate: { action: string; statusLabel?: string; summary?: string; kind?: "TASK_REBUILT" | "TASK_DONE" | "TASK_DONE_PENDING" } | null = null

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

  {
    // 업무 해석: #슬러그 멘션 OR 스레드 연결(taskId). 스레드에서 쓴 메시지는 멘션 없어도 그 업무로 처리.
    const task = mention
      ? await prisma.task.findUnique({
          where: { slug: mention.slug },
          select: { id: true, name: true, status: true, background: true, expectedResult: true, ownerId: true, instructorId: true, slug: true },
        })
      : linkedTaskId
        ? await prisma.task.findUnique({
            where: { id: linkedTaskId },
            select: { id: true, name: true, status: true, background: true, expectedResult: true, ownerId: true, instructorId: true, slug: true },
          })
        : null
    const restText = mention ? mention.restText : trimmedContent

    if (task && restText.trim().length > 0) {
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
          })),
          session.user.id
        )

        if (result.action === "complete") {
          // AI가 완료를 추론해 DONE + 체크리스트 전부 체크로 확정하던 자리(인수인계 §4-3).
          // 실측상 완료 신호가 아예 없는 지시가 80%다 — 추론은 틀릴 때 조용히 틀린다.
          // 이제는 담당자에게 확인을 요청하고, 담당자가 누를 때까지 상태를 바꾸지 않는다.
          const asked = await requestDoneConfirmation(
            task,
            `${session.user.name}님이 업무를 마쳤다고 알렸습니다.`
          )
          if (asked !== "already_done") {
            taskUpdate = {
              action: "await_done_confirm",
              statusLabel: "완료 확인 대기",
              summary: `#${task.slug} 완료로 보입니다 — 담당자 확인을 기다립니다`,
              kind: "TASK_DONE_PENDING",
            }
          }

        } else if (result.action === "pause") {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: "TODO" },
          })
          taskUpdate = { action: "pause", statusLabel: "할 일", summary: `#${task.slug} 업무 '할 일'로 되돌림` }
          await createNotification(notifyUserId, "task_status_changed", "업무 보류", `${session.user.name}님이 #${task.slug} 업무를 '할 일'로 되돌렸습니다.`, task.id)

        } else if (result.action === "resume") {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: "IN_PROGRESS", workStart: new Date() },
          })
          taskUpdate = { action: "resume", statusLabel: "진행 중", summary: `#${task.slug} 업무 재개` }
          await createNotification(notifyUserId, "task_status_changed", "업무 재개", `${session.user.name}님이 #${task.slug} 업무를 재개했습니다.`, task.id)

        } else if (result.action === "rebuild") {
          // 업무 카드 전체 재구성
          const updateData: Record<string, unknown> = {}
          if (result.background) updateData.background = result.background
          if (result.expectedResult) updateData.expectedResult = result.expectedResult
          if (result.name) updateData.name = result.name
          if (result.priority && ["LOW", "NORMAL", "HIGH"].includes(result.priority)) {
            updateData.priority = result.priority
          }

          // 재구성(보고·피드백)은 곧 업무가 진행 중이라는 신호 → 진행 중이 아니면(할 일/검토/완료) '진행 중'으로 전진
          if (task.status !== "IN_PROGRESS") {
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

          // 체크리스트가 전부 체크됐다. 자동으로 DONE으로 넘기지 않고 담당자에게 묻는다.
          // 물어볼 자리를 따로 만들지 않는 것이 요점이다 — 마지막 항목이 체크되는 그 순간이 자리다(§4-2 보고).
          let awaitingDoneConfirm = false
          if (result.checklist && result.checklist.length > 0 && result.checklist.every((c) => c.done)) {
            const asked = await requestDoneConfirmation(task, "체크리스트가 모두 완료되었습니다.")
            awaitingDoneConfirm = asked !== "already_done"
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

          if (awaitingDoneConfirm) changes.push("완료 확인 대기")

          taskUpdate = {
            action: "rebuild",
            statusLabel: awaitingDoneConfirm ? "완료 확인 대기" : "업무 업데이트됨",
            summary: `#${task.slug} 재구성 · ${changes.join(" · ") || "내용 갱신"}`,
            kind: awaitingDoneConfirm ? "TASK_DONE_PENDING" : "TASK_REBUILT",
          }
          await createNotification(notifyUserId, "task_rebuilt", `업무 업데이트: #${task.slug}`, `${session.user.name}님의 메시지로 업무 카드가 재구성되었습니다.`, task.id)
        }
        // "info", "none"은 아무 동작 없음 (메시지만 연결됨)
      } else {
        // Gemini 없으면 fallback
        const action = fallbackClassify(restText)
        if (action === "complete") {
          // 정규식 한 줄로 완료를 확정하던 자리. AI 경로와 같은 이유로 확인 요청으로 바꾼다.
          const asked = await requestDoneConfirmation(task, `${session.user.name}님이 업무를 마쳤다고 알렸습니다.`)
          if (asked !== "already_done") {
            taskUpdate = {
              action: "await_done_confirm",
              statusLabel: "완료 확인 대기",
              summary: `#${task.slug} 완료로 보입니다 — 담당자 확인을 기다립니다`,
              kind: "TASK_DONE_PENDING",
            }
          }
        }
      }

      // 멘션으로 변경된 업무 카드·체크리스트를 임베딩에 반영
      await syncEmbeddingsSafe("TASK", task.id, session.user.id)
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
          kind: taskUpdate.kind ?? "NORMAL",
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

  // 채팅 메시지 임베딩은 백그라운드로 처리 — 메시지 전송 응답을 지연시키지 않음
  void syncEmbeddings("CHAT_MESSAGE", message.id, session.user.id).catch((err) =>
    console.error("[embeddings] 채팅 메시지 동기화 실패", err)
  )

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

/**
 * 완료를 '추론'해 상태를 바꾸는 대신 담당자에게 확인을 요청한다(인수인계 §4-3).
 * AI도 정규식도 "완료했습니다"를 완료로 확정하지 않는다 — 담당자가 누를 때 추측이 사실이 된다.
 */
async function requestDoneConfirmation(
  task: { id: string; name: string; slug: string; ownerId: string; status: string },
  reason: string
): Promise<"asked" | "already_asked" | "already_done"> {
  if (task.status === "DONE") return "already_done"
  const created = await createNotification(
    task.ownerId,
    "task_done_confirm",
    `완료 확인: ${task.name}`,
    `${reason} #${task.slug} 업무를 완료로 표시할까요?`,
    task.id,
    "confirm_done"
  )
  return created ? "asked" : "already_asked"
}

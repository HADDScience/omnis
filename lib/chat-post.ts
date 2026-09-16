// 채팅 메시지 게시 — 화면(app/api/chat/messages)과 MCP(omnis-hadd)가 같은 길을 쓴다.
//
// 이 파일이 옴니스의 유일한 "쓰기" 경로다. #슬러그 멘션·스레드 연결·AI 재구성·완료 확인
// 요청·알림·색인이 전부 여기서 일어난다. 라우트에서 그대로 옮겼고(2026-09-07), 달라진
// 것은 세션 대신 사용자를 인자로 받는 것뿐이다 — MCP 는 세션이 없다.
//
// 저장과 AI 재구성을 나눴다(2026-09-15). 재구성은 8~13초가 걸려 화면이 그동안 입력창을 막았다.
//   - postChatMessage: 저장 · 업무 연결 · 멘션까지만 하고, 재구성할 일이 있으면 rebuild 로 돌려준다
//   - runTaskRebuild: AI 재구성 · 상태 변경 · 알림 · 시스템 메시지. 끝나면 활동 기록을 남겨 화면이 끝났음을 안다
// 화면 경로는 응답 뒤(after)에 runTaskRebuild 를 돌리고, MCP 는 기다려서 결과를 글로 돌려준다.
import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { rebuildTask } from "@/lib/ai"
import { persistMentions } from "@/lib/mentions"
import { syncEmbeddings, syncEmbeddingsSafe } from "@/lib/embeddings"
import { getSystemUserId } from "@/lib/system-user"
import { writeActivity } from "@/lib/api"

export interface PostMessageInput {
  user: { id: string; name: string }
  roomId: string
  content: string
  taskId?: string | null
  fileIds?: string[]
  /** 답장 대상 메시지. 화면은 인용 한 줄로 그린다. */
  replyToId?: string | null
}

export interface PostMessageOptions {
  /** true 면 AI 재구성을 기다리지 않는다 — 돌려받은 rebuild 를 호출한 쪽이 응답 뒤에 runTaskRebuild 로 돌린다 */
  deferRebuild?: boolean
}

export type TaskUpdate = {
  action: string
  statusLabel?: string
  summary?: string
  kind?: "TASK_REBUILT" | "TASK_DONE" | "TASK_DONE_PENDING"
}

/** 응답 뒤에 돌릴 재구성 한 건 */
export interface RebuildJob {
  user: { id: string; name: string }
  roomId: string
  messageId: string
  messageCreatedAt: Date
  taskId: string
  restText: string
}

/** 재구성이 끝났다는 활동 기록 — GET /api/tasks/[taskId]/rebuild-status 가 읽는다 */
export const REBUILD_FINISHED_ACTION = "task.rebuild.finished"

const taskSelect = {
  id: true, name: true, status: true, background: true, expectedResult: true,
  assignees: { select: { userId: true } }, instructorId: true, slug: true,
} as const

function extractMentionSlug(content: string): { slug: string; restText: string } | null {
  const match = content.match(/#([a-z0-9가-힣_-]+)/i)
  if (!match) return null
  const slug = match[1]
  // 멘션 태그를 제거한 나머지 전체 텍스트 (앞 + 뒤)
  const restText = (content.slice(0, match.index!) + content.slice(match.index! + match[0].length)).trim()
  return { slug, restText }
}


export async function postChatMessage(input: PostMessageInput, options: PostMessageOptions = {}) {
  const { user, roomId, fileIds } = input
  const trimmedContent = input.content.trim()
  await prisma.chatRoom.upsert({
    where: { id: roomId },
    update: {},
    create: { id: roomId, name: roomId === "default-room" ? "하드사이언스 인턴방" : "새 채팅방" },
  })

  const mention = extractMentionSlug(trimmedContent)
  const linkedTaskId = input.taskId || null
  let taskUpdate: TaskUpdate | null = null
  let rebuild: RebuildJob | null = null

  // 먼저 메시지 저장 (즉시 응답을 위해)
  const message = await prisma.chatMessage.create({
    data: {
      roomId,
      authorId: user.id,
      content: trimmedContent,
      taskId: linkedTaskId,
      replyToId: input.replyToId ?? null,
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
    // 업무 해석: 스레드 연결(taskId)이 먼저, 없으면 #슬러그 멘션.
    // 스레드에서 다른 업무를 #멘션해도 그 업무로 옮겨 가지 않는다 — 스레드 안의 멘션은 참조다(2026-09-14).
    const threadTask = linkedTaskId ? await prisma.task.findUnique({ where: { id: linkedTaskId }, select: taskSelect }) : null
    const task = threadTask ?? (mention ? await prisma.task.findUnique({ where: { slug: mention.slug }, select: taskSelect }) : null)
    const restText = threadTask || !mention ? trimmedContent : mention.restText
    // 채팅에서 완료된 업무를 #멘션한 것은 참조다 — 메시지·파일만 잇고 AI 재구성·상태 변경은 하지 않는다.
    // 예전에는 재구성이 '완료'를 '진행 중'으로 되돌렸다. 완료된 업무의 스레드에 직접 쓴 글은 예전처럼 처리한다.
    const referenceOnly = !!task && !threadTask && task.status === "DONE"

    if (task && restText.trim().length > 0) {
      // 메시지를 업무에 연결
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: { taskId: task.id },
      })

      // 파일도 업무에 연결
      if (fileIds && fileIds.length > 0) {
        await prisma.file.updateMany({
          where: { id: { in: fileIds } },
          data: { taskId: task.id },
        })
      }

      // 참조만이면 메시지와 파일은 위에서 이미 이었다. 알림도 보내지 않는다(업무에 변화가 없다).
      if (!referenceOnly) {
        rebuild = {
          user,
          roomId,
          messageId: message.id,
          messageCreatedAt: message.createdAt,
          taskId: task.id,
          restText,
        }
      }
    } else if (task) {
      await prisma.chatMessage.update({ where: { id: message.id }, data: { taskId: task.id } })
    }
  }

  if (rebuild && !options.deferRebuild) {
    taskUpdate = await runTaskRebuild(rebuild)
    rebuild = null
  }

  // 업데이트된 메시지 다시 조회
  const updatedMessage = await prisma.chatMessage.findUnique({
    where: { id: message.id },
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
      // 보낸 직후에도 답장 인용이 보이게 — 폴링을 기다리지 않는다
      replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
    },
  })

  // 채팅 메시지 임베딩은 백그라운드로 처리 — 메시지 전송 응답을 지연시키지 않음
  void syncEmbeddings("CHAT_MESSAGE", message.id, user.id).catch((err) =>
    console.error("[embeddings] 채팅 메시지 동기화 실패", err)
  )


  return { message: updatedMessage, taskUpdate, rebuild }
}

/**
 * 업무 카드 AI 재구성 · 상태 변경 · 알림 · 시스템 메시지.
 * 던지지 않는다 — 응답 뒤에 돌 때 받아 줄 사람이 없다. 실패하면 스레드에 한 줄 남긴다.
 * 끝나면(변경 없음 · 실패 포함) 활동 기록을 남긴다. 화면은 그것으로 「갱신 중」 을 거둔다.
 */
export async function runTaskRebuild(job: RebuildJob): Promise<TaskUpdate | null> {
  const { user, roomId } = job
  let taskUpdate: TaskUpdate | null = null
  let outcome = "none"

  try {
    const task = await prisma.task.findUnique({ where: { id: job.taskId }, select: taskSelect })
    if (!task) {
      outcome = "task_missing"
      return null
    }

    // 담당자가 여러 명일 수 있다. 업무에 관련된 사람(담당자 전원 + 지시자) 중
    // 나를 뺀 나머지에게 알린다.
    const notifyUserIds = [
      ...new Set([...task.assignees.map((a) => a.userId), task.instructorId]),
    ].filter((id) => id !== user.id)

    if (process.env.GEMINI_API_KEY) {
      // 이 업무에 연결된 모든 메시지 + 파일 수집
      const allMessages = await prisma.chatMessage.findMany({
        // 지운 글은 넣지 않는다 — 지웠는데도 그 내용이 업무 카드에 남으면 지운 의미가 없다(2026-09-16)
        where: { taskId: task.id, deletedAt: null },
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
        user.id
      )

      // 기다리는 사이 같은 업무에 사람이 새 글을 썼다면, 그 글의 재구성이 이 글까지 읽고 반영한다.
      // 늦게 끝난 옛 결과로 새 결과를 덮지 않도록 여기서 멈춘다.
      const systemUserId = await getSystemUserId()
      const newer = await prisma.chatMessage.findFirst({
        where: {
          taskId: task.id,
          kind: "NORMAL",
          createdAt: { gt: job.messageCreatedAt },
          authorId: { not: systemUserId },
          id: { not: job.messageId },
        },
        select: { id: true },
      })
      if (newer) {
        outcome = "superseded"
        return null
      }

      outcome = result.action

      if (result.action === "complete") {
        // AI가 완료를 추론해 DONE + 체크리스트 전부 체크로 확정하던 자리(인수인계 §4-3).
        // 실측상 완료 신호가 아예 없는 지시가 80%다 — 추론은 틀릴 때 조용히 틀린다.
        // 이제는 담당자에게 확인을 요청하고, 담당자가 누를 때까지 상태를 바꾸지 않는다.
        const asked = await requestDoneConfirmation(
          task,
          `${user.name}님이 업무를 마쳤다고 알렸습니다.`
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
        await notifyAll(notifyUserIds, "task_status_changed", "업무 보류", `${user.name}님이 #${task.slug} 업무를 '할 일'로 되돌렸습니다.`, task.id)

      } else if (result.action === "resume") {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "IN_PROGRESS", workStart: new Date() },
        })
        taskUpdate = { action: "resume", statusLabel: "진행 중", summary: `#${task.slug} 업무 재개` }
        await notifyAll(notifyUserIds, "task_status_changed", "업무 재개", `${user.name}님이 #${task.slug} 업무를 재개했습니다.`, task.id)

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
        await notifyAll(notifyUserIds, "task_rebuilt", `업무 업데이트: #${task.slug}`, `${user.name}님의 메시지로 업무 카드가 재구성되었습니다.`, task.id)
      }
      // "info", "none"은 아무 동작 없음 (메시지만 연결됨)
    } else {
      // Gemini 없으면 fallback
      const action = fallbackClassify(job.restText)
      outcome = `fallback_${action}`
      if (action === "complete") {
        // 정규식 한 줄로 완료를 확정하던 자리. AI 경로와 같은 이유로 확인 요청으로 바꾼다.
        const asked = await requestDoneConfirmation(task, `${user.name}님이 업무를 마쳤다고 알렸습니다.`)
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
    await syncEmbeddingsSafe("TASK", task.id, user.id)

    // Gemini 판단 결과를 시스템 메시지로 DB에 저장.
    // 작성자는 시스템 계정이다 — 예전에는 정렬 없는 첫 ADMIN 이라 업무와 무관한 관리자 이름이 찍혔다(lib/system-user.ts).
    if (taskUpdate) {
      await prisma.chatMessage.create({
        data: {
          roomId,
          authorId: await getSystemUserId(),
          content: `🤖 ${taskUpdate.summary || taskUpdate.statusLabel || "업무 업데이트"}`,
          taskId: job.taskId,
          kind: taskUpdate.kind ?? "NORMAL",
        },
      })
    }
    return taskUpdate
  } catch (err) {
    outcome = "failed"
    console.error("[chat-post] 업무 재구성 실패", { taskId: job.taskId, messageId: job.messageId, err })
    // 응답은 이미 나갔다 — 사람이 알 수 있게 스레드에 남긴다
    await prisma.chatMessage
      .create({
        data: {
          roomId,
          authorId: await getSystemUserId(),
          content: "🤖 업무 갱신에 실패했습니다 — 잠시 뒤 다시 한 번 적어 주세요",
          taskId: job.taskId,
        },
      })
      .catch(() => {})
    return null
  } finally {
    await writeActivity({
      userId: user.id,
      action: REBUILD_FINISHED_ACTION,
      entity: "task",
      entityId: job.taskId,
      title: `업무 갱신 · ${outcome}`,
      metadata: { messageId: job.messageId, outcome },
    })
  }
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
  task: { id: string; name: string; slug: string; assignees: { userId: string }[]; status: string },
  reason: string
): Promise<"asked" | "already_asked" | "already_done"> {
  if (task.status === "DONE") return "already_done"
  // 담당자가 여러 명이면 전원에게 묻는다. 한 명만 물으면 나머지는 완료 사실을 모른다.
  const results = await Promise.all(
    task.assignees.map((a) =>
      createNotification(
        a.userId,
        "task_done_confirm",
        `완료 확인: ${task.name}`,
        `${reason} #${task.slug} 업무를 완료로 표시할까요?`,
        task.id,
        "confirm_done"
      ),
    ),
  )
  return results.some(Boolean) ? "asked" : "already_asked"
}

/** 여러 사람에게 같은 알림을 보낸다. 담당자가 여러 명일 수 있어 필요해졌다. */
async function notifyAll(
  userIds: string[],
  type: string,
  title: string,
  content: string,
  entityId: string,
) {
  await Promise.all(userIds.map((id) => createNotification(id, type, title, content, entityId)))
}

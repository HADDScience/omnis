import { auth } from "@/lib/auth"
import { NOT_EXTERNAL_WHERE } from "@/lib/external-speaker"
import { visibleMessageWhere } from "@/lib/chat-rooms"
import { visibleFileWhere } from "@/lib/file-access"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { TaskDetail } from "./task-detail"
import { StartWithOmnis } from "@/components/tasks/start-with-omnis"
import { RegisterPanelTask } from "@/components/layout/right-panel-context"
import { CHAT_DELETED_TEXT } from "@/lib/constants"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ taskId: string }>
}

export default async function TaskDetailPage({ params }: Props) {
  const session = await auth()
  if (!session?.user?.id) notFound()
  const { taskId } = await params

  const [task, feedbackMessages, files, projects, users] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: { select: { user: { select: { id: true, name: true } } } },
        instructor: { select: { id: true, name: true } },
        checklists: { orderBy: [{ done: "asc" }, { createdAt: "asc" }] },
        project: {
          select: {
            id: true,
            name: true,
            product: { select: { id: true, name: true, color: true } },
          },
        },
      },
    }),
    prisma.chatMessage.findMany({
      // 참여자 전용 방의 글이 카드에 연결돼도 그 방 사람에게만
      where: { taskId, ...NOT_EXTERNAL_WHERE, ...visibleMessageWhere(session.user.id) },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true } },
        // 참여자 전용 방의 글이 카드에 연결돼도 첨부는 그 방 사람에게만(lib/file-access.ts)
        files: { where: visibleFileWhere(session.user.id), select: { id: true, name: true, path: true, size: true, mimeType: true } },
        replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
      },
    }),
    prisma.file.findMany({
      where: { taskId, ...visibleFileWhere(session.user.id) },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, path: true, size: true, mimeType: true, createdAt: true },
    }),
    prisma.project.findMany({
      where: { archived: false },
      select: {
        id: true,
        name: true,
        product: { select: { id: true, name: true, color: true } },
      },
    }),
    // 담당자·지시자를 고칠 때 고를 사람들. 🤖 시스템 계정과 퇴사자는 뺀다 — 이 업무에 이미 걸린 퇴사자는 화면이 붙여 준다
    prisma.user.findMany({
      where: { id: { not: SYSTEM_USER_ID }, ...ACTIVE_MEMBER_WHERE },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  if (!task) notFound()

  const serialized = {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deadline: task.deadline?.toISOString() ?? null,
    workStart: task.workStart?.toISOString() ?? null,
    workEnd: task.workEnd?.toISOString() ?? null,
    // 조인 테이블 모양을 화면이 쓰기 좋은 {id, name}[] 으로 편다
    assignees: task.assignees.map((a) => a.user),
    checklists: task.checklists.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    feedbackMessages: feedbackMessages.map((m) => ({
      id: m.id,
      content: m.content,
      author: m.author,
      isTaskInstruction: m.isTaskInstruction,
      createdAt: m.createdAt.toISOString(),
    })),
    files: files.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
    })),
  }

  // 지운 글은 자리만 남긴다 — 본문과 첨부는 넘기지 않는다(채팅 목록 API 와 같은 규칙)
  const sidebarMessages = feedbackMessages.map((m) => ({
    id: m.id,
    content: m.deletedAt ? CHAT_DELETED_TEXT : m.content,
    createdAt: m.createdAt.toISOString(),
    author: { id: m.author.id, name: m.author.name },
    isTaskInstruction: m.isTaskInstruction,
    kind: m.kind,
    files: m.deletedAt ? [] : m.files,
    editedAt: m.editedAt?.toISOString() ?? null,
    changedAt: m.changedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: m.replyTo.author.name,
          content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : m.replyTo.content.slice(0, 80),
        }
      : null,
  }))

  return (
    <>
      <Header title={task.name} />
      {/* 스레드는 오른쪽 패널이 맡는다. 여기서 자리를 차지하지 않는다 —
          예전에는 320px 을 고정으로 먹어 좁은 화면에서 본문이 34px 로 눌렸다.
          md 미만에는 패널이 없어 그 업무방으로 가는 링크를 둔다 */}
      <RegisterPanelTask id={task.id} name={task.name} messages={sidebarMessages} />
      <div className="flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          <Link
            href={`/chat/task/${task.id}`}
            data-task-room-link
            className="touch-target mx-4 mt-3 flex items-center justify-center rounded-xl border bg-card px-4 py-2.5 text-[14px] font-medium md:hidden"
          >
            이 업무 대화 보기
          </Link>
          {/* 옴니스 새 대화로 이 업무를 이어 간다 — 확인 한 번 뒤 첫 글이 저절로 보내진다(components/tasks/start-with-omnis.tsx) */}
          <div className="mx-auto w-full max-w-3xl px-4 pt-3">
            <StartWithOmnis
              task={{
                id: task.id,
                slug: task.slug,
                name: task.name,
                background: task.background,
                expectedResult: task.expectedResult,
                openChecklist: task.checklists.filter((c) => !c.done).map((c) => c.name),
              }}
            />
          </div>
          <TaskDetail task={serialized} projects={projects} users={users} />
        </div>
      </div>
    </>
  )
}

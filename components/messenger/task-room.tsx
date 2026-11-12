"use client"

import { TASK_STATUS_LABELS } from "@/lib/constants"
import type { TaskRoomData } from "@/lib/chat-task-room"
import { TaskThread } from "@/app/(main)/tasks/[taskId]/task-sidebar"
import { RoomHeader } from "./room-header"
import { RoomMuteButton } from "./room-mute-button"

/**
 * 업무방 화면 — 머리줄 + 업무 스레드(TaskThread). 메신저 업무방 페이지와 오른쪽 패널이 같이 쓴다.
 * onChanged 를 주면 글이 바뀐 뒤 서버 페이지를 다시 그리는 대신 그것을 부른다(패널은 본문이 다른 화면이다)
 */
export function TaskRoom({ room, currentUserId, onChanged }: { room: TaskRoomData; currentUserId: string; onChanged?: () => void }) {
  const { task, messages, muted } = room
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader
        title={<><span className="mr-0.5 text-muted-foreground">#</span>{task.name}</>}
        subtitle={`업무방 · ${TASK_STATUS_LABELS[task.status] ?? task.status} · 글을 남기면 옴니스가 업무 카드를 갱신합니다`}
        actions={<RoomMuteButton roomKey={`task:${task.id}`} initialMuted={muted} />}
        link={{ href: `/tasks/${task.id}`, label: "업무 열기" }}
        roomKey={`task:${task.id}`}
      />
      <div className="min-h-0 flex-1">
        <TaskThread key={task.id} roomKey={`task:${task.id}`} taskId={task.id} taskName={task.name} messages={messages} currentUserId={currentUserId} onChanged={onChanged} />
      </div>
    </div>
  )
}

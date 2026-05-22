"use client"

import { TaskCmdModalV2 } from "./task-cmd-modal-v2"

interface TaskCmdModalProps {
  open: boolean
  rawCommand: string
  onClose: () => void
}

/**
 * 라우터 — V1 prompt 기반 모달은 TaskAiDraftSchema와 맞지 않아 폐기.
 * v2: 인라인 폼 (rhf+zod, dirtyFields 보존, #전체 게시 폐기)
 */
export function TaskCmdModal(props: TaskCmdModalProps) {
  return <TaskCmdModalV2 {...props} />
}

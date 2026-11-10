// 메신저 목록의 내 설정 API 를 부르는 곳 — 목록(room-list)과 폴더 관리(folder-manager)가 같이 쓴다.
import { apiUrl } from "@/lib/base-path"
import type { ChatFolderView } from "@/lib/chat-list"
import type { CreateFolderInput } from "@/lib/schemas/chat-folder"

async function call<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? `요청이 실패했습니다 (${res.status})`)
  return body as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const chatPrefs = {
  markRead: (roomKey: string) => call("/api/chat/prefs", json("PATCH", { roomKey, read: true })),
  setFavorite: (roomKey: string, favorite: boolean) => call("/api/chat/prefs", json("PATCH", { roomKey, favorite })),
  /** 이 방의 채팅 푸시 끄기 · 켜기 — 멘션 푸시와 벨은 그대로 */
  setMuted: (roomKey: string, muted: boolean) => call<{ muted: boolean }>("/api/chat/prefs", json("PATCH", { roomKey, muted })),
  /** 옴니스 1:1 = 대화 삭제 · 사람 1:1 = 목록에서 숨기기(서버가 방 종류를 본다) */
  hide: (roomKey: string) => call("/api/chat/prefs", json("PATCH", { roomKey, hidden: true })),
  /** 단톡방 나가기 */
  leaveGroup: (roomId: string) => call(`/api/chat/people-rooms/${roomId}/members`, { method: "DELETE" }),
  createFolder: (input: CreateFolderInput) => call<ChatFolderView>("/api/chat/folders", json("POST", input)),
  reorderFolders: (order: string[]) => call("/api/chat/folders", json("PATCH", { order })),
  renameFolder: (id: string, name: string) => call(`/api/chat/folders/${id}`, json("PATCH", { name })),
  deleteFolder: (id: string) => call(`/api/chat/folders/${id}`, { method: "DELETE" }),
  addToFolder: (id: string, roomKey: string) => call(`/api/chat/folders/${id}/rooms`, json("POST", { roomKey })),
  /** 프로젝트 폴더를 고를 때 — 보관하지 않은 프로젝트(업무 탭과 같은 /api/projects) */
  projects: () => call<{ id: string; name: string; status: string }[]>("/api/projects"),
  removeFromFolder: (id: string, roomKey: string) =>
    call(`/api/chat/folders/${id}/rooms?roomKey=${encodeURIComponent(roomKey)}`, { method: "DELETE" }),
}

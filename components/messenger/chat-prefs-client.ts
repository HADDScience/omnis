// 메신저 목록의 내 설정 API 를 부르는 곳 — 목록(room-list)과 폴더 관리(folder-manager)가 같이 쓴다.
import { apiUrl } from "@/lib/base-path"
import type { ChatFolderView, FolderRule } from "@/lib/chat-list"

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
  createFolder: (input: { name: string } | { rule: FolderRule }) => call<ChatFolderView>("/api/chat/folders", json("POST", input)),
  reorderFolders: (order: string[]) => call("/api/chat/folders", json("PATCH", { order })),
  renameFolder: (id: string, name: string) => call(`/api/chat/folders/${id}`, json("PATCH", { name })),
  deleteFolder: (id: string) => call(`/api/chat/folders/${id}`, { method: "DELETE" }),
  addToFolder: (id: string, roomKey: string) => call(`/api/chat/folders/${id}/rooms`, json("POST", { roomKey })),
  removeFromFolder: (id: string, roomKey: string) =>
    call(`/api/chat/folders/${id}/rooms?roomKey=${encodeURIComponent(roomKey)}`, { method: "DELETE" }),
}

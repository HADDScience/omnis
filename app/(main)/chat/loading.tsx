import { CachedRoomPreview } from "@/components/messenger/cached-room-preview"

// 방 loading.tsx 를 미리 받기 전에 방으로 옮길 때 이 칸이 먼저 뜬다 — 방 주소면 입장 화면(머리 · 입력창 바로), 아니면 스켈레톤
export default function Loading() {
  return <CachedRoomPreview />
}

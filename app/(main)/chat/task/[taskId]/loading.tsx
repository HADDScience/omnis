import { CachedRoomPreview } from "@/components/messenger/cached-room-preview"

// 업무방을 여는 동안 — 머리 · 입력창은 바로, 글 칸만 불러오는 중(방 화면 loading 과 같다)
export default function Loading() {
  return <CachedRoomPreview />
}

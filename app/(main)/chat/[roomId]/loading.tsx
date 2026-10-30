import { CachedRoomPreview } from "@/components/messenger/cached-room-preview"

// 방을 여는 동안 — 머리 · 입력창은 바로 쓸 수 있게, 글 칸은 기기에 저장해 둔 최근 글 또는 스켈레톤(2026-10-30)
export default function Loading() {
  return <CachedRoomPreview />
}

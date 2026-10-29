import { CachedRoomPreview } from "@/components/messenger/cached-room-preview"

// 방을 여는 동안 — 기기에 저장해 둔 최근 글이 있으면 그것으로 바로, 없으면 스켈레톤(2026-10-29 「빠르게 느껴지게」)
export default function Loading() {
  return <CachedRoomPreview />
}

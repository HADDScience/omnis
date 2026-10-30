// 옴니스 1:1 방의 파일 — 방 주인만 목록 · 내려받기.
//
// 옴니스가 만든 파일(lib/agent/outputs.ts)은 옴니스 방의 옴니스 글(ChatMessage)에 붙는다 — File.messageId → 방(OMNIS_DM) → 참여자(방 주인 한 명).
// 소유자 · 방은 이 연결로 남는다. 스키마를 고치지 않았다.
//
// 이 파일은 **최소한의 막음**이다. 파일 접근 판정 전체(사람 방 첨부 · 업무 첨부 · 검색)는 feat/omnis-attach 가 만든다.
// 합칠 때 그 판정이 OMNIS_DM 을 다루면 이 파일을 지우고 부르는 곳(아래)을 그 판정으로 바꾼다 —
// mydocs/working/2026-10-30-omnis-outputs.md 「합칠 때 할 일」.
//   부르는 곳: app/api/files/route.ts(목록) · app/api/files/[fileId]/route.ts · app/api/files/[fileId]/raw/route.ts · lib/omnis-mcp.ts read_file
import type { Prisma } from "@/generated/prisma/client"

/** 옴니스 1:1 방 글에 붙은 파일 */
export const OMNIS_ROOM_FILE = { message: { is: { room: { kind: "OMNIS_DM" } } } } satisfies Prisma.FileWhereInput

/** 최근 파일 목록(GET /api/files)에서 뺀다 — 방을 가리지 않는 목록이라 주인에게도 보이지 않게 둔다(첨부 고르기에서 옮겨 붙이면 방 밖으로 나간다) */
export const NOT_OMNIS_ROOM_FILE = { NOT: OMNIS_ROOM_FILE } satisfies Prisma.FileWhereInput

/** 순수 판정 — 파일이 붙은 방이 옴니스 1:1 이면 그 방 참여자만. 그 밖의 파일은 여기서 판정하지 않는다(지금 규칙 그대로) */
export function canOpenRoomFile(room: { kind: string; memberIds: string[] } | null, userId: string): boolean {
  if (!room || room.kind !== "OMNIS_DM") return true
  return room.memberIds.includes(userId)
}

/** 이 사람이 열 수 없는 옴니스 방 파일인가. 라우트는 true 면 404(있는지도 알리지 않는다) */
export async function omnisRoomFileBlocked(fileId: string, userId: string): Promise<boolean> {
  const { prisma } = await import("@/lib/db")
  const f = await prisma.file.findUnique({
    where: { id: fileId },
    select: { message: { select: { room: { select: { kind: true, members: { select: { userId: true } } } } } } },
  })
  const room = f?.message?.room
  return !canOpenRoomFile(room ? { kind: room.kind, memberIds: room.members.map((m) => m.userId) } : null, userId)
}

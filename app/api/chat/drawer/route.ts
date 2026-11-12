import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { drawerGate, listDrawerFiles, listDrawerLinks, listDrawerMembers } from "@/lib/room-drawer-server"
import { isDrawerKind, isDrawerPeriod } from "@/lib/room-drawer"

/**
 * 방 서랍 — 사진 · 파일 · 링크 · 참여자(components/messenger/room-drawer.tsx).
 *   GET ?roomId=&tab=photos|files&period=week|month|all&kind=&before=  → { files, nextBefore, missing }
 *   GET ?roomId=&tab=links&period=&before=                            → { links, nextBefore }
 *   GET ?roomId=&tab=members                                          → { members }
 * 방은 채팅 글과 같은 권한(전사방은 구성원 모두, 나머지는 참여자), 파일은 canSeeFile.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const userId = session.user.id
  const q = req.nextUrl.searchParams
  const roomId = q.get("roomId")
  if (!roomId) return NextResponse.json({ error: "roomId 필수" }, { status: 400 })
  const gate = await drawerGate(roomId, userId)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const tab = q.get("tab") ?? "photos"
  const period = q.get("period") ?? "all"
  const kind = q.get("kind") ?? "all"
  const before = q.get("before")
  if (!isDrawerPeriod(period) || !isDrawerKind(kind) || (before && Number.isNaN(Date.parse(before)))) {
    return NextResponse.json({ error: "필터가 올바르지 않습니다" }, { status: 400 })
  }
  const headers = { "Cache-Control": "private, no-store" }
  if (tab === "photos" || tab === "files") {
    return NextResponse.json(await listDrawerFiles({ roomId, userId, tab, period, kind, before }), { headers })
  }
  if (tab === "links") return NextResponse.json(await listDrawerLinks({ roomId, period, before }), { headers })
  if (tab === "members") return NextResponse.json({ members: await listDrawerMembers(roomId, gate.kind) }, { headers })
  return NextResponse.json({ error: "알 수 없는 탭" }, { status: 400 })
}

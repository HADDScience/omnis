"use client"

import { useEffect, useMemo, useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ChatPanel } from "@/components/chat/chat-panel"
import { AuthorAvatar } from "@/components/chat/message-parts"
import { apiUrl } from "@/lib/base-path"
import { PEOPLE_ROOM_NAME_MAX } from "@/lib/chat-people-rules"
import type { PeopleRoomView } from "@/lib/chat-people"
import { writeSnapshotPeople } from "@/lib/room-snapshot"
import { RoomHeader } from "./room-header"
import { RoomMuteButton } from "./room-mute-button"
import { PeoplePicker, type Person } from "./people-picker"
import { useRoomListReload } from "./messenger-shell"
import { usePanelNav } from "./messenger-context"

type Messages = ComponentProps<typeof ChatPanel>["initialMessages"]

/**
 * 사람끼리 방 — 1:1 · 단톡방. 대화 칸은 전사방과 같은 ChatPanel(폴링 · 검색 · 답장 · 고치기)을 쓰고,
 * @ 후보를 참여자로 좁히고 업무 명령 · 첨부를 끈다(people). 옴니스는 이 방에 없다.
 * 단톡방은 머리의 참여자 버튼에서 초대 · 이름 바꾸기 · 나가기. 1:1 에는 그 버튼이 없다.
 */
export function PeopleRoom({
  room: initialRoom,
  currentUserId,
  initialMessages,
  resume,
  muted,
  live,
}: {
  room: PeopleRoomView
  currentUserId: string
  initialMessages: Messages
  /** initialMessages 가 반영한 서버 시각 — ChatPanel 이 비우지 않고 그 뒤의 변경만 받는다 */
  resume?: ComponentProps<typeof ChatPanel>["resume"]
  /** 이 방의 채팅 푸시를 껐는가 */
  muted: boolean
  /** 서버 페이지 없이 그린 방(client-room.tsx) */
  live?: ComponentProps<typeof ChatPanel>["live"]
}) {
  const [room, setRoom] = useState(initialRoom)
  const [searchOpen, setSearchOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const group = room.kind === "GROUP"

  async function refresh() {
    const res = await fetch(apiUrl(`/api/chat/people-rooms/${room.id}`))
    if (res.ok) {
      setRoom(await res.json())
    } else if (res.status === 403 || res.status === 404) live?.onRoomGone()
  }

  // 머리줄 · @ 후보도 저장본에 둔다 — 다음에 열 때 단톡방 참여자 수가 비어 보이지 않게. 아직 모르면(처음 여는 방) 쓰지 않는다
  useEffect(() => {
    if (room.members.length > 0) void writeSnapshotPeople(currentUserId, `room:${room.id}`, room)
  }, [room, currentUserId])

  // 서버 페이지 없이 그렸으면 참여자는 저장본이나 목록이 아는 만큼이다 — 받아 온다
  const liveRoom = !!live
  useEffect(() => {
    if (liveRoom) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRoom])

  // @ 후보 — 참여자 뒤에 옴니스. 고르면 「@옴니스 」 가 들어가고, 그 뒤 글로 옴니스 세션이 열린다(lib/omnis-mention.ts)
  const mentionables = useMemo(() => ({ members: [...room.activeMembers, { id: "omnis", name: "옴니스" }] }), [room.activeMembers])

  return (
    <div data-chat-room-chrome className="relative flex min-h-0 flex-1 flex-col">
      <RoomHeader
        capsule
        title={room.title}
        subtitle={room.self ? "나만 보는 방이에요 · 메모와 파일을 남겨 두세요" : group ? `단톡방 · ${room.members.length}명 · 참여자만 보여요` : "1:1 대화 · 두 사람만 보여요"}
        actions={
          <>
            {/* 나와의 대화에는 받을 알림이 없다 */}
            {!room.self && <RoomMuteButton roomKey={`room:${room.id}`} initialMuted={muted} />}
            <Button
              variant="ghost"
              size="icon-sm"
              className="touch-target"
              aria-label="채팅 검색"
              aria-pressed={searchOpen}
              title="채팅 검색"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <HugeiconsIcon icon={Search01Icon} size={15} aria-hidden />
            </Button>
            {group && (
              <Button
                variant="ghost"
                size="sm"
                className="touch-target gap-1 text-[12px]"
                aria-label={`참여자 ${room.members.length}명`}
                title="참여자 · 초대 · 나가기"
                onClick={() => setMembersOpen(true)}
              >
                <HugeiconsIcon icon={UserGroupIcon} size={15} aria-hidden />
                <span className="tabular-nums">{room.members.length}</span>
              </Button>
            )}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatPanel
          roomId={room.id}
          live={live}
          initialMessages={initialMessages}
          resume={resume}
          currentUserId={currentUserId}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          people={mentionables}
          handoffKey={`room:${room.id}`}
        />
      </div>
      {group && (
        <MembersDialog
          open={membersOpen}
          onOpenChange={setMembersOpen}
          room={room}
          currentUserId={currentUserId}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

function MembersDialog({
  open,
  onOpenChange,
  room,
  currentUserId,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  room: PeopleRoomView
  currentUserId: string
  onChanged: () => Promise<void>
}) {
  const router = useRouter()
  const reloadList = useRoomListReload()
  const panel = usePanelNav()
  const [view, setView] = useState<"list" | "invite">("list")
  const [picked, setPicked] = useState<Person[]>([])
  const [name, setName] = useState(room.name)
  const [busy, setBusy] = useState<"invite" | "rename" | "leave" | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)

  async function call(kind: "invite" | "rename" | "leave", url: string, init: RequestInit) {
    setBusy(kind)
    try {
      const res = await fetch(apiUrl(url), { headers: { "Content-Type": "application/json" }, ...init })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "처리하지 못했어요")
      return data
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "처리하지 못했어요")
      return null
    } finally {
      setBusy(null)
    }
  }

  async function invite() {
    const data = await call("invite", `/api/chat/people-rooms/${room.id}/members`, {
      method: "POST",
      body: JSON.stringify({ userIds: picked.map((p) => p.id) }),
    })
    if (!data) return
    toast.success(`${picked.map((p) => p.name).join(", ")}님을 초대했어요`)
    setPicked([])
    setView("list")
    await onChanged()
    reloadList()
  }

  async function rename() {
    if (!name.trim() || name.trim() === room.name) return
    const data = await call("rename", `/api/chat/people-rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ name }) })
    if (!data) return
    toast.success("방 이름을 바꿨어요")
    await onChanged()
    reloadList()
  }

  async function leave() {
    const data = await call("leave", `/api/chat/people-rooms/${room.id}/members`, { method: "DELETE" })
    if (!data) return
    setLeaveOpen(false)
    onOpenChange(false)
    toast.success(`「${room.title}」 에서 나왔어요`)
    reloadList()
    if (panel) panel.back()
    else router.push("/chat")
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o)
          if (!o) {
            setView("list")
            setPicked([])
          }
        }}
      >
        <DialogContent className="flex max-h-[min(640px,calc(var(--app-vh)-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          {view === "list" ? (
            <>
              <DialogHeader className="border-b p-4 pr-12">
                <DialogTitle>참여자 {room.members.length}명</DialogTitle>
                <DialogDescription className="text-[12px]">이 방의 글은 여기 있는 사람만 봐요. 나가면 목록에서 사라져요.</DialogDescription>
              </DialogHeader>
              <div className="shrink-0 border-b px-4 py-3">
                <label className="block">
                  <span className="mb-1 block text-[11.5px] text-muted-foreground">방 이름</span>
                  <span className="flex gap-1.5">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={PEOPLE_ROOM_NAME_MAX}
                      aria-label="방 이름"
                      className="touch-target h-8 min-w-0 flex-1 text-[13px]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="touch-target shrink-0"
                      disabled={!name.trim() || name.trim() === room.name || busy !== null}
                      onClick={() => void rename()}
                    >
                      {busy === "rename" && <Spinner className="size-3.5" />}
                      바꾸기
                    </Button>
                  </span>
                </label>
              </div>
              <ul aria-label="참여자" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
                {room.members.map((m) => (
                  <li key={m.id} className="flex min-h-11 items-center gap-2.5 px-2 py-1">
                    <AuthorAvatar name={m.name} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{m.name}</span>
                    {m.id === currentUserId && <span className="shrink-0 text-[11px] text-muted-foreground">나</span>}
                  </li>
                ))}
              </ul>
              <div className="flex shrink-0 gap-2 border-t p-3">
                <Button
                  variant="outline"
                  className="touch-target flex-1 text-destructive hover:text-destructive"
                  disabled={busy !== null}
                  onClick={() => setLeaveOpen(true)}
                >
                  나가기
                </Button>
                <Button className="touch-target flex-1" disabled={busy !== null} onClick={() => setView("invite")}>
                  초대하기
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader className="border-b p-4 pr-12">
                <DialogTitle>초대할 사람</DialogTitle>
                <DialogDescription className="text-[12px]">초대한 사람은 지금까지의 대화도 볼 수 있어요.</DialogDescription>
              </DialogHeader>
              <PeoplePicker
                meId={currentUserId}
                exclude={room.members.map((m) => m.id)}
                selected={picked}
                onChange={setPicked}
                autoFocus
              />
              <div className="flex shrink-0 gap-2 border-t p-3">
                <Button variant="outline" className="touch-target flex-1" disabled={busy !== null} onClick={() => setView("list")}>
                  뒤로
                </Button>
                <Button className="touch-target flex-1" disabled={picked.length === 0 || busy !== null} onClick={() => void invite()}>
                  {busy === "invite" && <Spinner className="size-3.5" />}
                  {picked.length > 0 ? `${picked.length}명 초대` : "사람을 골라 주세요"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{room.title}」 에서 나갈까요?</AlertDialogTitle>
            <AlertDialogDescription>
              내 목록에서 이 방과 즐겨찾기 · 폴더 표시가 사라지고 더는 글을 볼 수 없어요. 남은 사람들의 대화는 그대로예요. 다시 들어오려면 참여자가 초대해야 해요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "leave"}>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy === "leave"}
              onClick={(e) => {
                e.preventDefault()
                void leave()
              }}
            >
              {busy === "leave" && <Spinner className="size-3.5" />}
              나가기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

"use client"

// 채팅방의 사진 뷰어 — 말풍선 사진을 누르면 연다. 열린 사진은 주소 ?photo= 에 남아 새로고침 · 공유 링크로 다시 열린다.
// 뒤로 가기(브라우저 · iOS 밀기)는 뷰어만 닫는다 — 열 때 기록을 하나 쌓는다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { apiUrl } from "@/lib/base-path"
import { isViewerImage, PHOTO_PARAM, withPhotoParam, type ViewerPhoto } from "@/lib/photo-viewer"
import { PhotoViewer } from "@/components/photo-viewer/photo-viewer"
import { PhotoViewerContext } from "@/components/photo-viewer/context"
import { RoomPhotoGrid, type RoomPhoto } from "@/components/photo-viewer/room-photo-grid"
import { RoomDrawer } from "@/components/messenger/room-drawer"
import { RoomDownloadContext } from "@/components/messenger/room-download-context"
import type { DrawerTab } from "@/lib/room-drawer"

/** 방 서랍 — 전사 · 사람 방만 준다. 없으면(업무 스레드) 뷰어의 모아보기가 예전 격자로 연다 */
export interface DrawerControl {
  roomName: string
  open: boolean
  tab: DrawerTab
  onOpen: (tab: DrawerTab) => void
  onClose: () => void
}

interface ViewerMessage {
  id: string
  content: string
  createdAt: string
  author: { id: string; name: string }
  deletedAt?: string | null
  _isSystem?: boolean
  files?: { id: string; name: string; mimeType: string; size: number; _uploading?: boolean }[]
}

const HISTORY_MARK = "__photoViewer"
const raw = (fileId: string) => apiUrl(`/api/files/${fileId}/raw`)

export function ChatPhotoViewer({
  roomId,
  messages,
  currentUserId,
  onGoToMessage,
  onDelete,
  onNeedMessage,
  drawer,
  children,
}: {
  roomId: string
  messages: ViewerMessage[]
  currentUserId: string
  /** 그 글로 가서 튕긴다(검색 결과로 가는 것과 같다) */
  onGoToMessage: (messageId: string) => void
  onDelete: (messageId: string) => Promise<void>
  /** 주소로 연 사진의 글이 아직 목록에 없으면 그 자리를 불러온다 */
  onNeedMessage: (messageId: string) => void
  drawer?: DrawerControl
  children: ReactNode
}) {
  const [view, setView] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)
  const [gallery, setGallery] = useState(false)
  const pending = useRef<string | null>(null)
  const pushed = useRef(false)
  const latest = useRef<(messageId: string, fileId: string, mode: "push" | "replace") => boolean>(() => false)

  const photosOf = useCallback(
    (m: ViewerMessage): ViewerPhoto[] =>
      (m.files ?? [])
        .filter((f) => !f._uploading && isViewerImage(f))
        .map((f) => ({
          fileId: f.id,
          name: f.name,
          original: raw(f.id),
          messageId: m.id,
          authorName: m.author.name,
          createdAt: m.createdAt,
          canDelete: m.author.id === currentUserId && !m.deletedAt && !m._isSystem && !m.content.startsWith("__") && !m.content.startsWith("🤖"),
        })),
    [currentUserId],
  )

  const setUrl = useCallback((fileId: string | null, mode: "push" | "replace") => {
    const href = withPhotoParam(window.location.href, fileId)
    if (mode === "push") {
      window.history.pushState({ ...window.history.state, [HISTORY_MARK]: true }, "", href)
      pushed.current = true
    } else {
      window.history.replaceState(window.history.state, "", href)
    }
  }, [])

  const showMessagePhoto = useCallback(
    (messageId: string, fileId: string, mode: "push" | "replace") => {
      const m = messages.find((x) => x.id === messageId)
      const photos = m ? photosOf(m) : []
      const index = photos.findIndex((p) => p.fileId === fileId)
      if (index < 0) return false
      setView({ photos, index })
      setUrl(fileId, mode)
      return true
    },
    [messages, photosOf, setUrl],
  )

  useEffect(() => {
    latest.current = showMessagePhoto
  })

  const open = useCallback((messageId: string, fileId: string) => void showMessagePhoto(messageId, fileId, view ? "replace" : "push"), [showMessagePhoto, view])

  /** 닫기 — 쌓은 기록이 있으면 뒤로(popstate 가 화면을 닫는다), 없으면 주소만 지운다 */
  const close = useCallback(() => {
    setGallery(false)
    if (pushed.current && window.history.state?.[HISTORY_MARK]) {
      pushed.current = false
      window.history.back()
      return
    }
    setView(null)
    setUrl(null, "replace")
  }, [setUrl])

  // 뒤로 가기 · 앞으로 가기
  useEffect(() => {
    const onPop = () => {
      const fileId = new URL(window.location.href).searchParams.get(PHOTO_PARAM)
      if (!fileId) {
        pushed.current = false
        setGallery(false)
        setView(null)
      }
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  // 주소에 ?photo= 가 있으면(새로고침 · 공유 링크) 그 사진으로 연다
  useEffect(() => {
    const fileId = new URL(window.location.href).searchParams.get(PHOTO_PARAM)
    if (!fileId) return
    pending.current = fileId
    const controller = new AbortController()
    fetch(apiUrl(`/api/chat/photos?${new URLSearchParams({ roomId, fileId })}`), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { photo: RoomPhoto } | null) => {
        if (!body) {
          pending.current = null
          setUrl(null, "replace")
          return
        }
        // 이미 목록에 있으면 바로, 없으면 그 자리를 불러온 뒤(아래 효과가) 연다
        if (latest.current(body.photo.messageId, fileId, "replace")) {
          pending.current = null
          return
        }
        pending.current = `${body.photo.messageId}:${fileId}`
        onNeedMessage(body.photo.messageId)
      })
      .catch(() => {})
    return () => controller.abort()
    // 방에 들어올 때 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])
  useEffect(() => {
    const p = pending.current
    if (!p?.includes(":")) return
    const [messageId, fileId] = p.split(":")
    if (showMessagePhoto(messageId, fileId, "replace")) pending.current = null
  }, [messages, showMessagePhoto])

  const goToMessage = useCallback(
    (messageId: string) => {
      close()
      onGoToMessage(messageId)
    },
    [close, onGoToMessage],
  )

  const pick = useCallback(
    (photo: RoomPhoto, all: RoomPhoto[]) => {
      const photos: ViewerPhoto[] = all
        .filter((p) => p.messageId === photo.messageId)
        .map((p) => ({ fileId: p.fileId, name: p.name, original: raw(p.fileId), messageId: p.messageId, authorName: p.author.name, createdAt: p.createdAt, canDelete: p.mine }))
      setGallery(false)
      setView({ photos, index: Math.max(0, photos.findIndex((p) => p.fileId === photo.fileId)) })
      setUrl(photo.fileId, "replace")
    },
    [setUrl],
  )

  const context = useMemo(() => ({ open }), [open])
  const drawerRoomName = drawer?.roomName ?? null
  const download = useMemo(() => (drawerRoomName !== null ? { roomId, roomName: drawerRoomName } : null), [roomId, drawerRoomName])

  return (
    <PhotoViewerContext.Provider value={context}>
      <RoomDownloadContext.Provider value={download}>{children}</RoomDownloadContext.Provider>
      <PhotoViewer
        photos={view?.photos ?? []}
        index={view?.index ?? null}
        onIndex={(index) => {
          if (!view) return
          setView({ ...view, index })
          setUrl(view.photos[index].fileId, "replace")
        }}
        onClose={close}
        onGoToMessage={goToMessage}
        onOpenGallery={() => {
          // 서랍은 뷰어 아래 층이다 — 뷰어를 닫고 서랍의 사진 탭을 연다. 사진을 고르면 뷰어가 다시 뜬다
          if (!drawer) return setGallery(true)
          close()
          drawer.onOpen("photos")
        }}
        onDelete={async (p) => {
          await onDelete(p.messageId!)
          close()
        }}
        shareUrl={(p) => withPhotoParam(new URL(apiUrl(`/chat/${roomId}`), window.location.origin).toString(), p.fileId)}
      />
      {view && gallery && !drawer && <RoomPhotoGrid roomId={roomId} onClose={() => setGallery(false)} onPick={pick} />}
      {drawer && (
        <RoomDrawer
          roomId={roomId}
          roomName={drawer.roomName}
          open={drawer.open}
          tab={drawer.tab}
          onTab={drawer.onOpen}
          onClose={drawer.onClose}
          // 사진 뷰어는 서랍 위에 뜬다 — 닫으면 서랍으로 돌아온다
          onPickPhoto={pick}
          onGoToMessage={(id) => {
            drawer.onClose()
            onGoToMessage(id)
          }}
        />
      )}
    </PhotoViewerContext.Provider>
  )
}

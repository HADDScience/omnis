"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HugeiconsIcon } from "@hugeicons/react"
import { Notification03Icon, Delete02Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons"
import { formatDistanceToNow } from "date-fns"
import { ko } from "date-fns/locale"
import {
  ACTION_BUTTONS,
  NotificationActionSchema,
  isPendingAction,
  notificationHref,
  type NotificationResponse,
} from "@/lib/schemas/notification"
import { currentSubscription } from "@/lib/pwa"

import { apiUrl } from "@/lib/base-path"
import { useVisibleInterval } from "@/hooks/use-visible-interval"

const NOTIFICATION_POLL_MS = 15_000

interface Notification {
  id: string
  type: string
  title: string
  content: string | null
  entityId: string | null
  read: boolean
  createdAt: string
  actionType: string | null
  resolvedAt: string | null
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const seenIds = useRef<Set<string>>(new Set())
  const initialized = useRef(false)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/notifications"))
      if (!res.ok) return
      const data: Notification[] = await res.json()
      setNotifications(data)
      if (!initialized.current) {
        // 첫 로드: 기존 알림은 토스트하지 않고 본 것으로 처리
        data.forEach((n) => seenIds.current.add(n.id))
        initialized.current = true
      } else {
        // 새로 도착한 알림만 토스트로 표시 (오래된 → 최신 순)
        const fresh = data.filter((n) => !seenIds.current.has(n.id))
        for (const n of fresh.slice().reverse()) {
          seenIds.current.add(n.id)
          toast(n.title, { description: n.content ?? undefined })
        }
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])
  // 2.5초 → 15초, 안 보이는 탭은 멈춘다. 알림 폴링이 운영 요청의 33% 였다(2026-09-15).
  // 벨을 열 때는 아래 onOpenChange 에서 바로 다시 읽는다.
  useVisibleInterval(fetchNotifications, NOTIFICATION_POLL_MS)

  const [responding, setResponding] = useState<string | null>(null)

  // 이 기기가 푸시를 받고 있는가. 아니라면 벨 안에서 설정으로 데려간다 —
  // 설정 화면을 스스로 찾아 들어가는 사람은 드물다.
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  useEffect(() => {
    void currentSubscription().then((s) => setPushOn(s !== null))
  }, [])

  // 미응답 액션은 읽음 처리해도 배지에서 빠지지 않는다 — 응답만이 배지를 없앤다.
  const unreadCount = notifications.filter((n) => !n.read || isPendingAction(n)).length

  async function respond(id: string, response: NotificationResponse) {
    setResponding(id)
    try {
      const res = await fetch(apiUrl("/api/notifications"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, response }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "응답을 저장하지 못했습니다")
        return
      }
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read: true, resolvedAt: new Date().toISOString() } : n
        )
      )
      router.refresh()
    } catch {
      toast.error("응답을 저장하지 못했습니다")
    } finally {
      setResponding(null)
    }
  }

  async function markAllRead() {
    await fetch(apiUrl("/api/notifications"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readAll: true }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  async function markRead(id: string) {
    await fetch(apiUrl("/api/notifications"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
  }

  async function deleteOne(id: string) {
    await fetch(apiUrl(`/api/notifications?id=${id}`), { method: "DELETE" })
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  async function deleteAll() {
    await fetch(apiUrl("/api/notifications?all=true"), { method: "DELETE" })
    setNotifications([])
  }

  async function openNotification(notification: Notification) {
    if (!notification.read) await markRead(notification.id)
    // 갈 곳의 판단은 lib/schemas/notification 에 있다 — 푸시를 눌렀을 때와 같은 곳으로 간다.
    const href = notificationHref(notification.type, notification.entityId)
    if (href) {
      setOpen(false)
      router.push(href)
    }
    // 홈페이지 문의는 원문을 읽어야 판단이 선다 — 목록이 아니라 그 문의로 바로 간다
    if (notification.entityId && notification.type === "website_inquiry") {
      setOpen(false)
      router.push(`/crm/inquiries/${notification.entityId}`)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 폴링이 15초라 여는 순간 바로 다시 읽는다
        if (next) void fetchNotifications()
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="touch-target relative h-8 w-8" aria-label="알림" />
        }
      >
        <HugeiconsIcon icon={Notification03Icon} size={18} />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">
            {unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-[min(20rem,calc(var(--app-vw)-1.5rem))] max-h-[min(400px,calc(var(--app-vh)-80px))] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">알림</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6"
                onClick={markAllRead}
              >
                모두 읽음
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 text-destructive hover:text-destructive"
                onClick={deleteAll}
              >
                전체 삭제
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-[340px] overflow-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              알림이 없습니다
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((n) => {
                const pending = isPendingAction(n)
                const action = NotificationActionSchema.safeParse(n.actionType)
                return (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 hover:bg-muted ${
                      pending
                        ? "bg-primary/10 border-l-2 border-primary"
                        : !n.read
                          ? "bg-primary/5"
                          : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        className="flex-1 flex flex-col gap-0.5 text-left"
                        onClick={() => openNotification(n)}
                      >
                        <span className={`text-xs ${!n.read ? "font-medium" : "text-muted-foreground"}`}>
                          {n.title}
                        </span>
                        {n.content && (
                          <span className="text-[11px] text-muted-foreground line-clamp-2">
                            {n.content}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ko })}
                        </span>
                      </button>
                      {/* 미응답 액션 알림은 삭제로 없앨 수 없다 — 응답만이 없앤다. */}
                      {!pending && (
                        <button
                          aria-label="알림 삭제"
                          className="shrink-0 mt-1 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => deleteOne(n.id)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={12} />
                        </button>
                      )}
                    </div>
                    {pending && action.success && (
                      <div className="mt-2 flex gap-1.5">
                        {ACTION_BUTTONS[action.data].map((b) => (
                          <Button
                            key={b.response}
                            size="sm"
                            variant={b.variant}
                            className="h-8 flex-1 text-xs"
                            disabled={responding === n.id}
                            onClick={() => respond(n.id, b.response)}
                          >
                            {b.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
        {pushOn === false && (
          <button
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted"
            onClick={() => {
              setOpen(false)
              router.push("/settings")
            }}
          >
            <HugeiconsIcon icon={SmartPhone01Icon} size={14} aria-hidden />
            <span>
              Omnis 를 닫아도 알림을 받으려면 — <span className="text-foreground">기기 알림 켜기</span>
            </span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

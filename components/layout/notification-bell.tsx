"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HugeiconsIcon } from "@hugeicons/react"
import { Notification03Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { formatDistanceToNow } from "date-fns"
import { ko } from "date-fns/locale"

interface Notification {
  id: string
  type: string
  title: string
  content: string | null
  entityId: string | null
  read: boolean
  createdAt: string
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const seenIds = useRef<Set<string>>(new Set())
  const initialized = useRef(false)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications")
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
    const id = setInterval(fetchNotifications, 2500)
    return () => clearInterval(id)
  }, [fetchNotifications])

  const unreadCount = notifications.filter((n) => !n.read).length

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readAll: true }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  async function markRead(id: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
  }

  async function deleteOne(id: string) {
    await fetch(`/api/notifications?id=${id}`, { method: "DELETE" })
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  async function deleteAll() {
    await fetch("/api/notifications?all=true", { method: "DELETE" })
    setNotifications([])
  }

  async function openNotification(notification: Notification) {
    if (!notification.read) await markRead(notification.id)
    if (notification.entityId && notification.type.startsWith("task_")) {
      setOpen(false)
      router.push(`/tasks/${notification.entityId}?from=notification`)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="relative h-8 w-8" />
        }
      >
        <HugeiconsIcon icon={Notification03Icon} size={18} />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">
            {unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-80 max-h-[min(400px,calc(100vh-80px))] overflow-hidden p-0">
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
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-2 px-3 py-2.5 hover:bg-muted ${
                    !n.read ? "bg-primary/5" : ""
                  }`}
                >
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
                  <button
                    className="shrink-0 mt-1 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deleteOne(n.id)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

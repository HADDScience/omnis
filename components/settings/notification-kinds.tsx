"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { apiUrl } from "@/lib/base-path"
import type { NotificationPrefs } from "@/lib/schemas/notification"

const KINDS: { key: keyof NotificationPrefs; title: string; description: string }[] = [
  {
    key: "chat",
    title: "채팅 알림",
    description: "모든 방의 새 글 · 옴니스 답 · 나를 부른 글. 방마다 끄려면 방 목록에서 꾹 누르거나 방 머리줄의 종을 누르세요.",
  },
  { key: "task", title: "업무 알림", description: "나에게 업무가 지정됐을 때 · 완료 확인 요청 · 업무 상태가 바뀌었을 때." },
  { key: "calendar", title: "일정 알림", description: "내가 볼 수 있는 캘린더에 새 일정이 들어왔을 때." },
]

/**
 * 받을 알림 — 종류별로 켜고 끈다. 끄면 이 기기 · 다른 기기 모두 그 종류의 **푸시만** 멈춘다.
 * 벨 목록에는 그대로 쌓인다(놓치지 않게). 기기 구독 여부와 상관없이 사람 단위 설정이다.
 */
export function NotificationKinds() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [error, setError] = useState(false)
  const saving = useRef(false)

  const load = useCallback(() => {
    setError(false)
    fetch(apiUrl("/api/notification-prefs"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setPrefs)
      .catch(() => setError(true))
  }, [])
  useEffect(load, [load])

  async function toggle(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs || saving.current) return
    saving.current = true
    const before = prefs
    setPrefs({ ...prefs, [key]: value })
    try {
      const res = await fetch(apiUrl("/api/notification-prefs"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
      if (!res.ok) throw new Error()
      setPrefs(await res.json())
    } catch {
      setPrefs(before)
      toast.error("알림 설정을 바꾸지 못했습니다.")
    } finally {
      saving.current = false
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">받을 알림</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          끄면 그 종류의 기기 알림만 멈춥니다. 벨(🔔) 목록에는 그대로 남아 나중에 볼 수 있습니다.
        </p>
        {error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span>알림 설정을 불러오지 못했습니다.</span>
            <Button variant="outline" size="sm" className="touch-target" onClick={load}>
              다시 시도
            </Button>
          </div>
        ) : prefs === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {KINDS.map((k) => (
              <Skeleton key={k.key} className="h-[60px] w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border border-border">
            {KINDS.map((k) => (
              <li key={k.key}>
                <label className="flex min-h-[60px] cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{k.title}</span>
                    <span className="block text-xs text-muted-foreground">{k.description}</span>
                  </span>
                  <Switch
                    checked={prefs[k.key]}
                    onCheckedChange={(v) => void toggle(k.key, v)}
                    aria-label={k.title}
                    data-notify-kind={k.key}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

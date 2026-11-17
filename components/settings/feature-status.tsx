"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { apiUrl } from "@/lib/base-path"
import {
  DONE_CHANGE_MAX,
  DONE_LINK_MAX,
  FEATURE_STATUSES,
  FEATURE_STATUS_LABEL,
  doneNoticeText,
  parseDoneNotice,
  type FeatureStatus,
} from "@/lib/feature-requests-shared"

/**
 * 기능 요청 한 줄의 상태 단추 — 새로 · 검토 · 완료. 실패하면 되돌린다.
 * 완료로 넘길 때는 창을 띄워 바뀐 것 한 줄 · 써 볼 곳을 받고, 요청한 사람(나 빼고)에게 알림을 보낸다.
 */
export function FeatureStatusButtons({
  id,
  status: initial,
  title,
  requesters = [],
}: {
  id: string
  status: FeatureStatus
  /** 요청 제목 — 알림 미리보기 */
  title?: string
  /** 알림 받을 사람 이름(바꾸는 사람 빼고) */
  requesters?: string[]
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)

  async function change(next: FeatureStatus, notice?: { change: string; link: string }): Promise<boolean> {
    if (next === status || saving) return false
    const before = status
    setStatus(next)
    setSaving(true)
    try {
      const res = await fetch(apiUrl(`/api/feature-requests/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notice ? { status: next, notice } : { status: next }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string; notified?: number } | null
      if (!res.ok) throw new Error(body?.error ?? `바꾸지 못했습니다 (${res.status})`)
      if (notice) toast.success(`완료로 바꾸고 ${body?.notified ?? 0}명에게 알렸습니다`)
      router.refresh()
      return true
    } catch (err) {
      setStatus(before)
      toast.error(err instanceof Error ? err.message : "바꾸지 못했습니다")
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div role="group" aria-label="상태" className="inline-flex shrink-0 overflow-hidden rounded-md border">
        {FEATURE_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === status}
            disabled={saving}
            onClick={() => (s === "DONE" && status !== "DONE" ? setDoneOpen(true) : void change(s))}
            className={`min-h-[36px] px-3 text-xs transition-colors ${s === status ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {FEATURE_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <DoneDialog
        open={doneOpen}
        onOpenChange={setDoneOpen}
        title={title ?? ""}
        requesters={requesters}
        saving={saving}
        onSubmit={async (notice) => {
          if (await change("DONE", notice ?? undefined)) setDoneOpen(false)
        }}
      />
    </>
  )
}

function DoneDialog({
  open,
  onOpenChange,
  title,
  requesters,
  saving,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  requesters: string[]
  saving: boolean
  onSubmit: (notice: { change: string; link: string } | null) => void
}) {
  const [notify, setNotify] = useState(requesters.length > 0)
  const [changeText, setChangeText] = useState("")
  const [link, setLink] = useState("")
  const parsed = parseDoneNotice({ change: changeText, link })
  const valid = !("problem" in parsed)
  const preview = doneNoticeText(title, valid ? parsed : { change: changeText.trim() || "바뀐 것 한 줄", link })
  const canSend = !saving && (!notify || valid)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-feature-done-dialog>
        <DialogHeader>
          <DialogTitle>완료로 바꾸기</DialogTitle>
          <DialogDescription>
            {requesters.length > 0
              ? `요청한 사람 ${requesters.length}명(${requesters.join(", ")})에게 바로 써 볼 수 있다고 알릴 수 있습니다.`
              : "알림 받을 사람이 없습니다 — 요청한 사람이 나뿐이거나 이제 재직 중이 아닙니다."}
          </DialogDescription>
        </DialogHeader>

        {requesters.length > 0 && (
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>요청한 사람에게 알림 보내기</span>
            <Switch checked={notify} onCheckedChange={setNotify} aria-label="요청한 사람에게 알림 보내기" />
          </label>
        )}

        {notify && requesters.length > 0 && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              무엇이 바뀌었나요 (한 줄)
              <Input
                aria-label="바뀐 것"
                value={changeText}
                maxLength={DONE_CHANGE_MAX}
                onChange={(e) => setChangeText(e.target.value)}
                placeholder="예: 옴니스에게 말하면 샘플 전달을 CRM 에 남깁니다"
                className="text-[14px] text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              바로 써 볼 곳 (옴니스 안의 주소)
              <Input
                aria-label="써 볼 곳"
                value={link}
                maxLength={DONE_LINK_MAX}
                onChange={(e) => setLink(e.target.value)}
                placeholder="/crm"
                className="text-[14px] text-foreground"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            {/* 받는 사람 벨에 뜨는 모양 그대로 */}
            <div data-feature-done-preview className="glass rounded-2xl px-3.5 py-3">
              <p className="text-xs font-medium">{preview.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-[11px] text-muted-foreground">{preview.content}</p>
              <p className="mt-1 truncate text-[11px] text-primary">{link || "/…"}</p>
            </div>
            {!valid && (changeText || link) && <p className="text-xs text-destructive">{"problem" in parsed ? parsed.problem : ""}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button disabled={!canSend} onClick={() => onSubmit(notify && valid && requesters.length > 0 ? parsed : null)}>
            {saving ? "바꾸는 중…" : notify && requesters.length > 0 ? "완료로 바꾸고 알리기" : "완료로 바꾸기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

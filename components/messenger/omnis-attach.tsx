"use client"

// 옴니스 방 입력창의 ＋(첨부) — 사람 방 입력창(components/chat/message-input.tsx)과 같은 메뉴 · 상한 · 시놀로지 연결.
// 다른 점: 고르는 즉시 올린다(scope=private — 올린 사람만, 질문에 붙은 뒤에는 방 주인만 본다, lib/file-access.ts).
// 질문을 보낼 때는 올린 파일의 id 만 넘긴다(POST /api/agent/rooms… { fileIds }).
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Attachment01Icon, Cancel01Icon, Folder01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { NasFilePicker } from "@/components/chat/nas-file-picker"
import type { FileInfo } from "@/components/chat/message-list"
import { apiUrl } from "@/lib/base-path"
import { MAX_UPLOAD_BYTES } from "@/lib/constants"
import { ATTACH_MAX } from "@/lib/file-access"
import { reportIncident } from "@/lib/report-client-error"
import { cn } from "@/lib/utils"

export interface PickedFile {
  key: string
  name: string
  size: number
  mimeType: string
  /** 이미지 미리보기(내 기기에서 고른 것만) */
  preview?: string
  status: "uploading" | "done" | "error"
  error?: string
  /** 올린 뒤 받은 파일 — 질문에 이 id 를 붙인다 */
  file?: FileInfo
}

let seq = 0

/** 고른 파일 목록 · 올리기 · 빼기 */
export function useOmnisAttachments() {
  const [items, setItems] = useState<PickedFile[]>([])
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  // 화면을 떠나면 미리보기 주소를 놓는다
  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), [])

  const patch = (key: string, next: Partial<PickedFile>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...next } : i)))

  const upload = useCallback(async (key: string, send: () => Promise<Response>, name: string, size: number) => {
    try {
      const res = await send()
      const data = (await res.json().catch(() => null)) as (FileInfo & { error?: string }) | null
      if (!res.ok || !data?.id) throw new Error(data?.error ?? `올리지 못했습니다 (${res.status})`)
      patch(key, { status: "done", file: { id: data.id, name: data.name, path: data.path, size: data.size, mimeType: data.mimeType } })
    } catch (err) {
      const message = err instanceof Error ? err.message : "올리지 못했습니다"
      patch(key, { status: "error", error: message })
      reportIncident({ kind: "upload_failed", message, size, fileName: name })
    }
  }, [])

  /** 내 기기에서 고른 파일 · 붙여넣기 · 끌어 놓기 */
  const addFiles = useCallback((picked: File[]) => {
    const room = ATTACH_MAX - itemsRef.current.length
    if (picked.length > room) toast.error(`파일은 한 번에 ${ATTACH_MAX}개까지 붙일 수 있어요`)
    const tooLarge = picked.filter((f) => f.size > MAX_UPLOAD_BYTES)
    if (tooLarge.length > 0) {
      const limitMb = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)
      toast.error(`${limitMb}MB 가 넘는 파일은 바로 올릴 수 없습니다`, {
        description: `${tooLarge.map((f) => `「${f.name}」 ${(f.size / 1024 / 1024).toFixed(1)}MB`).join(" · ")} — 시놀로지에 올린 뒤 「시놀로지 파일 연결」 로 다시 첨부해 주세요`,
        duration: 12_000,
      })
    }
    const ok = picked.filter((f) => f.size <= MAX_UPLOAD_BYTES).slice(0, Math.max(room, 0))
    const fresh = ok.map((f) => ({
      key: `up-${++seq}`,
      name: f.name,
      size: f.size,
      mimeType: f.type || "application/octet-stream",
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      status: "uploading" as const,
    }))
    setItems((prev) => [...prev, ...fresh])
    fresh.forEach((item, i) => {
      const form = new FormData()
      form.append("file", ok[i])
      form.append("scope", "private")
      void upload(item.key, () => fetch(apiUrl("/api/files"), { method: "POST", body: form }), item.name, item.size)
    })
  }, [upload])

  /** 시놀로지에 있는 파일을 잇는다 — 올리지 않고 연결 행만 만든다 */
  const addNas = useCallback((entry: { path: string; name: string; size?: number }) => {
    if (itemsRef.current.length >= ATTACH_MAX) {
      toast.error(`파일은 한 번에 ${ATTACH_MAX}개까지 붙일 수 있어요`)
      return
    }
    const key = `nas-${++seq}`
    setItems((prev) => [...prev, { key, name: entry.name, size: entry.size ?? 0, mimeType: "", status: "uploading" }])
    void upload(
      key,
      () => fetch(apiUrl("/api/files/nas"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: entry.path, scope: "private" }) }),
      entry.name,
      entry.size ?? 0,
    )
  }, [upload])

  const remove = useCallback((key: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.key === key)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return prev.filter((i) => i.key !== key)
    })
  }, [])

  /** 보낸 뒤 비운다. 미리보기 주소는 보내는 중 말풍선이 쓰지 않으므로 바로 놓는다 */
  const clear = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => i.preview && URL.revokeObjectURL(i.preview))
      return []
    })
  }, [])

  return {
    items,
    addFiles,
    addNas,
    remove,
    clear,
    uploading: items.some((i) => i.status === "uploading"),
    failed: items.some((i) => i.status === "error"),
    ready: items.filter((i) => i.status === "done").map((i) => i.file!),
  }
}

/** 알약 안 왼쪽 ＋ — 사람 방 입력창과 같은 크기(메신저 48px · 패널 32px)와 같은 메뉴 */
export function AttachButton({ onFiles, onNas, disabled }: { onFiles: (files: File[]) => void; onNas: (entry: { path: string; name: string; size?: number }) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [nasOpen, setNasOpen] = useState(false)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-omnis-file-input
        onChange={(e) => {
          if (e.target.files) {
            onFiles(Array.from(e.target.files))
            e.target.value = ""
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="추가"
              className="touch-target size-[32px] shrink-0 rounded-full in-data-[messenger]:size-[48px]!"
              disabled={disabled}
            />
          }
        >
          <HugeiconsIcon icon={PlusSignIcon} size={18} className="in-data-[messenger]:h-[26px]! in-data-[messenger]:w-[26px]!" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-52">
          <DropdownMenuItem onClick={() => inputRef.current?.click()}>
            <HugeiconsIcon icon={Attachment01Icon} size={14} aria-hidden />
            파일 업로드
            <span className="ml-auto text-[10px] text-muted-foreground">4MB 이하</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNasOpen(true)}>
            <HugeiconsIcon icon={Folder01Icon} size={14} aria-hidden />
            시놀로지 파일 연결
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NasFilePicker open={nasOpen} onOpenChange={setNasOpen} onPick={(entry) => onNas({ path: entry.path, name: entry.name, size: entry.size ?? undefined })} />
    </>
  )
}

/** 입력창 위 칩 — 이미지는 작은 미리보기, 나머지는 이름. 올리는 중 · 실패를 보이고 ✕ 로 뺀다 */
export function AttachChips({ items, onRemove }: { items: PickedFile[]; onRemove: (key: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1 in-data-[messenger]:gap-2" data-omnis-attachments>
      {items.map((i) => (
        <div
          key={i.key}
          data-attach-status={i.status}
          title={i.status === "error" ? i.error : i.name}
          className={cn(
            "flex max-w-[220px] items-center gap-1.5 rounded-full border bg-card py-0.5 pr-0.5 pl-1 text-[11.5px] in-data-[messenger]:max-w-[260px] in-data-[messenger]:gap-2 in-data-[messenger]:py-1 in-data-[messenger]:pl-1.5 in-data-[messenger]:text-[14px]",
            i.status === "error" && "border-destructive/50 text-destructive",
          )}
        >
          {i.preview ? (
            <span className="relative size-6 shrink-0 overflow-hidden rounded-full in-data-[messenger]:size-8">
              {/* eslint-disable-next-line @next/next/no-img-element -- 내 기기의 blob 미리보기 */}
              <img src={i.preview} alt="" className="size-full object-cover" />
            </span>
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground in-data-[messenger]:size-8">
              <HugeiconsIcon icon={i.mimeType === "" ? Folder01Icon : Attachment01Icon} size={13} aria-hidden />
            </span>
          )}
          <span className="min-w-0 truncate">{i.name}</span>
          {i.status === "uploading" && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <Spinner className="size-3" />
              <span className="sr-only sm:not-sr-only">올리는 중</span>
            </span>
          )}
          {i.status === "error" && (
            <span className="flex shrink-0 items-center gap-0.5">
              <HugeiconsIcon icon={Alert02Icon} size={13} aria-hidden />
              실패
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(i.key)}
            aria-label={`${i.name} 빼기`}
            className="touch-target flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-muted in-data-[messenger]:size-8"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}

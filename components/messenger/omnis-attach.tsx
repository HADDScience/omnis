"use client"

// 옴니스 방의 첨부 — ＋ 메뉴와 칩은 공통 입력창(components/chat/room-composer.tsx), 상한 · 시놀로지 연결도 사람 방과 같다.
// 다른 점: 고르는 즉시 올린다(scope=private — 올린 사람만, 질문에 붙은 뒤에는 방 주인만 본다, lib/file-access.ts).
// 질문을 보낼 때는 올린 파일의 id 만 넘긴다(POST /api/agent/rooms… { fileIds }).
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { FileInfo } from "@/components/chat/message-list"
import type { PickedFile } from "@/components/chat/room-composer"
import { apiUrl } from "@/lib/base-path"
import { MAX_UPLOAD_BYTES } from "@/lib/constants"
import { ATTACH_MAX } from "@/lib/file-access"
import { reportIncident } from "@/lib/report-client-error"
import { noteAttachAttempt } from "@/lib/ui-metrics/client"

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
    if (ok.length > 0) noteAttachAttempt()
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

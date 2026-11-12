"use client"

// 방 첨부 한 번에 받기 — 브라우저에서 파일을 하나씩 받아 그 자리에서 zip 으로 묶는다(서버는 주소만 준다, /api/chat/drawer/download).
// 진행 상황은 모듈 상태라 화면을 옮겨도 남는다 — components/layout/room-download-status.tsx 가 하단에 작게 그린다.
//
//   PC     : 저장 위치를 먼저 묻고(showSaveFilePicker, 크롬 · 엣지) 디스크로 바로 흘려 쓴다. 없으면(사파리 · 파폭) 모아서 한 번에 내려받기
//   폰     : 사진 · 동영상만이면 공유 시트(navigator.share files) → 「사진에 저장」. 문서가 섞이면 zip
import { apiUrl } from "@/lib/base-path"
import { downloadMode, missingListText, totalBytes, zipEntryNames, zipFolderName, type MissingItem } from "@/lib/room-drawer"
import { textEntry, zipStream, type ZipEntry } from "@/lib/zip-stream"

export type DownloadStatus = "preparing" | "running" | "ready-share" | "done" | "error" | "cancelled"

export interface DownloadJob {
  id: string
  title: string
  status: DownloadStatus
  done: number
  total: number
  bytes: number
  totalBytes: number
  /** 끝난 뒤 한 줄 — 건너뛴 파일 · 오류 */
  note: string | null
}

interface Target {
  fileId: string
  name: string
  size: number
  mimeType: string
  createdAt: string
  authorName: string
  url: string
  local: boolean
}

let jobs: DownloadJob[] = []
const listeners = new Set<() => void>()
const controllers = new Map<string, AbortController>()
const shareFiles = new Map<string, File[]>()

function emit() {
  for (const l of listeners) l()
}
function patch(id: string, p: Partial<DownloadJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j))
  emit()
}

export function subscribeDownloads(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const downloadSnapshot = () => jobs
const EMPTY: DownloadJob[] = []
export const downloadServerSnapshot = () => EMPTY

export function cancelDownload(id: string) {
  controllers.get(id)?.abort(new DOMException("취소", "AbortError"))
  shareFiles.delete(id)
  patch(id, { status: "cancelled", note: "멈췄습니다" })
  setTimeout(() => dismissDownload(id), 2500)
}

export function dismissDownload(id: string) {
  controllers.delete(id)
  shareFiles.delete(id)
  jobs = jobs.filter((j) => j.id !== id)
  emit()
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches

function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" })] })
  } catch {
    return false
  }
}

type SavePicker = (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>

async function fetchBody(t: Target, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(t.local ? apiUrl(t.url) : t.url, { signal, credentials: t.local ? "same-origin" : "omit", cache: "no-store" })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  return res.body
}

/**
 * 받기 시작 — 버튼을 누른 그 자리에서 부른다(PC 의 저장 위치 묻기는 사용자 동작 직후여야 열린다).
 * 1GB 넘는 선택은 부르는 쪽이 splitBatches 로 나눠 묶음마다 부른다.
 */
export async function startRoomDownload(input: { roomId: string; roomName: string; fileIds: string[]; missing?: MissingItem[]; part?: { index: number; count: number } }): Promise<void> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const now = new Date()
  const folder = zipFolderName(input.roomName, now)
  const suffix = input.part && input.part.count > 1 ? `_${input.part.index + 1}of${input.part.count}` : ""
  const zipName = `${folder}${suffix}.zip`
  const ac = new AbortController()
  controllers.set(id, ac)
  jobs = [...jobs, { id, title: `${input.roomName} · ${input.fileIds.length}개`, status: "preparing", done: 0, total: input.fileIds.length, bytes: 0, totalBytes: 0, note: null }]
  emit()

  // PC 는 저장 위치부터 — 주소를 받는 동안 사용자 동작이 식으면 창이 열리지 않는다
  const picker = !isTouch() ? (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker : undefined
  let writable: WritableStream<Uint8Array> | null = null
  if (picker) {
    try {
      const handle = await picker({ suggestedName: zipName, types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }] })
      writable = await handle.createWritable()
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") {
        dismissDownload(id)
        return
      }
      writable = null // 창을 못 열면 모아서 받기로
    }
  }

  try {
    const res = await fetch(apiUrl("/api/chat/drawer/download"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: input.roomId, fileIds: input.fileIds }),
      signal: ac.signal,
    })
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "주소를 받지 못했습니다")
    const { files: targets, skipped } = (await res.json()) as { files: Target[]; skipped: number }
    if (targets.length === 0) throw new Error("받을 수 있는 파일이 없습니다")
    const sum = totalBytes(targets)
    patch(id, { status: "running", total: targets.length, totalBytes: sum })
    const notes: string[] = []
    if (skipped > 0) notes.push(`${skipped}개는 볼 수 없어 뺐어요`)

    const mode = writable ? "zip" : downloadMode({ touch: isTouch(), canShareFiles: canShareFiles(), items: targets })
    if (mode === "share") {
      const files: File[] = []
      let bytes = 0
      for (const t of targets) {
        try {
          const blob = await new Response(await fetchBody(t, ac.signal)).blob()
          files.push(new File([blob], t.name, { type: t.mimeType }))
        } catch (e) {
          if (ac.signal.aborted) throw e
          notes.push(`${t.name} 을(를) 받지 못했어요`)
        }
        bytes += t.size
        patch(id, { done: files.length, bytes })
      }
      if (files.length === 0) throw new Error("파일을 받지 못했습니다")
      // 공유 시트는 다시 누른 동작에서만 열린다(iOS) — 하단 표시에 「사진에 저장」 단추를 띄운다
      shareFiles.set(id, files)
      patch(id, { status: "ready-share", note: notes.join(" · ") || null })
      return
    }

    const names = zipEntryNames(targets, input.roomName, now)
    const entries: ZipEntry[] = targets.map((t, i) => ({ name: names[i], date: new Date(t.createdAt), open: () => fetchBody(t, ac.signal) }))
    if (input.missing && input.missing.length > 0) entries.push(textEntry(`${folder}/빠진파일.txt`, missingListText(input.roomName, input.missing), now))
    let failed = 0
    const stream = zipStream(entries, {
      signal: ac.signal,
      onProgress: (p) => patch(id, { done: Math.min(p.done, targets.length), bytes: p.bytes }),
      onSkip: () => void failed++,
    })
    if (writable) {
      await stream.pipeTo(writable, { signal: ac.signal })
    } else {
      const blob = await new Response(stream, { headers: { "Content-Type": "application/zip" } }).blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = zipName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    if (failed > 0) notes.push(`${failed}개는 받지 못했어요`)
    if (input.missing?.length) notes.push(`원본 없는 ${input.missing.length}개는 빠진파일.txt 에`)
    patch(id, { status: "done", done: targets.length - failed, bytes: sum, note: notes.join(" · ") || null })
    setTimeout(() => dismissDownload(id), 6000)
  } catch (e) {
    if (ac.signal.aborted) return
    await writable?.abort().catch(() => {})
    patch(id, { status: "error", note: e instanceof Error ? e.message : "받지 못했습니다" })
  }
}

/** 공유 시트 열기 — 하단 표시의 「사진에 저장」 을 누른 동작에서 부른다 */
export async function shareReady(id: string): Promise<void> {
  const files = shareFiles.get(id)
  if (!files) return
  try {
    await navigator.share({ files })
    patch(id, { status: "done", note: "공유 시트에서 「이미지 저장」 을 누르면 사진에 들어갑니다" })
    setTimeout(() => dismissDownload(id), 5000)
  } catch (e) {
    // 시트를 닫았으면 단추를 그대로 둔다 — 다시 누를 수 있게
    if ((e as DOMException)?.name !== "AbortError") patch(id, { status: "error", note: "공유 시트를 열지 못했습니다" })
  }
}

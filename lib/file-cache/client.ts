"use client"

// 채팅 파일 카드의 받기 · 기기 저장 · 열기 · 공유 (규칙: rules.ts · 화면: components/chat/file-card.tsx)
//
// 받기   : /api/files/{id}/raw 를 fetch 로 흘려 받으며 진행률을 낸다. 큰 첨부는 라우트가 R2 서명 주소로 302 를 주고
//          fetch 가 따라간다(버킷 CORS 에 GET 이 열려 있다, mydocs/manual/r2-upload.md). 취소는 AbortController
// 기억   : 받은 파일은 Cache Storage 에, 목록(크기 · 마지막 연 때)은 localStorage 에. 다시 열어도 받지 않는다.
//          한도(FILE_CACHE_LIMIT)를 넘으면 오래 안 연 것부터 지운다. 둘 다 못 쓰는 브라우저(사생활 보호 창)면 이 탭 메모리에만
// 상태   : 모듈 상태라 방을 옮겨 갔다 와도 받는 중 · 받음이 남는다
import { useSyncExternalStore } from "react"
import { apiUrl } from "@/lib/base-path"
import { safeInlineType } from "@/lib/file-serving"
import { PDF_THUMB_MAX, PRELOAD_MAX, openWay, planEviction, type CacheEntry } from "./rules"

export interface CardFile {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
}

export type FilePhase = "idle" | "downloading" | "done" | "error"
export interface FileState {
  phase: FilePhase
  bytes: number
  total: number
}

const CACHE_NAME = "omnis-files-v1"
const INDEX_KEY = "omnis:file-cache:v1"
const cacheUrl = (key: string) => `/__omnis-file-cache/${key}`

const IDLE: FileState = { phase: "idle", bytes: 0, total: 0 }
const states = new Map<string, FileState>()
const listeners = new Set<() => void>()
const memory = new Map<string, Blob>()
const controllers = new Map<string, AbortController>()
const thumbs = new Map<string, string | null>()
let index: CacheEntry[] | null = null

function emit() {
  for (const l of listeners) l()
}
function set(id: string, s: FileState) {
  states.set(id, s)
  emit()
}

function readIndex(): CacheEntry[] {
  if (index) return index
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as CacheEntry[]
    index = Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === "string" && typeof e.size === "number") : []
  } catch {
    index = []
  }
  return index
}
function writeIndex(next: CacheEntry[]) {
  index = next
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(next))
  } catch {
    // 저장소를 못 쓰면 이 탭에서만 기억한다
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

function snapshot(id: string): FileState {
  const s = states.get(id)
  if (s) return s
  if (typeof window === "undefined") return IDLE
  // 이 기기에 받아 둔 파일 — 목록만 보고 「받음」 으로 그린다. 실물이 지워졌으면 열 때 다시 받는다
  const entry = readIndex().find((e) => e.id === id)
  if (!entry) return IDLE
  const done: FileState = { phase: "done", bytes: entry.size, total: entry.size }
  states.set(id, done)
  return done
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** 카드 한 장의 받기 상태 */
export function useFileState(id: string): FileState {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(id),
    () => IDLE,
  )
}

async function remember(id: string, blob: Blob) {
  const cache = await openCache()
  const entries = readIndex()
  const plan = planEviction(entries, { id, size: blob.size })
  if (!cache || plan === null) return // 한도보다 크다 — 이 탭 메모리에만
  for (const gone of plan) {
    await cache.delete(cacheUrl(gone)).catch(() => {})
    await cache.delete(cacheUrl(`thumb-${gone}`)).catch(() => {})
    memory.delete(gone)
    thumbs.delete(gone)
    states.delete(gone)
  }
  try {
    await cache.put(cacheUrl(id), new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }))
  } catch {
    return // 기기 저장 공간이 모자라다 — 이 탭에서만
  }
  writeIndex([...readIndex().filter((e) => e.id !== id && !plan.includes(e.id)), { id, size: blob.size, at: Date.now() }])
  if (plan.length) emit()
}

function touch(id: string) {
  const entries = readIndex()
  if (!entries.some((e) => e.id === id)) return
  writeIndex(entries.map((e) => (e.id === id ? { ...e, at: Date.now() } : e)))
}

function forget(id: string) {
  writeIndex(readIndex().filter((e) => e.id !== id))
  memory.delete(id)
  set(id, IDLE)
}

/** 받아 둔 실물 — 메모리 → 기기. 없으면 null(목록만 남은 것은 지운다) */
async function loadBlob(id: string): Promise<Blob | null> {
  const hit = memory.get(id)
  if (hit) return hit
  const cache = await openCache()
  const res = await cache?.match(cacheUrl(id)).catch(() => undefined)
  if (!res) {
    if (readIndex().some((e) => e.id === id)) forget(id)
    return null
  }
  const blob = await res.blob()
  memory.set(id, blob)
  return blob
}

const THROTTLE_MS = 100

/** 카드 안에서 받기 — 진행률을 내고, 다 받으면 기기에 둔다 */
export async function startFileDownload(file: CardFile): Promise<void> {
  if (snapshot(file.id).phase === "downloading") return
  const ac = new AbortController()
  controllers.set(file.id, ac)
  set(file.id, { phase: "downloading", bytes: 0, total: file.size })
  try {
    const res = await fetch(apiUrl(file.path), { signal: ac.signal, credentials: "same-origin" })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    // R2 · 큰 첨부는 길이를 준다. NAS 스트림은 주지 않아 저장된 크기로 잰다
    const total = Number(res.headers.get("content-length")) || file.size
    const reader = res.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let bytes = 0
    let last = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
      bytes += value.byteLength
      const now = performance.now()
      if (now - last > THROTTLE_MS) {
        last = now
        set(file.id, { phase: "downloading", bytes, total: Math.max(total, bytes) })
      }
    }
    const blob = new Blob(chunks, { type: safeInlineType(file.mimeType, file.name) ?? "application/octet-stream" })
    memory.set(file.id, blob)
    set(file.id, { phase: "done", bytes: blob.size, total: blob.size })
    await remember(file.id, blob)
  } catch {
    if (ac.signal.aborted) set(file.id, IDLE)
    else set(file.id, { phase: "error", bytes: 0, total: file.size })
  } finally {
    controllers.delete(file.id)
  }
}

export function cancelFileDownload(id: string) {
  controllers.get(id)?.abort(new DOMException("취소", "AbortError"))
}

/** 받은 파일을 열기 직전에 메모리로 — 공유 시트 · 새 탭은 누른 동작 안에서 열어야 막히지 않는다 */
export function preloadFile(file: CardFile) {
  if (memory.has(file.id) || file.size > PRELOAD_MAX) return
  void loadBlob(file.id)
}

const isTouch = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches

function asFile(file: CardFile, blob: Blob): File {
  return new File([blob], file.name, { type: blob.type || "application/octet-stream" })
}

function canShareFile(f: File): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [f] })
  } catch {
    return false
  }
}

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 받은 파일 열기 — 폰은 공유 시트(미리보기 · 저장), PC 는 새 탭(PDF · 사진) 또는 저장. 기기에서 지워졌으면 다시 받는다 */
export async function openDownloadedFile(file: CardFile): Promise<void> {
  const blob = memory.get(file.id) ?? (await loadBlob(file.id))
  if (!blob) {
    void startFileDownload(file)
    return
  }
  touch(file.id)
  const inlineType = safeInlineType(file.mimeType, file.name)
  const f = asFile(file, blob)
  const way = openWay({ touch: isTouch(), canShareFile: canShareFile(f), inlineType })
  if (way === "share") {
    await navigator.share({ files: [f], title: file.name }).catch(() => {})
    return
  }
  if (way === "tab") {
    const url = URL.createObjectURL(inlineType && blob.type !== inlineType ? new Blob([blob], { type: inlineType }) : blob)
    // noopener 를 주면 브라우저에 따라 blob 주소를 못 연다 — 열고 나서 끊는다. 막혔으면 저장으로
    const w = window.open(url, "_blank")
    if (w) w.opener = null
    else saveBlob(file.name, blob)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  saveBlob(file.name, blob)
}

/** 말풍선 옆 공유 단추 — 받은 파일은 파일째, 아니면 주소를 공유 시트로. 공유가 없는 브라우저는 주소를 복사한다 */
export async function shareFile(file: CardFile): Promise<"shared" | "copied" | "failed"> {
  const url = new URL(apiUrl(file.path), window.location.origin).toString()
  const blob = memory.get(file.id)
  try {
    if (blob) {
      const f = asFile(file, blob)
      if (canShareFile(f)) {
        await navigator.share({ files: [f], title: file.name })
        return "shared"
      }
    }
    if (typeof navigator.share === "function") {
      await navigator.share({ title: file.name, url })
      return "shared"
    }
    await navigator.clipboard.writeText(url)
    return "copied"
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return "shared" // 시트를 닫았다
    try {
      await navigator.clipboard.writeText(url)
      return "copied"
    } catch {
      return "failed"
    }
  }
}

/**
 * 받은 파일의 미리보기 — 사진은 그 자리 주소, PDF 는 첫 장을 그려(unpdf, 받은 뒤에만 불러온다) 기기에 둔다.
 * 없으면 null
 */
export async function fileThumb(file: CardFile): Promise<string | null> {
  if (thumbs.has(file.id)) return thumbs.get(file.id) ?? null
  const type = safeInlineType(file.mimeType, file.name)
  const isPdf = type === "application/pdf"
  if (!type?.startsWith("image/") && !isPdf) return null
  if (isPdf && file.size > PDF_THUMB_MAX) return null
  const cache = await openCache()
  const saved = await cache?.match(cacheUrl(`thumb-${file.id}`)).catch(() => undefined)
  if (saved) {
    const url = await saved.text()
    thumbs.set(file.id, url)
    return url
  }
  const blob = await loadBlob(file.id)
  if (!blob) return null
  let url: string | null = null
  try {
    if (isPdf) {
      const { getDocumentProxy, renderPageAsImage } = await import("unpdf")
      const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()))
      url = await renderPageAsImage(pdf, 1, { width: 160, toDataURL: true })
    } else {
      url = await shrinkImage(blob)
    }
  } catch {
    url = null
  }
  thumbs.set(file.id, url)
  if (url && cache && readIndex().some((e) => e.id === file.id)) {
    await cache.put(cacheUrl(`thumb-${file.id}`), new Response(url, { headers: { "Content-Type": "text/plain" } })).catch(() => {})
  }
  return url
}

/** 큰 사진 — 카드 칸(80px · 2배) 크기로 줄인 data URL. 원본 수백 MB 를 img 로 붙들지 않는다 */
async function shrinkImage(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/webp", 0.8)
}

/** 이 기기의 받은 파일을 모두 지운다(로그아웃 등) */
export async function clearFileCache(): Promise<void> {
  writeIndex([])
  memory.clear()
  thumbs.clear()
  states.clear()
  try {
    await caches?.delete(CACHE_NAME)
  } catch {
    // 없다
  }
  emit()
}

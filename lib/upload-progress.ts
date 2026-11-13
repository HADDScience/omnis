"use client"

// 보내는 파일 카드의 올리기 진행 — 카톡처럼 고르면 바로 대화에 카드가 뜨고, 카드 안에서 「업로드 중 · 3.0 / 28.8MB」 · 원형 진행 · X.
// 채팅(components/chat/chat-panel.tsx 의 sendFileNow)이 쓰고 파일 카드(components/chat/file-card.tsx)가 읽는다. 키는 임시 파일 id.
//
// 작은 파일은 XHR 의 upload.onprogress, 큰 파일은 R2 조각 업로드(lib/large-upload/client.ts)의 진행을 그대로 옮겨 적는다.
// 멈추기는 키마다 등록한 함수를 부른다. 화면을 떠나면(pagehide) 올리던 것을 모두 멈춘다 — 서버에 남은 미완 조각은
// 기존 규칙(R2 버킷 수명 규칙 · 이어 올리기 표)을 따른다.
import { useSyncExternalStore } from "react"
import { apiUrl } from "@/lib/base-path"

export interface UploadProgress {
  loaded: number
  total: number
  /** 다 올라가 글을 보내는 중 — 이제 멈출 수 없다 */
  sent?: boolean
}

const progress = new Map<string, UploadProgress>()
const cancels = new Map<string, () => void>()
const listeners = new Set<() => void>()
let hooked = false

function emit() {
  for (const l of listeners) l()
}

function hookPage() {
  if (hooked || typeof window === "undefined") return
  hooked = true
  window.addEventListener("pagehide", () => cancelAllUploads())
}

export function setUploadProgress(key: string, p: UploadProgress) {
  const prev = progress.get(key)
  if (prev && prev.loaded === p.loaded && prev.total === p.total && prev.sent === p.sent) return
  progress.set(key, p)
  emit()
}

export function clearUpload(key: string) {
  cancels.delete(key)
  if (progress.delete(key)) emit()
}

/** 멈추는 방법을 남긴다 — 카드의 X · 화면 떠남이 부른다 */
export function onCancelUpload(key: string, fn: () => void) {
  hookPage()
  cancels.set(key, fn)
}

export function cancelUpload(key: string) {
  const fn = cancels.get(key)
  cancels.delete(key)
  fn?.()
}

export function cancelAllUploads(keys?: Iterable<string>) {
  for (const key of keys ?? [...cancels.keys()]) cancelUpload(key)
}

const NONE: UploadProgress | null = null
export function useUploadProgress(key: string): UploadProgress | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => progress.get(key) ?? NONE,
    () => NONE,
  )
}

export class UploadAborted extends Error {
  constructor() {
    super("올리기를 멈췄습니다")
  }
}

/**
 * 작은 파일 하나를 /api/files 로 — 진행률을 key 에 적고, 멈추면 UploadAborted 를 던진다.
 * fetch 는 올리기 진행을 주지 않아 XHR 을 쓴다
 */
export function uploadSmallFile<T>(key: string, file: File, form: FormData): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", apiUrl("/api/files"))
    xhr.responseType = "json"
    xhr.upload.onprogress = (e) => setUploadProgress(key, { loaded: e.loaded, total: e.lengthComputable ? e.total : file.size })
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T)
      else reject(Object.assign(new Error((xhr.response as { error?: string } | null)?.error ?? `「${file.name}」 을 올리지 못했습니다`), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error("연결이 끊겨 파일을 올리지 못했습니다"))
    xhr.onabort = () => reject(new UploadAborted())
    onCancelUpload(key, () => xhr.abort())
    setUploadProgress(key, { loaded: 0, total: file.size })
    xhr.send(form)
  })
}

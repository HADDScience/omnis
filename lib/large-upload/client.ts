// 큰 첨부 업로드 관리자 — 화면이 바뀌어도 살아 있는 모듈 하나. 전송 줄 밖에서 돌아 올리는 동안 다음 글을 보낼 수 있다.
// 조각은 File.slice 로 잘라 보내 파일 전체를 메모리에 올리지 않는다.
import { apiUrl } from "@/lib/base-path"
import { reportIncident } from "@/lib/report-client-error"
import { trackUi } from "@/lib/ui-metrics/client"
import { deleteResume, listResume, readResume, writeResume, type ResumeRecord } from "./resume-store"
import { partCount, partRange, remainingLabel, SESSION_TTL_MS } from "./rules"

export interface UploadedFile {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
}

export interface LargeUploadView {
  id: string
  name: string
  percent: number
  /** 「약 3분」. 아직 모르면 null */
  remaining: string | null
}

export interface ResumableView {
  fingerprint: string
  name: string
  percent: number
}

/** 사용자가 멈췄다. 기기에 남긴 표로 같은 파일을 다시 고르면 이어 올린다 */
export class UploadCancelled extends Error {
  constructor() {
    super("파일 올리기를 멈췄습니다. 같은 파일을 다시 보내면 이어서 올립니다.")
  }
}

const PHONE_CONCURRENCY = 2
const DESKTOP_CONCURRENCY = 3
const MAX_PART_ATTEMPTS = 6
/** 이만큼 진척이 없으면 끊고 다시 보낸다 — 화면을 켠 폰이 죽은 연결을 붙들고 있는 경우 */
const STALL_MS = 90_000
const CONTENT_TYPE = "application/octet-stream"

interface Job {
  id: string
  name: string
  size: number
  startedAt: number
  doneBytes: number
  inFlight: Map<number, { loaded: number; lastProgress: number; abort: AbortController; stalled: boolean }>
  cancelled: boolean
  hiddenSince: number | null
  hiddenMs: number
}

const jobs = new Map<string, Job>()
const listeners = new Set<() => void>()
let snapshot: LargeUploadView[] = []
let wakeLock: { release: () => Promise<void> } | null = null
let pageHooked = false

function viewOf(job: Job): LargeUploadView {
  let loaded = job.doneBytes
  for (const p of job.inFlight.values()) loaded += p.loaded
  return {
    id: job.id,
    name: job.name,
    percent: Math.min(99, Math.floor((loaded / job.size) * 100)),
    remaining: remainingLabel(loaded, job.size, Date.now() - job.startedAt),
  }
}

function changed() {
  snapshot = [...jobs.values()].map(viewOf)
  for (const fn of listeners) fn()
}

export function subscribeLargeUploads(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const largeUploadSnapshot = (): LargeUploadView[] => snapshot
const EMPTY: LargeUploadView[] = []
export const largeUploadServerSnapshot = (): LargeUploadView[] => EMPTY

export function cancelLargeUpload(id: string) {
  const job = jobs.get(id)
  if (!job || job.cancelled) return
  job.cancelled = true
  const v = viewOf(job)
  trackUi("attach_large_abort", v.percent)
  for (const p of job.inFlight.values()) p.abort.abort()
}

/** 올리다 끊긴 파일 — 페이지가 새로 열렸을 때 안내한다. 지금 올리고 있는 것과 만료된 것은 뺀다 */
export async function listResumable(): Promise<ResumableView[]> {
  const records = await listResume()
  const now = Date.now()
  const out: ResumableView[] = []
  for (const r of records) {
    if (jobs.has(r.fingerprint)) continue
    if (now - r.updatedAt > SESSION_TTL_MS) {
      void deleteResume(r.fingerprint)
      continue
    }
    const total = partCount(r.size, r.partBytes)
    out.push({ fingerprint: r.fingerprint, name: r.name, percent: Math.floor((r.parts.length / total) * 100) })
  }
  return out
}

export const discardResumable = (fingerprint: string) => deleteResume(fingerprint)

const fingerprintOf = (file: File, isPrivate: boolean) => `${file.name}|${file.size}|${file.lastModified}|${isPrivate ? "p" : "c"}`

const isPhone = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function holdWakeLock() {
  if (wakeLock || jobs.size === 0 || document.hidden) return
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }
    wakeLock = (await nav.wakeLock?.request("screen")) ?? null
    // 다른 앱으로 갔다 오면 저절로 풀린다 — 돌아올 때 다시 잡는다
    ;(wakeLock as unknown as EventTarget | null)?.addEventListener?.("release", () => {
      wakeLock = null
    })
  } catch {
    // 못 잡아도 올리기는 계속한다. 화면을 켜 두라는 안내가 남아 있다
  }
}

function releaseWakeLock() {
  if (jobs.size > 0 || !wakeLock) return
  void wakeLock.release().catch(() => {})
  wakeLock = null
}

function hookPage() {
  if (pageHooked) return
  pageHooked = true
  // 올리는 중에 탭을 닫으면 경고한다
  window.addEventListener("beforeunload", (e) => {
    if (jobs.size > 0) e.preventDefault()
  })
  document.addEventListener("visibilitychange", () => {
    const now = Date.now()
    for (const job of jobs.values()) {
      if (document.hidden) {
        job.hiddenSince = now
      } else if (job.hiddenSince !== null) {
        job.hiddenMs += now - job.hiddenSince
        job.hiddenSince = null
        // 화면을 끈 사이 끊겼는데 오류도 안 난 연결을 바로 다시 보낸다(다시 보내는 양은 전송 중이던 조각뿐이다)
        for (const p of job.inFlight.values()) if (now - p.lastProgress > 3_000) p.abort.abort()
      }
    }
    if (!document.hidden) {
      void holdWakeLock()
      for (const fn of [...visibleWaiters]) fn()
    }
  })
  window.addEventListener("online", () => {
    for (const fn of [...visibleWaiters]) fn()
  })
}

const visibleWaiters = new Set<() => void>()

/** 화면이 켜져 있고 네트워크가 있을 때까지 기다린다. 폰은 화면을 끄면 전송이 멈춰, 그동안의 실패를 횟수에 세지 않는다 */
async function untilUsable(job: Job) {
  while ((document.hidden || navigator.onLine === false) && !job.cancelled) {
    await new Promise<void>((resolve) => {
      const done = () => {
        visibleWaiters.delete(done)
        resolve()
      }
      visibleWaiters.add(done)
      // 켜졌다는 신호를 놓쳐도 영원히 멈추지 않게
      setTimeout(done, 30_000)
    })
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(apiUrl(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return data?.error ?? fallback
}

async function freshToken(session: string): Promise<string | null> {
  const res = await postJson("/api/uploads/token", { session })
  if (!res.ok) return null
  return ((await res.json()) as { token: string }).token
}

class RestartUpload extends Error {}

async function runUpload(job: Job, file: File, isPrivate: boolean, fingerprint: string): Promise<UploadedFile> {
  const { completeMultipartUpload, createMultipartUpload, uploadPart } = await import("@vercel/blob/client")

  let record = await readResume(fingerprint)
  let token = record ? await freshToken(record.session) : null
  if (record && !token) {
    // 세션이 만료됐거나 다른 사람의 표다 — 처음부터
    await deleteResume(fingerprint)
    record = undefined
  }
  const resumed = Boolean(record)

  if (!record || !token) {
    const res = await postJson("/api/uploads", { name: file.name, size: file.size, mimeType: file.type, ...(isPrivate ? { scope: "private" } : {}) })
    if (!res.ok) throw Object.assign(new Error(await errorOf(res, "큰 파일을 올릴 준비를 하지 못했습니다")), { status: res.status })
    const opened = (await res.json()) as { session: string; pathname: string; partBytes: number; token: string }
    token = opened.token
    const started = await createMultipartUpload(opened.pathname, { access: "private", token, contentType: CONTENT_TYPE })
    record = {
      fingerprint, name: file.name, size: file.size, session: opened.session, pathname: opened.pathname,
      uploadId: started.uploadId, key: started.key, partBytes: opened.partBytes, parts: [], updatedAt: Date.now(),
    }
    await writeResume(record)
  } else {
    trackUi("attach_large_resume", record.parts.length)
  }
  const state: ResumeRecord = record

  const total = partCount(file.size, state.partBytes)
  const done = new Set(state.parts.map((p) => p.partNumber))
  job.doneBytes = state.parts.reduce((sum, p) => {
    const r = partRange(p.partNumber, file.size, state.partBytes)
    return sum + (r.end - r.start)
  }, 0)
  changed()

  const queue = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n))

  const sendPart = async (partNumber: number) => {
    const { start, end } = partRange(partNumber, file.size, state.partBytes)
    let attempts = 0
    for (;;) {
      await untilUsable(job)
      if (job.cancelled) throw new UploadCancelled()
      const abort = new AbortController()
      const slot = { loaded: 0, lastProgress: Date.now(), abort, stalled: false }
      job.inFlight.set(partNumber, slot)
      const watchdog = setInterval(() => {
        if (Date.now() - slot.lastProgress > STALL_MS) {
          slot.stalled = true
          abort.abort()
        }
      }, 10_000)
      try {
        const part = await uploadPart(state.pathname, file.slice(start, end), {
          access: "private",
          token: token as string,
          key: state.key,
          uploadId: state.uploadId,
          partNumber,
          contentType: CONTENT_TYPE,
          abortSignal: abort.signal,
          onUploadProgress: ({ loaded }) => {
            slot.loaded = loaded
            slot.lastProgress = Date.now()
            changed()
          },
        })
        job.inFlight.delete(partNumber)
        job.doneBytes += end - start
        state.parts.push({ partNumber: part.partNumber, etag: part.etag })
        state.updatedAt = Date.now()
        void writeResume(state)
        changed()
        return
      } catch (e) {
        job.inFlight.delete(partNumber)
        changed()
        if (job.cancelled) throw new UploadCancelled()
        const name = e instanceof Error ? e.name : ""
        if (name === "BlobClientTokenExpiredError" || /expired/i.test(e instanceof Error ? e.message : "")) {
          const next = await freshToken(state.session)
          if (next) {
            token = next
            continue
          }
        }
        // 화면을 끈 동안 · 오프라인 동안의 실패와 복귀할 때 끊은 연결은 세지 않는다
        if (document.hidden || navigator.onLine === false || (abort.signal.aborted && !slot.stalled)) continue
        // 올리던 표가 저장소에서 사라졌으면 다시 보내도 소용없다 — 처음부터
        if (resumed && name === "BlobNotFoundError") throw new RestartUpload()
        if (++attempts >= MAX_PART_ATTEMPTS) throw e
        await delay(2_000 * 2 ** attempts)
      } finally {
        clearInterval(watchdog)
      }
    }
  }

  const workers = Array.from({ length: isPhone() ? PHONE_CONCURRENCY : DESKTOP_CONCURRENCY }, async () => {
    try {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) await sendPart(n)
    } catch (e) {
      // 한 조각이 끝내 실패했다 — 나머지 전송도 멈춘다. 끝난 조각은 표에 남아 다음에 이어 간다
      job.cancelled = true
      for (const p of job.inFlight.values()) p.abort.abort()
      throw e
    }
  })
  await Promise.all(workers)
  if (job.cancelled) throw new UploadCancelled()

  try {
    const parts = [...state.parts].sort((a, b) => a.partNumber - b.partNumber)
    await completeMultipartUpload(state.pathname, parts, { access: "private", token: token as string, key: state.key, uploadId: state.uploadId, contentType: CONTENT_TYPE })
  } catch (e) {
    // 앞선 시도가 닿았을 수 있다. 판정은 아래 완료 요청이 저장소를 보고 한다
    console.warn("[large-upload] 합치기 응답 실패", e)
  }
  const res = await postJson("/api/uploads/complete", { session: state.session })
  if (!res.ok) throw Object.assign(new Error(await errorOf(res, "파일을 첨부로 만들지 못했습니다")), { status: res.status })
  await deleteResume(fingerprint)
  return (await res.json()) as UploadedFile
}

/**
 * 큰 파일 하나를 올리고 첨부(파일 행)를 돌려준다. 실패하면 던진다 — 호출부가 글과 파일을 입력창에 되돌린다.
 * 사용 기록에는 숫자만 남긴다.
 */
export async function startLargeUpload(file: File, opts: { scope?: "private" } = {}): Promise<UploadedFile> {
  hookPage()
  const isPrivate = opts.scope === "private"
  const fingerprint = fingerprintOf(file, isPrivate)
  if (jobs.has(fingerprint)) throw new Error(`「${file.name}」 을 이미 올리고 있습니다`)

  const job: Job = {
    id: fingerprint, name: file.name, size: file.size, startedAt: Date.now(), doneBytes: 0, inFlight: new Map(),
    cancelled: false, hiddenSince: document.hidden ? Date.now() : null, hiddenMs: 0,
  }
  jobs.set(fingerprint, job)
  changed()
  void holdWakeLock()
  trackUi("attach_large_mb", Math.round(file.size / 1024 / 1024))

  try {
    let uploaded: UploadedFile
    try {
      uploaded = await runUpload(job, file, isPrivate, fingerprint)
    } catch (e) {
      if (!(e instanceof RestartUpload)) throw e
      await deleteResume(fingerprint)
      job.doneBytes = 0
      job.cancelled = false
      uploaded = await runUpload(job, file, isPrivate, fingerprint)
    }
    trackUi("attach_large_s", Math.round((Date.now() - job.startedAt) / 1000))
    if (job.hiddenMs > 0) trackUi("attach_paused_hidden", Math.round(job.hiddenMs / 1000))
    return uploaded
  } catch (e) {
    if (e instanceof UploadCancelled) throw e
    const status = (e as { status?: number }).status
    const message = e instanceof Error ? e.message : "파일을 올리지 못했습니다"
    reportIncident({ kind: "upload_failed", message, status, size: file.size, fileName: file.name })
    throw e instanceof Error && status ? e : new Error(`「${file.name}」 을 올리지 못했습니다. 다시 보내면 이어서 올립니다.`)
  } finally {
    jobs.delete(fingerprint)
    changed()
    releaseWakeLock()
  }
}

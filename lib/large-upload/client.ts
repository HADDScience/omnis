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

/** 버리기 — 기기의 표를 지운다. R2 면 저장소에 남은 조각도 지운다(못 지워도 버킷 수명 규칙이 지운다) */
export async function discardResumable(fingerprint: string) {
  const record = await readResume(fingerprint)
  if (record?.backend === "r2") await postJson("/api/uploads/r2/abort", { session: record.session }).catch(() => {})
  await deleteResume(fingerprint)
}

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

/** 조각 하나를 보내는 방법 — Blob(#158) 과 R2 가 다르다. 재시도 · 멈춤 감시 · 화면 꺼짐 처리는 sendParts 가 함께 한다 */
interface Transport {
  put(partNumber: number, body: Blob, opts: { signal: AbortSignal; onProgress: (loaded: number) => void }): Promise<{ partNumber: number; etag: string }>
  /** 이 실패를 횟수에 세지 않고 곧바로 다시 보낼지(토큰 · 서명 만료). 처음부터 다시 해야 하면 RestartUpload 를 던진다 */
  recover(e: unknown, partNumber: number): Promise<boolean>
}

async function sendParts(job: Job, file: File, state: ResumeRecord, queue: number[], transport: Transport) {
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
        const part = await transport.put(partNumber, file.slice(start, end), {
          signal: abort.signal,
          onProgress: (loaded) => {
            slot.loaded = loaded
            slot.lastProgress = Date.now()
            changed()
          },
        })
        job.inFlight.delete(partNumber)
        job.doneBytes += end - start
        state.parts = state.parts.filter((p) => p.partNumber !== part.partNumber)
        state.parts.push(part)
        state.updatedAt = Date.now()
        void writeResume(state)
        changed()
        return
      } catch (e) {
        job.inFlight.delete(partNumber)
        changed()
        if (job.cancelled) throw new UploadCancelled()
        if (await transport.recover(e, partNumber)) continue
        // 화면을 끈 동안 · 오프라인 동안의 실패와 복귀할 때 끊은 연결은 세지 않는다
        if (document.hidden || navigator.onLine === false || (abort.signal.aborted && !slot.stalled)) continue
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
}

function startProgress(job: Job, file: File, state: ResumeRecord) {
  job.doneBytes = state.parts.reduce((sum, p) => {
    const r = partRange(p.partNumber, file.size, state.partBytes)
    return sum + (r.end - r.start)
  }, 0)
  changed()
}

async function finish(state: ResumeRecord, fingerprint: string): Promise<UploadedFile> {
  const res = await postJson("/api/uploads/complete", { session: state.session })
  if (!res.ok) throw Object.assign(new Error(await errorOf(res, "파일을 첨부로 만들지 못했습니다")), { status: res.status })
  await deleteResume(fingerprint)
  return (await res.json()) as UploadedFile
}

async function runUpload(job: Job, file: File, isPrivate: boolean, fingerprint: string): Promise<UploadedFile> {
  let record = await readResume(fingerprint)
  if (record?.backend === "r2") return runR2Upload(job, file, fingerprint, record, true)

  const { completeMultipartUpload, createMultipartUpload, uploadPart } = await import("@vercel/blob/client")
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
    const opened = (await res.json()) as { backend?: "r2"; session: string; pathname: string; partBytes: number; token?: string }
    if (opened.backend === "r2") {
      const r2: ResumeRecord = {
        fingerprint, name: file.name, size: file.size, session: opened.session, pathname: opened.pathname,
        uploadId: "", key: opened.pathname, partBytes: opened.partBytes, parts: [], updatedAt: Date.now(), backend: "r2",
      }
      await writeResume(r2)
      return runR2Upload(job, file, fingerprint, r2, false)
    }
    token = opened.token as string
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
  startProgress(job, file, state)
  const done = new Set(state.parts.map((p) => p.partNumber))
  const queue = Array.from({ length: partCount(file.size, state.partBytes) }, (_, i) => i + 1).filter((n) => !done.has(n))

  await sendParts(job, file, state, queue, {
    put: (partNumber, body, { signal, onProgress }) =>
      uploadPart(state.pathname, body, {
        access: "private",
        token: token as string,
        key: state.key,
        uploadId: state.uploadId,
        partNumber,
        contentType: CONTENT_TYPE,
        abortSignal: signal,
        onUploadProgress: ({ loaded }) => onProgress(loaded),
      }),
    recover: async (e) => {
      const name = e instanceof Error ? e.name : ""
      if (name === "BlobClientTokenExpiredError" || /expired/i.test(e instanceof Error ? e.message : "")) {
        const next = await freshToken(state.session)
        if (next) {
          token = next
          return true
        }
      }
      // 올리던 표가 저장소에서 사라졌으면 다시 보내도 소용없다 — 처음부터
      if (resumed && name === "BlobNotFoundError") throw new RestartUpload()
      return false
    },
  })

  try {
    const parts = [...state.parts].sort((a, b) => a.partNumber - b.partNumber)
    await completeMultipartUpload(state.pathname, parts, { access: "private", token: token as string, key: state.key, uploadId: state.uploadId, contentType: CONTENT_TYPE })
  } catch (e) {
    // 앞선 시도가 닿았을 수 있다. 판정은 아래 완료 요청이 저장소를 보고 한다
    console.warn("[large-upload] 합치기 응답 실패", e)
  }
  return finish(state, fingerprint)
}

// ─── R2(S3 호환) — 서버는 서명만 준다. 조각은 브라우저가 R2 로 바로 PUT 한다(mydocs/manual/r2-upload.md) ───

/** 서명 주소가 만료됐거나(403) 서명이 틀렸다 — 새 주소로 다시 보낸다 */
class SignatureRejected extends Error {}

/** 서버 호출도 끊김에 대비해 다시 시도한다 — 서명 발급이 끊김에 멈추면 조각 재시도가 소용없다(MinIO 실험, 11/10) */
async function postWithRetry(path: string, body: unknown, job: Job): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await untilUsable(job)
    if (job.cancelled) throw new UploadCancelled()
    try {
      const res = await postJson(path, body)
      if (res.status < 500 && res.status !== 429) return res
      if (attempt >= MAX_PART_ATTEMPTS - 1) return res
    } catch (e) {
      if (attempt >= MAX_PART_ATTEMPTS - 1) throw e
    }
    await delay(Math.min(16_000, 1_000 * 2 ** attempt))
  }
}

function xhrPut(url: string, body: Blob, opts: { signal: AbortSignal; onProgress: (loaded: number) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new DOMException("멈춤", "AbortError"))
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.upload.onprogress = (e) => opts.onProgress(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      reject(xhr.status === 403 ? new SignatureRejected(`R2 가 서명을 거절했습니다 (HTTP 403)`) : Object.assign(new Error(`R2 HTTP ${xhr.status}`), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error("R2 에 연결하지 못했습니다"))
    xhr.onabort = () => reject(new DOMException("멈춤", "AbortError"))
    opts.signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

async function runR2Upload(job: Job, file: File, fingerprint: string, state: ResumeRecord, resumed: boolean): Promise<UploadedFile> {
  const total = partCount(file.size, state.partBytes)

  /** 저장소에 실제로 남은 조각을 기준으로 할 일을 정한다 — 기기의 표보다 저장소가 맞다 */
  const syncWithStore = async (): Promise<number[]> => {
    const res = await postWithRetry("/api/uploads/r2/state", { session: state.session }, job)
    if (res.status === 410) throw new RestartUpload()
    if (!res.ok) throw Object.assign(new Error(await errorOf(res, "올리던 조각을 확인하지 못했습니다")), { status: res.status })
    const { done, missing } = (await res.json()) as { done: number[]; missing: number[] }
    state.parts = done.map((partNumber) => ({ partNumber, etag: "" }))
    void writeResume(state)
    startProgress(job, file, state)
    return missing
  }

  let queue = Array.from({ length: total }, (_, i) => i + 1)
  if (resumed) {
    queue = await syncWithStore()
    trackUi("attach_large_resume", state.parts.length)
  } else {
    startProgress(job, file, state)
  }

  const urls = new Map<number, { url: string; at: number }>()
  /** 서명 주소의 수명(15분)보다 일찍 버린다 — 느린 회선에서 보내는 도중 만료되지 않게 */
  const URL_REUSE_MS = 10 * 60_000
  const freeRetries = new Map<number, number>()

  const urlFor = async (partNumber: number): Promise<string> => {
    const cached = urls.get(partNumber)
    if (cached && Date.now() - cached.at < URL_REUSE_MS) return cached.url
    // 다음 차례 조각들도 함께 받는다 — 서명 요청 수를 줄인다
    const batch = [partNumber, ...queue.slice(0, 3)].filter((n, i, all) => all.indexOf(n) === i)
    const res = await postWithRetry("/api/uploads/r2/sign", { session: state.session, parts: batch }, job)
    if (res.status === 410) throw new RestartUpload()
    if (!res.ok) throw Object.assign(new Error(await errorOf(res, "올릴 주소를 받지 못했습니다")), { status: res.status })
    const signed = ((await res.json()) as { urls: Record<string, string> }).urls
    const at = Date.now()
    for (const [n, url] of Object.entries(signed)) urls.set(Number(n), { url, at })
    return signed[String(partNumber)]
  }

  const transport: Transport = {
    put: async (partNumber, body, opts) => {
      await xhrPut(await urlFor(partNumber), body, opts)
      return { partNumber, etag: "" }
    },
    recover: async (e, partNumber) => {
      if (e instanceof RestartUpload) throw e
      // 실패한 조각은 다음 시도에 새 주소를 받는다 — R2 는 만료된 서명에 CORS 헤더 없는 403 을 줘서 화면에는 연결 오류로만 보인다
      urls.delete(partNumber)
      if (!(e instanceof SignatureRejected)) return false
      // 새 주소로도 연달아 거절되면 시계 · 설정 문제다 — 횟수에 센다
      const n = (freeRetries.get(partNumber) ?? 0) + 1
      freeRetries.set(partNumber, n)
      return n <= 2
    },
  }

  await sendParts(job, file, state, queue, transport)
  for (let round = 0; ; round++) {
    const res = await postWithRetry("/api/uploads/complete", { session: state.session }, job)
    // 아직 다 올라가지 않았다(어느 조각의 응답만 잃었다) — 저장소를 다시 보고 빠진 것만 보낸다
    if (res.status === 409 && round < 2) {
      const missing = await syncWithStore()
      if (missing.length > 0) await sendParts(job, file, state, missing, transport)
      continue
    }
    if (!res.ok) throw Object.assign(new Error(await errorOf(res, "파일을 첨부로 만들지 못했습니다")), { status: res.status })
    await deleteResume(fingerprint)
    return (await res.json()) as UploadedFile
  }
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

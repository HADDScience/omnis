/**
 * 점검 스위치 — 재배포 없이 몇십 초 안에 공지 띠(banner)나 점검 화면(maintenance)을 띄운다.
 *
 * 값은 Vercel Global Config(구 Edge Config) 스토어의 `maintenance` 항목 하나다:
 *   { "mode": "off" | "banner" | "maintenance", "message": "…", "updatedAt": "ISO 시각" }
 * 켜고 끄는 법: scripts/maintenance.sh · mydocs/manual/maintenance-switch.md
 *
 * 스위치가 서비스를 넘어뜨리면 안 된다. 값이 없거나, 모양이 틀리거나, 스토어를 못 읽으면
 * (토큰 · 네트워크 · 한도 초과 · 시간 초과) 전부 off 로 동작한다.
 *
 * 읽기 한도(Hobby 월 100,000회)를 넘지 않도록 인스턴스마다 CACHE_SECONDS 동안 메모리에 둔다.
 * 계산: ~/work/omnis-reports/maintenance-switch.md · 문서 위와 같은 곳.
 *
 * 이 파일은 next/server 를 부르지 않는다 — proxy · API · 단위 시험이 같이 쓴다.
 */

export type MaintenanceMode = "off" | "banner" | "maintenance"

export type MaintenanceState = {
  mode: MaintenanceMode
  message: string
  updatedAt: string | null
}

export const OFF: MaintenanceState = Object.freeze({ mode: "off", message: "", updatedAt: null }) as MaintenanceState

/** Global Config 의 항목 이름. 키 규칙(^[\w-]+$)을 지킨다 */
export const STORE_KEY = "maintenance"

/** 공지 문구 상한 — 띠가 폰에서 두세 줄을 넘지 않게 */
const MESSAGE_MAX = 200

/** 메모리 캐시 기본값(초). MAINTENANCE_CACHE_SECONDS 로 바꾼다 */
const DEFAULT_CACHE_SECONDS = 30

/** 스토어 응답을 기다리는 상한. 넘으면 off — 점검 스위치 때문에 화면이 늦어지면 안 된다 */
const READ_TIMEOUT_MS = 1500

/** 들어온 값을 검사해 모양이 맞을 때만 쓴다. 나머지는 전부 off */
export function parseState(raw: unknown): MaintenanceState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return OFF
  const value = raw as Record<string, unknown>
  const mode = value.mode
  if (mode !== "banner" && mode !== "maintenance") return OFF
  const message = typeof value.message === "string" ? value.message.trim().slice(0, MESSAGE_MAX) : ""
  const updatedAt = typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : null
  return { mode, message, updatedAt }
}

/**
 * 로컬 흉내 — MAINTENANCE_MODE · MAINTENANCE_MESSAGE · MAINTENANCE_UPDATED_AT.
 * MAINTENANCE_MODE 가 있으면 스토어보다 먼저 본다(운영에서 쓰면 재배포가 필요하다 — 비상용 두 번째 길).
 */
export function stateFromEnv(env: Record<string, string | undefined> = process.env): MaintenanceState | null {
  const mode = env.MAINTENANCE_MODE?.trim()
  if (!mode) return null
  return parseState({ mode, message: env.MAINTENANCE_MESSAGE ?? "", updatedAt: env.MAINTENANCE_UPDATED_AT })
}

/**
 * 시험용 흉내 쿠키. MAINTENANCE_ALLOW_SIMULATE=1 인 서버에서만 읽는다(CI e2e · 로컬).
 * 그 쿠키를 가진 브라우저 하나만 영향을 받는다 — 같은 서버를 쓰는 다른 시험은 그대로다.
 * 값: encodeURIComponent(JSON.stringify({ mode, message, updatedAt }))
 */
export const SIMULATE_COOKIE = "omnis_maintenance_sim"

export function simulatedState(cookieValue: string | undefined, env: Record<string, string | undefined> = process.env): MaintenanceState | null {
  if (env.MAINTENANCE_ALLOW_SIMULATE !== "1" || !cookieValue) return null
  try {
    return parseState(JSON.parse(decodeURIComponent(cookieValue)))
  } catch {
    return OFF
  }
}

export function cacheSeconds(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MAINTENANCE_CACHE_SECONDS)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_SECONDS
}

function connectionString(env: Record<string, string | undefined>): string | undefined {
  return env.GLOBAL_CONFIG || env.EDGE_CONFIG || undefined
}

type Reader = () => Promise<unknown>

/** 실제 스토어 읽기. 연결 문자열이 없으면 부르지 않는다(스토어 연결 전 · 로컬 · CI) */
async function readStore(conn: string): Promise<unknown> {
  const { createClient } = await import("@vercel/global-config")
  // 캐시는 여기서 직접 한다 — SDK 의 개발용 SWR 캐시까지 겹치면 로컬에서 값이 두 번 늦는다
  const client = createClient(conn, { disableDevelopmentCache: true })
  return client.get(STORE_KEY)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("maintenance switch read timed out")), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

let cached: { state: MaintenanceState; at: number } | null = null
let inflight: Promise<MaintenanceState> | null = null

/**
 * 지금 스위치 값. 순서: 환경변수 흉내 → (캐시) → Global Config → off.
 * 읽기 실패도 캐시한다 — 스토어가 아플 때 요청마다 다시 두드려 한도를 쓰지 않게.
 */
export async function readMaintenanceState(
  options: {
    env?: Record<string, string | undefined>
    reader?: Reader
    now?: () => number
    /** 이 호출이 받아들이는 캐시 나이(초). 없으면 cacheSeconds(env) */
    maxAgeSeconds?: number
  } = {},
): Promise<MaintenanceState> {
  const env = options.env ?? process.env
  const fromEnv = stateFromEnv(env)
  if (fromEnv) return fromEnv

  const conn = connectionString(env)
  if (!conn && !options.reader) return OFF

  const now = options.now ?? Date.now
  const maxAge = (options.maxAgeSeconds ?? cacheSeconds(env)) * 1000
  if (cached && now() - cached.at < maxAge) return cached.state
  if (inflight) return inflight

  const reader = options.reader ?? (() => readStore(conn!))
  inflight = withTimeout(reader(), READ_TIMEOUT_MS)
    .then((raw) => parseState(raw))
    .catch((error) => {
      console.warn("[maintenance] 스위치를 읽지 못해 off 로 둔다:", error instanceof Error ? error.message : error)
      return OFF
    })
    .then((state) => {
      cached = { state, at: now() }
      inflight = null
      return state
    })
  return inflight
}

/** 단위 시험용 */
export function resetMaintenanceCache() {
  cached = null
  inflight = null
}

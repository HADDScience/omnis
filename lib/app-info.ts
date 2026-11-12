/**
 * 빌드 때 만든 업데이트 소식 · 오픈소스 라이선스를 읽는다(만드는 곳: lib/app-info-build.mjs, 싣는 곳: next.config.mjs).
 * 서버 화면에서만 부른다 — 라이선스 목록은 커서 클라이언트 번들에 싣지 않는다.
 */
export interface AppUpdate {
  date: string
  kind: string
  text: string
}

export interface LicenseRow {
  name: string
  version: string
  license: string
  homepage: string | null
}

function parseList<T>(raw: string | undefined, ok: (v: unknown) => v is T): T[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(v) ? v.filter(ok) : []
  } catch {
    return []
  }
}

const isUpdate = (v: unknown): v is AppUpdate =>
  !!v && typeof v === "object" && typeof (v as AppUpdate).text === "string" && typeof (v as AppUpdate).kind === "string"
const isLicense = (v: unknown): v is LicenseRow =>
  !!v && typeof v === "object" && typeof (v as LicenseRow).name === "string" && typeof (v as LicenseRow).license === "string"

export function appUpdates(): AppUpdate[] {
  return parseList(process.env.APP_UPDATES_JSON, isUpdate)
}

export function appLicenses(): LicenseRow[] {
  return parseList(process.env.APP_LICENSES_JSON, isLicense)
}

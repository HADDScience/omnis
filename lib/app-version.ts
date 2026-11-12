/**
 * 앱 버전 — 마이 > 앱 정보에 보인다. 값은 빌드 때 next.config.mjs 가 싣는다:
 * package.json 의 version, Vercel 이 준 배포 커밋(VERCEL_GIT_COMMIT_SHA), 빌드 시각.
 * 순수 함수(시험: app-version.test.ts) — 환경값은 부르는 쪽이 넘긴다.
 */
export interface AppVersion {
  /** package.json 의 version */
  version: string
  /** 배포 커밋 짧은 해시(7자리). 로컬 빌드처럼 커밋을 모르면 null */
  commit: string | null
  /** 빌드(배포) 날짜 — 서울 기준 YYYY-MM-DD. 모르면 null */
  builtOn: string | null
}

export function appVersion(env: { version?: string; sha?: string; builtAt?: string }): AppVersion {
  const sha = (env.sha ?? "").trim()
  const at = env.builtAt ? new Date(env.builtAt) : null
  const builtOn =
    at && !Number.isNaN(at.getTime())
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
      : null
  return {
    version: (env.version ?? "").trim() || "0.0.0",
    commit: /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null,
    builtOn,
  }
}

/** 이 빌드의 버전 */
export function currentAppVersion(): AppVersion {
  return appVersion({
    version: process.env.NEXT_PUBLIC_APP_VERSION,
    sha: process.env.NEXT_PUBLIC_BUILD_SHA,
    builtAt: process.env.NEXT_PUBLIC_BUILD_AT,
  })
}

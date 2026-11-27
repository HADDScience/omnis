// 회사(테넌트) 한 겹 — 1단계 껍데기. 지금은 회사가 하나라 아무 일도 하지 않는다.
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §2-7 (회사마다 Neon 프로젝트, tenantId 칼럼은 만들지 않는다)
//
// 요청 밖에서 도는 공통 층 새 코드(cron 작업 · outbox 소비 · objects:sync · 분류 실행)는 runForTenant 로 감싼다.
// 두 번째 회사가 생기면 여기만 바뀐다: AsyncLocalStorage 에 회사를 넣고, lib/db.ts 의 prisma 를 회사별 클라이언트로
// 넘기는 Proxy 로 바꾼다(추정 — 짜 보지 않았다). 그때 부르는 쪽은 회사 목록을 도는 바깥 반복만 더한다.
// 기존 cron · 스크립트는 1단계에서 감싸지 않는다.
//
// 데이터만 둔다(prisma · 서버 모듈을 들이지 않는다). 시험: lib/tenant.test.ts

/** 회사 키. 1단계는 하나뿐이다 */
export const DEFAULT_TENANT = "default"
export type TenantKey = string

const TENANT_KEY = /^[a-z][a-z0-9_-]{0,39}$/

/** 지금 회사. 1단계는 늘 "default" */
export function currentTenant(): TenantKey {
  return DEFAULT_TENANT
}

/**
 * 회사 하나의 문맥에서 fn 을 돈다. 1단계는 fn 을 그냥 부른다 — 회사 키 모양만 본다.
 * "default" 가 아닌 회사는 아직 없으므로 거절한다(회사별 DB 연결이 없는데 돌면 기본 DB 에 쓴다).
 */
export async function runForTenant<T>(tenant: TenantKey, fn: () => Promise<T> | T): Promise<T> {
  if (!TENANT_KEY.test(tenant)) throw new Error(`회사 키 형식이 아니다: ${tenant}`)
  if (tenant !== DEFAULT_TENANT) throw new Error(`회사 ${tenant} 는 아직 없다 — 1단계는 ${DEFAULT_TENANT} 하나뿐이다`)
  return fn()
}

/** 모듈 전역 캐시 키 — 회사 + 정의 해시 + 코드 버전(§2-7). 회사가 늘어도 캐시가 섞이지 않게 처음부터 이 모양으로 쓴다 */
export function tenantCacheKey(parts: { defHash: string; codeVersion?: string; tenant?: TenantKey }): string {
  const tenant = parts.tenant ?? currentTenant()
  const code = parts.codeVersion ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local"
  return `${tenant}:${parts.defHash}:${code}`
}

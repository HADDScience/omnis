// 작업용 컴퓨터(Claude Managed Agents) 설정 — 환경변수에서만 읽는다. prisma · 서버 모듈을 들이지 않는다(시험 · 화면 어디서든 읽게).
//
// 계획: ~/work/omnis-reports/omnis-workbench-261116/plan-v3-261126.md(2절 구조 · 3-4 한도 · 5절 0단계)
// 키는 지금은 정우창 개인 Anthropic 계정 것이다. 회사 계정으로 옮길 때는 WORKBENCH_ANTHROPIC_API_KEY 만 바꾼다
// (에이전트 · 환경은 키가 속한 작업 공간의 것이라, 키를 바꾸면 scripts/workbench-setup.ts 를 한 번 다시 돌려 ID 를 새로 받는다).

export interface WorkbenchConfig {
  /** 이 기능을 보는 사람(User.id). 비어 있으면 아무도 못 본다 — 0단계 스위치 */
  userIds: string[]
  /** Managed Agents 키. 없으면 기능이 꺼진다 */
  apiKey: string | null
  /** scripts/workbench-setup.ts 가 만든 에이전트 · 환경 */
  agentId: string | null
  environmentId: string | null
  /** 기본 모델 — 에이전트 정의에 들어간다(setup 때) */
  model: string
  /** 옴니스 MCP 주소 — 샌드박스가 요청자 권한의 단기 토큰으로 읽는다 */
  mcpUrl: string | null
  /** 작업 1건 상한(원). 세션 예산(budget)으로 Anthropic 이 지킨다 */
  taskLimitKrw: number
  /** 사람별 · 회사 월 상한(원). 옴니스가 시작 전에 막는다 */
  userMonthlyKrw: number
  companyMonthlyKrw: number
  /** 원/달러 — 부가세 포함으로 넉넉히(계획 v3 표기) */
  krwPerUsd: number
  /** 한 작업을 기다리는 최대 시간 */
  maxMinutes: number
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : d
}
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)

export function workbenchConfig(env: Record<string, string | undefined> = process.env): WorkbenchConfig {
  const base = (env.PUBLIC_URL ?? "").replace(/\/$/, "")
  return {
    userIds: list(env.WORKBENCH_USER_IDS),
    apiKey: env.WORKBENCH_ANTHROPIC_API_KEY || null,
    agentId: env.WORKBENCH_AGENT_ID || null,
    environmentId: env.WORKBENCH_ENVIRONMENT_ID || null,
    model: env.WORKBENCH_MODEL || "claude-sonnet-5-5",
    mcpUrl: env.WORKBENCH_MCP_URL || (base ? `${base}/api/ip-mcp` : null),
    taskLimitKrw: num(env.WORKBENCH_TASK_LIMIT_KRW, 3_000),
    userMonthlyKrw: num(env.WORKBENCH_USER_MONTHLY_KRW, 30_000),
    companyMonthlyKrw: num(env.WORKBENCH_COMPANY_MONTHLY_KRW, 30_000),
    krwPerUsd: num(env.WORKBENCH_KRW_PER_USD, 1468.8),
    maxMinutes: num(env.WORKBENCH_MAX_MINUTES, 60),
  }
}

/** 이 사람에게 작업용 컴퓨터를 보여 줄까 — 스위치 · 키 · 에이전트 · 환경이 다 있어야 한다 */
export function workbenchEnabledFor(userId: string, c: WorkbenchConfig = workbenchConfig()): boolean {
  return c.userIds.includes(userId) && !!c.apiKey && !!c.agentId && !!c.environmentId
}

/** 운영에 켜려면 넣어야 하는 환경변수(보고 · 설정 화면용) */
export const WORKBENCH_ENV_NAMES = [
  "WORKBENCH_ANTHROPIC_API_KEY",
  "WORKBENCH_AGENT_ID",
  "WORKBENCH_ENVIRONMENT_ID",
  "WORKBENCH_USER_IDS",
  "WORKBENCH_MCP_URL (생략하면 PUBLIC_URL + /api/ip-mcp)",
  "WORKBENCH_MODEL (생략하면 claude-sonnet-5-5)",
  "WORKBENCH_TASK_LIMIT_KRW · WORKBENCH_USER_MONTHLY_KRW · WORKBENCH_COMPANY_MONTHLY_KRW (생략하면 3,000 · 30,000 · 30,000)",
] as const

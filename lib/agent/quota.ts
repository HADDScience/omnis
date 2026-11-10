// 하루 상한 — 데모 사이트 비용 방어(작업지시자 2026-10-29). 환경변수로만 켜고, 값이 없으면 상한이 없다(운영 기본 동작 그대로).
//   OMNIS_AGENT_DAILY_KRW        오늘(한국 시각 0시부터) AiUsage 원 합계가 이 값에 닿으면 새 실행을 받지 않는다
//   OMNIS_AGENT_USER_DAILY_RUNS  한 사람이 오늘 시작한 실행(AgentRun) 수 상한
// 확인을 기다리던 카드의 [확인] · [취소] 는 막지 않는다 — 새 실행이 아니라 이미 시작한 실행을 끝내는 일이다.
// 순수 함수는 여기, DB 를 읽는 쪽은 lib/agent/service.ts. 시험: lib/agent/quota.test.ts
// 결정 · 데모 권장값: mydocs/working/2026-10-29-omnis-agent.md 「데모 비용」
import { IS_DEMO } from "@/lib/demo"

export interface AgentQuota {
  /** 하루 전체 원 상한. null = 없음 */
  dailyKrw: number | null
  /** 사람당 하루 실행 수. null = 없음 */
  userDailyRuns: number | null
}

/** env 를 인자로 받는다 — 시험이 process.env 를 건드리지 않게. 비었거나 0 이하 · 숫자가 아니면 상한 없음 */
export function agentQuota(env: Record<string, string | undefined> = process.env): AgentQuota {
  const num = (name: string) => {
    const raw = env[name]?.trim()
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const runs = num("OMNIS_AGENT_USER_DAILY_RUNS")
  return { dailyKrw: num("OMNIS_AGENT_DAILY_KRW"), userDailyRuns: runs === null ? null : Math.floor(runs) }
}

/** 상한이 하나라도 켜져 있는가 — 꺼져 있으면 DB 를 읽지 않는다 */
export const quotaEnabled = (q: AgentQuota) => q.dailyKrw !== null || q.userDailyRuns !== null

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 한국 시각 오늘 0시(UTC Date). 「오늘」 은 이 시각부터 센다 */
export function kstDayStart(now: Date = new Date()): Date {
  const kst = now.getTime() + KST_OFFSET_MS
  return new Date(kst - (kst % 86_400_000) - KST_OFFSET_MS)
}

export const DEMO_DAILY_MESSAGE = "오늘 데모 사용량을 다 썼어요. 내일 다시 써 주세요"
const DAILY_MESSAGE = "오늘 옴니스 사용량 상한에 닿았어요. 내일 다시 써 주세요"

/**
 * 새 실행을 받을지. 막아야 하면 429 와 화면에 보일 문장 — 503(기능 꺼짐)이 아니라 「잠시 뒤(내일) 다시」 라서 429 다.
 * usedKrw: 오늘 AiUsage 원 합계 · userRuns: 이 사람이 오늘 시작한 실행 수
 */
export function quotaRefusal(
  used: { usedKrw: number; userRuns: number },
  quota: AgentQuota,
  demo: boolean = IS_DEMO,
): { status: 429; error: string; reason: "daily_krw" | "user_runs" } | null {
  if (quota.dailyKrw !== null && used.usedKrw >= quota.dailyKrw) {
    return { status: 429, error: demo ? DEMO_DAILY_MESSAGE : DAILY_MESSAGE, reason: "daily_krw" }
  }
  if (quota.userDailyRuns !== null && used.userRuns >= quota.userDailyRuns) {
    return {
      status: 429,
      error: `오늘 쓸 수 있는 옴니스 요청 ${quota.userDailyRuns}회를 다 썼어요. 내일 다시 써 주세요`,
      reason: "user_runs",
    }
  }
  return null
}

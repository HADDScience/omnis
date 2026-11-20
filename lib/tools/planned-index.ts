// 묶음별 실행을 한데 모은다(#248) — lib/omnis-mcp.ts runTool · 앱 AI 확인 카드(lib/agent/tools.ts)가 여기서 찾는다.
import type { Caller } from "@/lib/omnis-mcp"
import type { Planner } from "./planned"
import { WORK_READ_NAMES, type WorkReadName } from "./defs-work"
import { runWorkRead, WORK_PLANNERS } from "./plan-work"
import { CRM_MORE_READ_NAMES, type CrmMoreReadName } from "./defs-crm"
import { CRM_MORE_PLANNERS, runCrmMoreRead } from "./plan-crm"
import { CARD_READ_NAMES, type CardReadName } from "./defs-cards"
import { CARD_PLANNERS, runCardRead } from "./plan-cards"

type Reader = (args: Record<string, unknown>, caller: Caller) => Promise<{ text: string } | { error: string }>

const PLANNERS: Record<string, Planner> = { ...WORK_PLANNERS, ...CRM_MORE_PLANNERS, ...CARD_PLANNERS }

const READERS: Record<string, Reader> = Object.fromEntries([
  ...WORK_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runWorkRead(n as WorkReadName, args, caller)] as const),
  ...CRM_MORE_READ_NAMES.map((n) => [n, (args: Record<string, unknown>) => runCrmMoreRead(n as CrmMoreReadName, args)] as const),
  ...CARD_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runCardRead(n as CardReadName, args, caller)] as const),
])

/** 계획을 먼저 세우는 쓰기 도구면 그 계획 함수 */
export const plannerFor = (name: string): Planner | undefined => PLANNERS[name]
/** 묶음 읽기 도구면 그 실행 함수 */
export const readerFor = (name: string): Reader | undefined => READERS[name]

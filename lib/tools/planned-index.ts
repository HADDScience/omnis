// 묶음별 실행을 한데 모은다(#248) — lib/omnis-mcp.ts runTool · 앱 AI 확인 카드(lib/agent/tools.ts)가 여기서 찾는다.
import type { Caller } from "@/lib/omnis-mcp"
import type { Planner } from "./planned"
import { WORK_READ_NAMES, type WorkReadName } from "./defs-work"
import { runWorkRead, WORK_PLANNERS } from "./plan-work"
import { CRM_MORE_READ_NAMES, type CrmMoreReadName } from "./defs-crm"
import { CRM_MORE_PLANNERS, runCrmMoreRead } from "./plan-crm"
import { CARD_READ_NAMES, type CardReadName } from "./defs-cards"
import { CARD_PLANNERS, runCardRead } from "./plan-cards"
import { ADMIN_READ_NAMES, type AdminReadName } from "./defs-admin"
import { ADMIN_PLANNERS, runAdminRead } from "./plan-admin"
import { IP_MORE_READ_NAMES, type IpMoreReadName } from "./defs-ip"
import { IP_MORE_PLANNERS, runIpMoreRead } from "./plan-ip"
import { WEBSITE_READ_NAMES, type WebsiteReadName } from "./defs-website"
import { WEBSITE_PLANNERS, runWebsiteRead } from "./plan-website"
import { FILE_READ_NAMES, type FileReadName } from "./defs-files"
import { FILE_PLANNERS, runFileRead } from "./plan-files"
import { GRANT_READ_NAMES, type GrantReadName } from "./defs-grants"
import { GRANT_PLANNERS, runGrantRead } from "./plan-grants"

type Reader = (args: Record<string, unknown>, caller: Caller) => Promise<{ text: string } | { error: string }>

const PLANNERS: Record<string, Planner> = { ...WORK_PLANNERS, ...CRM_MORE_PLANNERS, ...CARD_PLANNERS, ...ADMIN_PLANNERS, ...IP_MORE_PLANNERS, ...WEBSITE_PLANNERS, ...FILE_PLANNERS, ...GRANT_PLANNERS }

const READERS: Record<string, Reader> = Object.fromEntries([
  ...WORK_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runWorkRead(n as WorkReadName, args, caller)] as const),
  ...CRM_MORE_READ_NAMES.map((n) => [n, (args: Record<string, unknown>) => runCrmMoreRead(n as CrmMoreReadName, args)] as const),
  ...CARD_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runCardRead(n as CardReadName, args, caller)] as const),
  ...ADMIN_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runAdminRead(n as AdminReadName, args, caller)] as const),
  ...IP_MORE_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runIpMoreRead(n as IpMoreReadName, args, caller)] as const),
  ...WEBSITE_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runWebsiteRead(n as WebsiteReadName, args, caller)] as const),
  ...FILE_READ_NAMES.map((n) => [n, (args: Record<string, unknown>, caller: Caller) => runFileRead(n as FileReadName, args, caller)] as const),
  ...GRANT_READ_NAMES.map((n) => [n, (args: Record<string, unknown>) => runGrantRead(n as GrantReadName, args)] as const),
])

/** 계획을 먼저 세우는 쓰기 도구면 그 계획 함수 */
export const plannerFor = (name: string): Planner | undefined => PLANNERS[name]
/** 묶음 읽기 도구면 그 실행 함수 */
export const readerFor = (name: string): Reader | undefined => READERS[name]

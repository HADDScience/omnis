// 묶음별 도구 정의를 한데 모은다(#248) — lib/omnis-mcp.ts OMNIS_TOOLS 가 펼친다. 데이터만(서버 모듈을 들이지 않는다).
import { WORK_TOOLS } from "./defs-work"

export const EXTRA_TOOLS = [...WORK_TOOLS] as const

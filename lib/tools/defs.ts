// 묶음별 도구 정의를 한데 모은다(#248) — lib/omnis-mcp.ts OMNIS_TOOLS 가 펼친다. 데이터만(서버 모듈을 들이지 않는다).
import { WORK_TOOLS } from "./defs-work"
import { CRM_MORE_TOOLS } from "./defs-crm"
import { CARD_TOOLS } from "./defs-cards"
import { ADMIN_TOOLS } from "./defs-admin"
import { IP_MORE_TOOLS } from "./defs-ip"
import { WEBSITE_TOOLS } from "./defs-website"
import { FILE_TOOLS } from "./defs-files"
import { GRANT_TOOLS } from "./defs-grants"

export const EXTRA_TOOLS = [...WORK_TOOLS, ...CRM_MORE_TOOLS, ...CARD_TOOLS, ...ADMIN_TOOLS, ...IP_MORE_TOOLS, ...WEBSITE_TOOLS, ...FILE_TOOLS, ...GRANT_TOOLS] as const

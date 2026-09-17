// hadd-omnis — 원격 MCP 서버의 알맹이 (도구·지침·토큰).
//
// hadd-ip 를 넓힌 것이다(2026-09-07 omnis-hadd, 2026-09-14 hadd-omnis 로 이름을 바꿨다). 지식재산권 도구는 `lib/ip-mcp.ts` 그대로 두고(설명 한 글자도
// 안 바꿨다 — 그 문장들은 모델이 틀렸던 것을 하나씩 막으며 다듬은 것이다), 그 옆에
// 옴니스 본체(업무·채팅·지식·CRM)를 여는 도구를 붙였다.
//
// 쓰기는 화면과 같은 길로만 간다
//  post_message 는 lib/chat-post 의 postChatMessage, ask_omnis 는 lib/omnis-ask 의 askOmnis —
//  화면(app/api)이 부르는 바로 그 함수다. MCP 전용 지름길을 만들면 알림·재구성·색인
//  중 하나가 빠지고, 그것은 조용히 빠진다.
//
// 권한
//  Omnis 계정이 살아 있으면 누구나 붙는다. 지식재산권 도구만 ip.members 로 한 번 더 건다.
//  Prisma 는 DB 소유자로 붙으므로 이 파일이 곧 권한 경계다.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto"

import { prisma } from "@/lib/db"
import { putObject, objectKeyFor, MAX_UPLOAD_BYTES } from "@/lib/storage"
import { openFileObject } from "@/lib/file-object"
import { TASK_STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants"
import { retrieveContext, sectionToText, syncEmbeddingsSafe, type EmbeddingSource } from "@/lib/embeddings"
import { migrateContent } from "@/lib/omnis-types"
import { askOmnis, buildCrmOverview, SOURCE_LABEL } from "@/lib/omnis-ask"
import { postChatMessage } from "@/lib/chat-post"
import { listWeeklyReports, updateWeeklyReport, upsertThisWeekReport } from "@/lib/weekly-report"
import { createOmnisCard, updateOmnisCard } from "@/lib/omnis-cards"
import { readChatFeed, type FeedView } from "@/lib/chat-feed"
import type { Prisma } from "@/generated/prisma/client"
import { createNotification } from "@/lib/notifications"
import { getMembership, type IpMembership } from "@/lib/ip-data"
import { persistMentions } from "@/lib/mentions"
import { quoteTotals, QUOTE_STATUS_LABEL } from "@/lib/crm"
import { companyProfileText, companyRecordsText, contextText, deleteCompanyRecordText, marketCompaniesText, saveCompanyRecordText, staffText, taxInvoicesText } from "@/lib/company-tools"
import { respondToAction } from "@/lib/notifications"
import { updateTask, type UpdateTaskInput } from "@/lib/task-update"
import { addChecklistItem, deleteChecklistItem, updateChecklistItem } from "@/lib/checklists"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import * as XLSX from "xlsx"
import {
  TOOLS as IP_TOOLS,
  INSTRUCTIONS as IP_INSTRUCTIONS,
  runTool as runIpTool,
  sha256,
  type ToolResult as IpToolResult,
} from "@/lib/ip-mcp"

export { PROTOCOL_VERSION, randomToken, sha256 } from "@/lib/ip-mcp"
/** 옴니스 도구는 이미지를 함께 돌려줄 수 있다(read_file). 라우트가 MCP image content 로 옮긴다. */
export type ToolResult = IpToolResult | { text: string; image: { data: string; mimeType: string } }
export const SERVER_INFO = { name: "hadd-omnis", version: "2.1.0" }
export { MAX_UPLOAD_BYTES }

export interface Caller {
  userId: string
  name: string
  role: "ADMIN" | "MEMBER"
  /** 지식재산권 구성원일 때만. 아니면 IP 도구는 거절된다. */
  ip: IpMembership | null
}

/**
 * 토큰 원문 → 사람.
 *
 * hadd-ip 는 DB 함수(ip.resolve_*_token)가 ip.members 와 조인해 돌려줬다 — 구성원이
 * 아니면 아무것도 안 나왔다. 여기서는 토큰 → Omnis 사용자를 먼저 풀고, 지식재산권
 * 멤버십은 따로 붙인다. 마지막 사용 시각 갱신과 조회를 한 문장(UPDATE … RETURNING)으로
 * 끝내는 것은 그대로다.
 */
export async function resolveCaller(authorization: string | null): Promise<Caller | null> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!token) return null
  const hash = sha256(token)

  const rows = token.startsWith("hadd_")
    ? await prisma.$queryRaw<{ user_id: string }[]>`
        UPDATE ip.mcp_tokens SET last_used_at = now()
         WHERE token_hash = ${hash} AND revoked_at IS NULL
         RETURNING user_id`
    : await prisma.$queryRaw<{ user_id: string }[]>`
        UPDATE ip.oauth_tokens SET last_used_at = now()
         WHERE access_hash = ${hash} AND revoked_at IS NULL AND expires_at > now()
         RETURNING user_id`
  if (rows.length === 0) return null

  const user = await prisma.user.findUnique({
    where: { id: rows[0].user_id },
    select: { id: true, name: true, role: true, isActive: true },
  })
  if (!user || !user.isActive) return null

  return { userId: user.id, name: user.name, role: user.role, ip: await getMembership(user.id) }
}

// ─── 지침 ───────────────────────────────────────────────────────────

export const INSTRUCTIONS = [
  "HADD SCIENCE 의 업무 시스템 Omnis 입니다. 업무·채팅·사내 지식·CRM(고객/견적/재고)·지식재산권을 읽고, 채팅에 글을 남기거나 업무를 만들 수 있습니다.",
  "「어떻게 돼가?」 같은 질문은 ask_omnis 가 가장 낫습니다 — 전체 현황과 검색을 합쳐 답합니다. 특정 업무의 원문이 필요하면 get_task.",
  "업무에 지시·보고를 남길 때는 post_message 에 task 를 함께 줍니다. 그러면 화면에서 #슬러그 로 쓴 것과 똑같이 업무 카드가 AI 로 재구성되고 담당자에게 알림이 갑니다.",
  "사람 이름은 list_members 의 정식 이름을 씁니다. 업무는 슬러그·ID·이름 일부 어느 것으로든 찾습니다 — 사용자에게 ID 를 되묻지 않습니다.",
  "파일은 upload_file(텍스트·작은 파일) 또는 create_upload_link(셸에서 curl 로 올리는 링크)로 올리고, 받은 파일 ID 를 post_message 의 files 에 넣어 채팅·업무 스레드에 붙입니다. 첨부를 읽을 때는 get_task 에 보이는 파일 ID 로 read_file.",
  "「나한테 온 거」는 list_notifications. 업무 수락·완료 확인은 respond_notification 으로 — 사용자 본인에게 온 알림에만 응답할 수 있습니다.",
  "주간보고는 list_weekly_reports·write_weekly_report, 사내 지식 카드 작성은 write_omnis_card, 업무 밖 채팅은 list_chat 입니다.",
  "업무 카드의 상태·마감·우선순위는 update_task, 체크리스트는 update_checklist. 진행 보고라면 post_message 가 먼저입니다(담당자 확인과 AI 재구성이 따라옵니다).",
  "회사 정보·재무는 company_profile, 연혁·수상·정부과제는 list_company_records, 세금계산서·기관별 매출은 list_tax_invoices, 인력·직함은 list_staff, 「X 와 엮인 것」 은 get_context. 매출의 확정·잠정·계획을 섞어 더하지 않습니다.",
  "",
  IP_INSTRUCTIONS.replace("HADD SCIENCE 지식재산권 기록 서버입니다.", "지식재산권 도구(list_ip·get_ip·add_progress …)는 구성원에게만 열립니다."),
].join("\n")

// ─── 도구 ───────────────────────────────────────────────────────────

const TASK_STATUS = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const

export const OMNIS_TOOLS = [
  {
    name: "ask_omnis",
    description:
      "옴니스 AI 에게 묻는다. 질문에 맞춰 검색·업무·CRM·지식재산권 도구를 스스로 골라 부르고 답한다. 「X 어디까지 됐어」「지연된 업무」「재고 얼마 남았어」처럼 현황을 묻는 질문에 먼저 쓴다. 화면의 「Omnis AI 에게 질문하기」와 같은 것이다.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "한국어 질문. 500자 이내." } },
      required: ["question"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "의미 검색. 질문에 가까운 채팅·업무·지식 카드·주간보고·지식재산권 조각을 유사도 순으로 돌려준다. ask_omnis 가 답을 만들기 전에 무엇을 근거로 삼는지 직접 보고 싶을 때, 또는 원문 조각이 필요할 때.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sources: {
          type: "array",
          items: { type: "string", enum: ["TASK", "CHAT_MESSAGE", "OMNIS_CARD", "WEEKLY_REPORT", "IP_CASE"] },
          description: "생략하면 전부",
        },
        limit: { type: "integer", description: "기본 8, 최대 30" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tasks",
    description:
      "업무 목록. 상태·담당자·프로젝트·이름으로 거른다. mine=true 면 내가 담당인 것만, overdue=true 면 마감이 지난 미완료만. 결과는 최근 만든 순.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...TASK_STATUS], description: "TODO 할 일 · IN_PROGRESS 진행 중 · REVIEW 검토 · DONE 완료" },
        assignee: { type: "string", description: "담당자 이름 (일부도 됨)" },
        project: { type: "string", description: "프로젝트 이름 일부" },
        query: { type: "string", description: "업무 이름·배경에 포함된 말" },
        mine: { type: "boolean" },
        overdue: { type: "boolean" },
        limit: { type: "integer", description: "기본 50, 최대 200" },
      },
    },
  },
  {
    name: "get_task",
    description:
      "업무 하나의 전부 — 상태·담당·마감·배경·기대결과·체크리스트·최근 대화·첨부. 「이 업무 원문이 뭐였지」에 답할 때. task 는 슬러그(#없이)·ID·이름 일부 어느 것이든 된다.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        messages: { type: "integer", description: "함께 보여줄 최근 메시지 수. 기본 20, 최대 100" },
      },
      required: ["task"],
    },
  },
  {
    name: "post_message",
    description: [
      "회사 채팅에 글을 남긴다. task 를 주면 그 업무 스레드에 붙고, 화면에서 #슬러그 로 쓴 것과 똑같이 처리된다 —",
      "AI 가 대화 전체를 읽어 업무 카드(배경·체크리스트·상태)를 재구성하고, 완료로 보이면 담당자에게 확인을 묻고, 관련자에게 알림이 간다.",
      "그러니 지시·보고·피드백은 task 와 함께 보낸다. 잡담이나 공지는 task 없이.",
      "글은 사용자 본인 이름으로 올라간다. 사용자가 말한 내용을 옮길 뿐 지어내지 않는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "올릴 글. #슬러그 를 직접 적어도 된다." },
        task: { type: "string", description: "업무 슬러그·ID·이름 일부. 생략하면 스레드 없이 전체 채팅에." },
        files: { type: "array", items: { type: "string" }, description: "첨부할 파일 ID. upload_file·create_upload_link 로 받은 것" },
      },
      required: ["content"],
    },
  },
  {
    name: "upload_file",
    description: [
      "파일을 Omnis 첨부로 올린다(회사 NAS 에 저장). 돌려받은 파일 ID 를 post_message 의 files 에 넣어야 채팅·업무 스레드에 첨부로 보인다.",
      "텍스트(md·csv·txt·json …)는 content 에 그대로, 작은 바이너리는 content_base64 로. 둘 중 하나만.",
      "PDF·이미지·오피스 파일처럼 큰 것을 셸이 있는 환경에서 올릴 때는 create_upload_link 가 낫다 — 본문을 인자로 옮기지 않는다.",
      `task 를 주면 그 업무의 첨부 목록에도 바로 보인다. 최대 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`,
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "확장자를 포함한 파일 이름. 예: 킥오프_회의록.md" },
        content: { type: "string", description: "텍스트 파일 본문 (UTF-8)" },
        content_base64: { type: "string", description: "바이너리 파일 본문 (base64)" },
        mime_type: { type: "string", description: "생략하면 확장자로 정한다" },
        task: { type: "string", description: "업무 슬러그·ID·이름 일부" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_upload_link",
    description: [
      "셸(curl)로 파일을 직접 올리는 10분짜리 링크를 만든다. `curl -F file=@경로 '<링크>'` 가 파일 ID 를 JSON 으로 돌려주고, 그 ID 를 post_message 의 files 에 넣는다.",
      `여러 번 쓸 수 있다. 최대 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB. 링크가 곧 사용자 권한이므로 대화 밖으로 옮기지 않는다.`,
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: { task: { type: "string", description: "업무 슬러그·ID·이름 일부. 주면 올린 파일이 그 업무 첨부로 들어간다." } },
    },
  },
  {
    name: "read_file",
    description: [
      "첨부 파일을 읽는다. 텍스트(md·csv·txt·json …)는 본문, 엑셀(xlsx·xls)은 시트별 CSV, 이미지는 이미지로 돌려준다.",
      "PDF·워드·한글처럼 여기서 풀지 못하는 형식은 10분짜리 내려받기 링크를 준다 — 셸이 있으면 curl 로 받아 연다.",
      "file 은 get_task 의 첨부 목록에 나오는 파일 ID. ID 를 모르면 task 와 name(일부)으로 찾는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "파일 ID" },
        task: { type: "string", description: "업무 슬러그·ID·이름 일부 (file 이 없을 때)" },
        name: { type: "string", description: "파일 이름 일부 (file 이 없을 때)" },
      },
    },
  },
  {
    name: "list_notifications",
    description: [
      "사용자 본인의 알림. 응답을 기다리는 것(업무 수락 · 완료 확인)을 먼저, 그다음 최근 알림을 보여준다.",
      "「나한테 온 거 뭐 있어」「확인할 것 있어?」에 쓴다. 응답은 respond_notification.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "최근 알림 수. 기본 10, 최대 50" } },
    },
  },
  {
    name: "respond_notification",
    description: [
      "사용자 본인에게 온 액션 알림에 응답한다 — 화면의 알림 버튼과 같은 것.",
      "업무 수락은 accept, 완료 확인은 confirm_done(업무를 완료로 표시하고 체크리스트를 모두 체크, 지시자에게 알림) 또는 defer(아직).",
      "confirm_done 은 되돌리기 번거로우니 사용자가 완료라고 분명히 말했을 때만. notification 대신 task 를 주면 그 업무에 떠 있는 알림을 찾는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        notification: { type: "string", description: "알림 ID (list_notifications)" },
        task: { type: "string", description: "업무 슬러그·ID·이름 일부 (notification 이 없을 때)" },
        response: { type: "string", enum: ["accept", "confirm_done", "defer"] },
      },
      required: ["response"],
    },
  },
  {
    name: "update_task",
    description: [
      "업무 카드를 고친다 — 화면의 업무 상세에서 고치는 것과 같은 길. 준 필드만 바뀐다.",
      "상태를 DONE 으로 바꾸면 떠 있는 완료 확인 알림이 거둬진다. 담당자 확인을 거치려면 post_message 로 보고하는 편이 낫다.",
      "마감은 사용자가 말한 날짜만. 빈 문자열이면 마감을 지운다. project 는 기존 프로젝트 이름(list_projects), 빈 문자열이면 프로젝트에서 뺀다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "업무 슬러그·ID·이름 일부" },
        status: { type: "string", enum: [...TASK_STATUS], description: "TODO 할 일 · IN_PROGRESS 진행 중 · REVIEW 검토 · DONE 완료" },
        name: { type: "string" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH"] },
        deadline: { type: "string", description: "YYYY-MM-DD (KST). 빈 문자열이면 지운다" },
        background: { type: "string" },
        expected_result: { type: "string" },
        project: { type: "string", description: "기존 프로젝트 이름 (일부도 됨). 빈 문자열이면 뺀다" },
        archived: { type: "boolean", description: "true 면 보관(목록에서 사라진다)" },
      },
      required: ["task"],
    },
  },
  {
    name: "update_checklist",
    description: [
      "업무 체크리스트를 고친다. 항목은 번호(get_task 에 보이는 1부터) 또는 이름(일부)으로 가리킨다.",
      "순서: remove → add → check → uncheck. 번호는 고치기 전 목록 기준이다.",
      "모두 체크해도 업무 상태는 바뀌지 않는다 — 완료는 담당자 확인(respond_notification)이나 update_task 로.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "업무 슬러그·ID·이름 일부" },
        add: { type: "array", items: { type: "string" }, description: "새 항목 이름" },
        check: { type: "array", items: { type: "string" }, description: "체크할 항목 (번호 또는 이름)" },
        uncheck: { type: "array", items: { type: "string" }, description: "체크를 풀 항목" },
        remove: { type: "array", items: { type: "string" }, description: "지울 항목" },
      },
      required: ["task"],
    },
  },
  {
    name: "create_task",
    description: [
      "새 업무를 만든다. 지시자는 사용자 본인, 담당자는 1명 이상 필수(정식 이름 — list_members 로 확인).",
      "같은 일이 이미 있는지 list_tasks 로 먼저 본다. 프로젝트는 있는 것에만 붙인다(list_projects) — 없으면 비워 두면 '기타' 가 아니라 프로젝트 없음이다.",
      "마감은 대화에 명시된 날짜만 넣는다. 지어낸 마감은 화면에 잘못된 '지연' 으로 뜬다.",
      "만들면 담당자에게 수락 알림이 가고 채팅에 지시 원문과 카드가 올라간다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "20자 안팎의 명사구. 예: CHAMP+ 2차면접 발표자료 준비" },
        assignees: { type: "array", items: { type: "string" }, description: "담당자 정식 이름들" },
        instruction: { type: "string", description: "사용자가 한 지시 원문. 채팅에 그대로 올라간다." },
        background: { type: "string" },
        checklist: { type: "array", items: { type: "string" }, description: "2~5개. 대화에서 실제 요구된 행동만" },
        deadline: { type: "string", description: "YYYY-MM-DD (KST). 명시된 경우만" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH"] },
        project: { type: "string", description: "기존 프로젝트 이름 (일부도 됨)" },
      },
      required: ["name", "assignees"],
    },
  },
  {
    name: "list_projects",
    description: "프로젝트(과제) 목록과 각각의 업무 수. 이 회사에서 프로젝트는 정부과제·행사·교육프로그램 단위다.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, includeArchived: { type: "boolean" } },
    },
  },
  {
    name: "list_members",
    description: "구성원 이름·직급·부서. 담당자를 지정하거나 「우창」「혜린씨」 같은 호칭을 정식 이름으로 바꿀 때 본다.",
    inputSchema: { type: "object", properties: { includeInactive: { type: "boolean", description: "과거 구성원 포함" } } },
  },
  {
    name: "crm_overview",
    description: "CRM 현황 전량 — 원료·완제품 재고, 생산 기록, 배합, 견적 전부, 샘플요청 전부. 계산되는 값이라 물을 때마다 센다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "find_org",
    description: "거래 기관 찾기. 이름·코드 일부로 찾아 담당자·견적·샘플요청·출고 이력을 돌려준다.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "list_omnis_cards",
    description: "사내 지식 카드(옴니스) 목록. 분류·제목·태그로 거른다. 본문은 get_omnis_card.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "get_omnis_card",
    description: "지식 카드 본문 전부. card 는 ID 또는 제목 일부.",
    inputSchema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] },
  },
  {
    name: "write_omnis_card",
    description: [
      "지식 카드를 만들거나 고친다. card 에 ID·제목 일부를 주면 그 카드를, 없으면 새로 만든다(새 카드는 category 와 title 이 필요하다).",
      "markdown 은 첫 텍스트 구역의 본문을 바꾼다 — 표·키값 구역은 건드리지 않는다. append=true 면 기존 본문 뒤에 덧붙인다.",
      "화면에서 쓴 것과 똑같이 버전 기록·Git 커밋·색인이 남는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        card: { type: "string", description: "고칠 카드의 ID 또는 제목 일부. 생략하면 새 카드" },
        title: { type: "string", description: "카드 제목" },
        category: { type: "string", description: "분류 이름 — list_omnis_cards 의 [대괄호] 안 이름" },
        markdown: { type: "string", description: "본문" },
        append: { type: "boolean", description: "true 면 기존 본문 뒤에 덧붙인다" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "list_weekly_reports",
    description: "사용자 본인의 주간보고. 주차·상태·그 주의 완료/진행 업무와 본문을 준다. 남의 보고서는 보이지 않는다.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", description: "기본 4, 최대 20" } } },
  },
  {
    name: "write_weekly_report",
    description: [
      "이번 주 주간보고를 만들거나 고친다. 인자 없이 부르면 이번 주 업무(완료·진행)를 다시 세어 담는다 — 사람이 쓴 본문은 지우지 않는다.",
      "draft=true 면 AI 초안을 함께 만들고, markdown 을 주면 본문을 그 글로 바꾸고, submit=true 면 「제출 완료」로 표시한다.",
      "report 에 ID 를 주면 그 주차 보고서의 본문·상태만 고친다(지난 주 수정).",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        draft: { type: "boolean", description: "AI 초안 생성" },
        markdown: { type: "string", description: "보고서 본문" },
        submit: { type: "boolean", description: "제출 완료로 표시" },
        report: { type: "string", description: "고칠 보고서 ID (list_weekly_reports). 생략하면 이번 주" },
      },
    },
  },
  {
    name: "list_chat",
    description: [
      "업무 밖 채팅까지 읽는다. view=all 최근 전체 · task 업무 하나에 걸린 글(스레드 + #멘션) · dm 나와 그 사람이 서로 @부른 글 · ai 옴니스 AI 가 쓰거나 불린 글.",
      "특정 업무의 대화만 필요하면 get_task 가 더 짧다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["all", "task", "dm", "ai"], description: "기본 all" },
        task: { type: "string", description: "view=task 일 때 업무 슬러그·ID·이름 일부" },
        user: { type: "string", description: "view=dm 일 때 상대 이름" },
        limit: { type: "integer", description: "기본 40, 최대 200" },
      },
    },
  },
  // ─── 회사 Context (lib/company-tools) — 개인정보는 내보내지 않는다 ───
  {
    name: "company_profile",
    description:
      "회사 기본정보(상호·사업자등록번호·업종·설립일·주소·홈페이지)와 연도별 재무(매출·제품/용역·자산·부채·자본·순이익·상시근로자). 매출은 공급가액이고 확정(결산서)·잠정(결산 전 세금계산서 합)·계획을 나눠 준다. 지원서·과제 서식에 들어갈 회사 정보나 매출을 물으면 쓴다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_company_records",
    description:
      "회사 연혁·실적 — 지원사업(정부과제)·수상·학회·전시·포럼·교육·네트워킹·주요 사건. 기간·주관기관·지원금·과제번호가 있다. 「수상 내역」「수행한 정부과제」「작년 전시회」 를 물으면 쓴다.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "제목·기관·과제명 일부" },
        kind: {
          type: "string",
          enum: ["GRANT", "AWARD", "EXHIBITION", "FORUM", "EDUCATION", "NETWORKING", "INTERNAL", "MILESTONE"],
          description: "GRANT 지원사업 · AWARD 수상 · EXHIBITION 학회·전시 · FORUM 포럼·세미나 · EDUCATION 교육 · NETWORKING 네트워킹 · INTERNAL 내부행사 · MILESTONE 주요 사건",
        },
        year: { type: "integer", description: "시작 연도" },
      },
    },
  },
  {
    name: "save_company_record",
    description:
      "회사 연혁·실적을 남기거나 고친다. 수상·전시·MOU·과제 선정처럼 사건이 생긴 자리에서 바로 적는다. record_id 를 주면 그 줄을 고치고(준 칸만 바뀐다), 주지 않으면 새로 만든다. 같은 사건을 두 번 넣으면 거절된다.",
    inputSchema: {
      type: "object",
      properties: {
        record_id: { type: "string", description: "고칠 연혁 id. 없으면 새로 만든다 (list_company_records 로 찾는다)" },
        kind: {
          type: "string",
          enum: ["GRANT", "AWARD", "EXHIBITION", "FORUM", "EDUCATION", "NETWORKING", "INTERNAL", "MILESTONE"],
          description: "GRANT 지원사업 · AWARD 수상 · EXHIBITION 학회·전시 · FORUM 포럼·세미나 · EDUCATION 교육 · NETWORKING 네트워킹 · INTERNAL 내부행사 · MILESTONE 주요 사건",
        },
        title: { type: "string", description: "제목. 새로 만들 때 필수" },
        organizer: { type: "string", description: "주관 기관" },
        starts_on: { type: "string", description: "시작일 YYYY-MM-DD" },
        ends_on: { type: "string", description: "종료일 YYYY-MM-DD" },
        period_raw: { type: "string", description: "원문 기간 표기(예: 2026.04.28~04.30). 비우면 날짜로 만든다" },
        status: { type: "string", description: "완료 · 진행중 · 발표완료 · 계획" },
        venue: { type: "string", description: "장소" },
        prize: { type: "string", description: "상격(수상)" },
        subject: { type: "string", description: "과제명" },
        grant_no: { type: "string", description: "과제번호" },
        funding_krw: { type: "string", description: "지원금(원). 숫자" },
        note: { type: "string", description: "비고 — 근거가 된 메일·문서를 적어 둔다" },
      },
    },
  },
  {
    name: "delete_company_record",
    description:
      "연혁·실적 한 줄을 지운다. 같은 사건이 두 줄로 들어갔을 때 정리하는 용도다. 되돌릴 수 없으니 list_company_records 로 확인한 id 만 넘긴다.",
    inputSchema: {
      type: "object",
      properties: { record_id: { type: "string", description: "지울 연혁 id (list_company_records 가 줄 끝에 함께 준다)" } },
      required: ["record_id"],
    },
  },
  {
    name: "list_tax_invoices",
    description: "발행된 세금계산서 — 날짜·기관·품목·공급가액·제품/용역 구분·연결된 견적, 연도별 매출 합. 「올해 누구에게 얼마 팔았나」「기관별 매출」 을 물으면 쓴다.",
    inputSchema: { type: "object", properties: { year: { type: "integer" }, org: { type: "string", description: "기관명 일부" } } },
  },
  {
    name: "list_staff",
    description: "인력 — 재직자의 이름·소속·직급·하드사이언스 역할(CAO·CMO 등)·담당 업무·학력·4대보험 가입 여부. 과제 참여연구원 구성이나 직함을 물으면 쓴다. 연락처·생년월일·서명은 주지 않는다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_market_companies",
    description: "시장·경쟁 기업(오가노이드·배양 소재 관련) — 국가·분류·주력 제품·매출 원문. 경쟁사·시장 조사를 물으면 쓴다. 거래처는 find_org.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, segment: { type: "string" } } },
  },
  {
    name: "get_context",
    description:
      "대상 하나(업무·프로젝트·사람·기관·견적·세금계산서·연혁·특허·카드)와 DB 로 이어진 것, 의미상 가까운 것. 「국일그래핀과 엮인 견적·세금계산서」「이 과제에 딸린 업무」 처럼 관계를 물으면 쓴다. node 는 이전 결과의 key, 없으면 query 에 이름을 준다.",
    inputSchema: { type: "object", properties: { node: { type: "string" }, query: { type: "string" } } },
  },
] as const

export const TOOLS = [...OMNIS_TOOLS, ...IP_TOOLS]

const IP_TOOL_NAMES = new Set<string>(IP_TOOLS.map((t) => t.name))

// ─── 도우미 ─────────────────────────────────────────────────────────

const kst = (d: Date | null | undefined, withTime = false) =>
  d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, withTime ? 16 : 10) : ""
const clampInt = (v: unknown, def: number, max: number) =>
  Math.min(max, Math.max(1, Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : def))
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

const TASK_SELECT = {
  id: true, name: true, slug: true, status: true, priority: true, deadline: true, createdAt: true, updatedAt: true,
  project: { select: { name: true } },
  product: { select: { name: true } },
  instructor: { select: { name: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} as const

type TaskRow = {
  id: string; name: string; slug: string; status: string; priority: string; deadline: Date | null; createdAt: Date; updatedAt: Date
  project: { name: string } | null; product: { name: string } | null; instructor: { name: string }
  assignees: { user: { id: string; name: string } }[]
}

const isOverdue = (t: { status: string; deadline: Date | null }) =>
  t.status !== "DONE" && !!t.deadline && t.deadline.getTime() < Date.now()

function taskLine(t: TaskRow): string {
  const bits = [
    `#${t.slug}`, t.name, TASK_STATUS_LABELS[t.status] ?? t.status,
    `담당 ${t.assignees.map((a) => a.user.name).join(",") || "미배정"}`,
  ]
  if (t.deadline) bits.push(`마감 ${kst(t.deadline)}${isOverdue(t) ? " (지연)" : ""}`)
  if (t.project) bits.push(t.project.name)
  if (t.priority === "HIGH") bits.push("중요")
  return `- ${bits.join(" · ")}`
}

/**
 * 업무 찾기 — ID → 슬러그 → 이름 일부(최근 것 우선).
 * 이름으로 여럿이 걸리고 정확히 같은 이름이 없으면 고르지 않고 후보를 돌려준다.
 */
async function findTask(ref: string): Promise<{ id: string } | { error: string }> {
  const key = ref.replace(/^#/, "").trim()
  if (!key) return { error: "task 가 비어 있습니다." }
  const direct = await prisma.task.findFirst({
    where: { OR: [{ id: key }, { slug: key }], archived: false },
    select: { id: true },
  })
  if (direct) return direct
  const hits = await prisma.task.findMany({
    where: { archived: false, name: { contains: key, mode: "insensitive" } },
    select: { id: true, name: true, slug: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  })
  if (hits.length === 0) return { error: `'${key}' 에 맞는 업무가 없습니다. list_tasks 로 찾아보세요.` }
  const exact = hits.find((h) => h.name === key)
  if (hits.length === 1 || exact) return { id: (exact ?? hits[0]).id }
  return {
    error: [
      `'${key}' 에 맞는 업무가 ${hits.length}개입니다. 슬러그로 다시 부르세요.`,
      ...hits.map((h) => `- #${h.slug} · ${h.name} · ${TASK_STATUS_LABELS[h.status] ?? h.status} · ${kst(h.createdAt)}`),
    ].join("\n"),
  }
}

/** 이름 → 사용자. 정확히 같은 이름 우선, 없으면 「우창님」「혜린씨」 같은 호칭을 벗긴 부분 일치. */
async function findUsers(names: string[]): Promise<{ ids: string[]; missing: string[] }> {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true } })
  const ids: string[] = []
  const missing: string[] = []
  for (const raw of names) {
    const n = raw.trim().replace(/(님|씨|박사님|대표님|과장님|상무님)$/g, "")
    const hit = users.find((u) => u.name === raw.trim()) ?? users.find((u) => u.name === n) ?? users.find((u) => u.name.includes(n) && n.length >= 2)
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id) } else missing.push(raw)
  }
  return { ids, missing }
}

// ─── 파일 ───────────────────────────────────────────────────────────
//
// 화면(app/api/files POST)과 같은 순서 — NAS 에 먼저 올리고, 성공한 뒤에만 File 을 적는다.
// 그 라우트는 배포 파일이라 건드리지 않고(ai-pairing.md) 같은 저장 함수를 부른다.

const MIME_BY_EXT: Record<string, string> = {
  md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html",
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip", zip: "application/zip",
}

/** 준 형식이 없거나 curl 기본값(octet-stream)이면 확장자로 정한다. 텍스트는 한글이 깨지지 않게 charset 을 붙인다. */
function mimeFor(name: string, given: string): string {
  const g = given.trim()
  if (g && g !== "application/octet-stream") return g
  const type = MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"
  return type.startsWith("text/") ? `${type}; charset=utf-8` : type
}

export async function saveUpload(input: {
  name: string; body: Buffer; mimeType: string; taskId: string | null
}): Promise<{ id: string; name: string; size: number } | { error: string }> {
  const name = input.name.trim().replace(/[/\\]/g, "_")
  if (!name) return { error: "name 이 비어 있습니다." }
  if (input.body.length === 0) return { error: "빈 파일입니다." }
  if (input.body.length > MAX_UPLOAD_BYTES) {
    return { error: `파일이 너무 큽니다. ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다.` }
  }
  const id = randomUUID()
  const mimeType = mimeFor(name, input.mimeType)
  await putObject(objectKeyFor(id, name), input.body, mimeType)
  return prisma.file.create({
    data: { id, name, path: `/api/files/${id}/raw`, size: input.body.length, mimeType, taskId: input.taskId },
    select: { id: true, name: true, size: true },
  })
}

/**
 * 업로드·내려받기 링크 — `{payload}.{hmac}`. 표를 새로 만들지 않으려고 상태 없는 서명으로 한다.
 * claude.ai 커넥터는 OAuth 토큰을 모델에게 보여주지 않으므로, 셸에서 curl 로 오가려면 링크 자체가 자격이어야 한다.
 * 용도를 서명에 섞어 업로드 링크로 내려받거나 그 반대가 되지 않게 한다.
 */
const LINK_TTL_SEC = 10 * 60
type LinkPurpose = "upload" | "download"

function linkSignature(purpose: LinkPurpose, payload: string): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET 이 설정되지 않았습니다")
  return createHmac("sha256", secret).update(`mcp-${purpose}.${payload}`).digest("base64url")
}

function signLink(purpose: LinkPurpose, data: Record<string, string | null>): string {
  const payload = Buffer.from(JSON.stringify({ ...data, e: Math.floor(Date.now() / 1000) + LINK_TTL_SEC })).toString("base64url")
  return `${payload}.${linkSignature(purpose, payload)}`
}

async function verifyLink(purpose: LinkPurpose, token: string): Promise<Record<string, unknown> | null> {
  const [payload, sig, extra] = token.split(".")
  if (!payload || !sig || extra !== undefined) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(linkSignature(purpose, payload))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let p: Record<string, unknown>
  try {
    p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (typeof p.u !== "string" || typeof p.e !== "number" || p.e * 1000 < Date.now()) return null
  // 링크를 만든 뒤 계정이 닫혔으면 막는다 — resolveCaller 와 같은 기준.
  const user = await prisma.user.findUnique({ where: { id: p.u }, select: { isActive: true } })
  if (!user?.isActive) return null
  return p
}

export const signUploadLink = (userId: string, taskId: string | null) => signLink("upload", { u: userId, t: taskId })

export async function verifyUploadLink(token: string): Promise<{ taskId: string | null } | null> {
  const p = await verifyLink("upload", token)
  return p ? { taskId: typeof p.t === "string" ? p.t : null } : null
}

export const signDownloadLink = (userId: string, fileId: string) => signLink("download", { u: userId, f: fileId })

export async function verifyDownloadLink(token: string): Promise<{ fileId: string } | null> {
  const p = await verifyLink("download", token)
  return p && typeof p.f === "string" ? { fileId: p.f } : null
}

type FileRow = { id: string; name: string; path: string; mimeType: string; size: number; task: { slug: string } | null }

/** 파일 찾기 — ID, 없으면 업무 첨부(업무에 직접 붙었거나 그 스레드 메시지에 붙은 것) 중 이름 일부. 여럿이면 고르지 않는다. */
async function findFile(args: Record<string, unknown>): Promise<FileRow | { error: string }> {
  const select = { id: true, name: true, path: true, mimeType: true, size: true, task: { select: { slug: true } } } as const
  const id = str(args.file)
  if (id) {
    const f = await prisma.file.findUnique({ where: { id }, select })
    return f ?? { error: `'${id}' 파일이 없습니다. get_task 의 첨부 목록에서 파일 ID 를 확인하세요.` }
  }
  if (!str(args.task)) return { error: "file(파일 ID) 또는 task 를 주세요." }
  const found = await findTask(str(args.task))
  if ("error" in found) return found
  const q = str(args.name)
  const hits = await prisma.file.findMany({
    where: {
      OR: [{ taskId: found.id }, { message: { taskId: found.id } }],
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    select, orderBy: { createdAt: "desc" }, take: 20,
  })
  if (hits.length === 0) return { error: `업무에 ${q ? `'${q}' 에 맞는 ` : ""}첨부가 없습니다.` }
  if (hits.length === 1) return hits[0]
  return { error: [`첨부가 ${hits.length}개 걸립니다. file 에 파일 ID 를 주세요.`, ...hits.map((h) => `- ${h.name} · ${h.id}`)].join("\n") }
}

function fileKind(name: string, mimeType: string): "text" | "sheet" | "image" | "other" {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const m = mimeType.split(";")[0].trim()
  if (ext === "xlsx" || ext === "xls") return "sheet"
  if (/^image\/(png|jpeg|gif|webp)$/.test(m)) return "image"
  if (m.startsWith("text/") || m === "application/json" || ["md", "txt", "csv", "tsv", "json", "log", "xml", "yaml", "yml"].includes(ext)) return "text"
  return "other"
}

async function readObject(file: { id: string; name: string; path: string }): Promise<Buffer> {
  const res = await openFileObject(file)
  const chunks: Buffer[] = []
  for await (const chunk of res.body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** 모델 컨텍스트를 한 파일이 다 먹지 않게 자른다. */
const TEXT_LIMIT = 100_000
const clip = (s: string) =>
  s.length > TEXT_LIMIT ? `${s.slice(0, TEXT_LIMIT)}\n\n… (${s.length.toLocaleString()}자 중 앞 ${TEXT_LIMIT.toLocaleString()}자)` : s

// ─── 실행 ───────────────────────────────────────────────────────────

export async function runTool(
  name: string, args: Record<string, unknown>, caller: Caller, ctx: { base: string } = { base: "" }
): Promise<ToolResult> {
  if (IP_TOOL_NAMES.has(name)) {
    if (!caller.ip) {
      return { error: "지식재산권 도구는 구성원에게만 열립니다. 이 계정은 지식재산권 구성원이 아닙니다 — 담당자에게 권한을 요청하세요." }
    }
    return runIpTool(name, args, {
      userId: caller.ip.userId, email: caller.ip.email, displayName: caller.ip.displayName, role: caller.ip.role,
    })
  }

  switch (name) {
    case "ask_omnis": {
      const question = str(args.question)
      if (question.length < 2) return { error: "질문을 2자 이상 주세요." }
      if (question.length > 500) return { error: "질문이 너무 깁니다 (500자 이내)." }
      const r = await askOmnis(question, caller.userId)
      const src = r.sources.map((s, i) => `[${i + 1}] ${s.sourceLabel} · ${s.title} (${s.similarity}%)`)
      return { text: [r.answer, "", "근거:", ...src].join("\n") }
    }

    case "search_knowledge": {
      const query = str(args.query)
      if (!query) return { error: "query 가 비어 있습니다." }
      const sources = Array.isArray(args.sources)
        ? (args.sources.filter((s): s is EmbeddingSource => typeof s === "string" && s in SOURCE_LABEL))
        : undefined
      const chunks = await retrieveContext(query, { limit: clampInt(args.limit, 8, 30), sources, minSimilarity: 0.25, userId: caller.userId })
      if (chunks.length === 0) return { text: "비슷한 조각이 없습니다." }
      return {
        text: chunks
          .map((c, i) => `[${i + 1}] ${SOURCE_LABEL[c.source]} · ${c.title} (${Math.round(c.similarity * 100)}%)\n${c.content.slice(0, 600)}`)
          .join("\n\n"),
      }
    }

    case "list_tasks": {
      const where: Record<string, unknown> = { archived: false }
      const status = str(args.status)
      if (status && (TASK_STATUS as readonly string[]).includes(status)) where.status = status
      if (args.mine === true) where.assignees = { some: { userId: caller.userId } }
      else if (str(args.assignee)) where.assignees = { some: { user: { name: { contains: str(args.assignee) } } } }
      if (str(args.project)) where.project = { name: { contains: str(args.project), mode: "insensitive" } }
      if (str(args.query)) {
        where.OR = [
          { name: { contains: str(args.query), mode: "insensitive" } },
          { background: { contains: str(args.query), mode: "insensitive" } },
        ]
      }
      if (args.overdue === true) { where.status = { not: "DONE" }; where.deadline = { lt: new Date() } }
      const limit = clampInt(args.limit, 50, 200)
      const [rows, total] = await Promise.all([
        prisma.task.findMany({ where, select: TASK_SELECT, orderBy: { createdAt: "desc" }, take: limit }),
        prisma.task.count({ where }),
      ])
      if (rows.length === 0) return { text: "조건에 맞는 업무가 없습니다." }
      return { text: [`업무 ${total}건${total > rows.length ? ` 중 ${rows.length}건` : ""}`, ...rows.map(taskLine)].join("\n") }
    }

    case "get_task": {
      const found = await findTask(str(args.task))
      if ("error" in found) return found
      const t = await prisma.task.findUnique({
        where: { id: found.id },
        select: {
          ...TASK_SELECT, background: true, expectedResult: true, workStart: true, workEnd: true,
          checklists: { select: { name: true, done: true }, orderBy: { createdAt: "asc" } },
          files: { select: { id: true, name: true, size: true } },
        },
      })
      if (!t) return { error: "업무가 없습니다." }
      const n = clampInt(args.messages, 20, 100)
      const msgs = await prisma.chatMessage.findMany({
        where: { taskId: t.id, kind: "NORMAL" },
        select: { createdAt: true, content: true, author: { select: { name: true } }, files: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" }, take: n,
      })
      // 파일 ID 를 함께 보여준다 — read_file 이 ID 로 읽는다.
      const fileRef = (f: { id: string; name: string }) => `${f.name} (${f.id})`
      const lines = [
        `# ${t.name}  (#${t.slug})`,
        `상태 ${TASK_STATUS_LABELS[t.status] ?? t.status} · 우선순위 ${PRIORITY_LABELS[t.priority] ?? t.priority}` +
          (t.deadline ? ` · 마감 ${kst(t.deadline)}${isOverdue(t) ? " (지연)" : ""}` : "") +
          ` · 만든 날 ${kst(t.createdAt)}`,
        `지시 ${t.instructor.name} · 담당 ${t.assignees.map((a) => a.user.name).join(", ") || "미배정"}` +
          (t.project ? ` · 프로젝트 ${t.project.name}` : "") + (t.product ? ` · 제품 ${t.product.name}` : ""),
      ]
      if (t.background) lines.push("", `배경: ${t.background}`)
      if (t.expectedResult) lines.push(`기대결과: ${t.expectedResult}`)
      if (t.checklists.length) lines.push("", "체크리스트:", ...t.checklists.map((c, i) => `${i + 1}. [${c.done ? "x" : " "}] ${c.name}`))
      if (t.files.length) lines.push("", `첨부 ${t.files.length}: ${t.files.map(fileRef).join(", ")}`)
      if (msgs.length) {
        lines.push("", `대화 (최근 ${msgs.length}건, 시간순):`)
        for (const m of msgs.reverse()) {
          lines.push(`[${kst(m.createdAt, true)}] ${m.author.name}: ${m.content}${m.files.length ? ` [첨부: ${m.files.map(fileRef).join(", ")}]` : ""}`)
        }
      }
      return { text: lines.join("\n") }
    }

    case "post_message": {
      const content = str(args.content)
      if (!content) return { error: "content 가 비어 있습니다." }
      let taskId: string | undefined
      let slug: string | undefined
      if (str(args.task)) {
        const found = await findTask(str(args.task))
        if ("error" in found) return found
        const t = await prisma.task.findUnique({ where: { id: found.id }, select: { id: true, slug: true } })
        taskId = t?.id; slug = t?.slug
      }
      // 첨부 — 있는 파일이고 아직 어느 메시지에도 붙지 않은 것만. 화면 라우트는 확인 없이 붙이지만,
      // 여기서는 모델이 ID 를 잘못 옮기면 남의 메시지 첨부를 빼앗아 온다.
      const fileIds = Array.isArray(args.files) ? [...new Set(args.files.map(String).map((s) => s.trim()).filter(Boolean))] : []
      if (fileIds.length) {
        const rows = await prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true, messageId: true } })
        const missing = fileIds.filter((id) => !rows.some((r) => r.id === id))
        if (missing.length) return { error: `없는 파일 ID: ${missing.join(", ")}. upload_file 로 받은 ID 를 넣으세요.` }
        const taken = rows.filter((r) => r.messageId)
        if (taken.length) return { error: `이미 다른 메시지에 붙은 파일입니다: ${taken.map((r) => r.name).join(", ")}. 새로 올리세요.` }
      }
      // #슬러그가 본문에 이미 있으면 그대로, 없으면 앞에 붙인다 — 화면에서 쓰는 것과 같은 모양.
      const body = slug && !/#[a-z0-9가-힣_-]+/i.test(content) ? `#${slug} ${content}` : content
      const { message, taskUpdate } = await postChatMessage({
        user: { id: caller.userId, name: caller.name }, roomId: "default-room", content: body, taskId,
        fileIds: fileIds.length ? fileIds : undefined,
      })
      const out = [`올렸습니다 (${kst(message?.createdAt ?? new Date(), true)} · ${caller.name}).`]
      if (message?.files.length) out.push(`첨부 ${message.files.length}: ${message.files.map((f) => f.name).join(", ")}`)
      if (message?.task) out.push(`업무: #${message.task.slug} ${message.task.name}`)
      out.push(taskUpdate ? `업무 처리: ${taskUpdate.summary ?? taskUpdate.statusLabel ?? taskUpdate.action}` : "업무 카드 변경 없음 (정보 공유로 판단)")
      return { text: out.join("\n") }
    }

    case "upload_file": {
      const fileName = str(args.name)
      const hasText = typeof args.content === "string"
      const hasB64 = typeof args.content_base64 === "string"
      if (!fileName) return { error: "name 이 비어 있습니다. 확장자를 포함해 주세요." }
      if (hasText === hasB64) return { error: "content(텍스트) 와 content_base64(바이너리) 중 하나만 주세요." }
      const b64 = hasB64 ? (args.content_base64 as string).replace(/\s/g, "") : ""
      if (hasB64 && !/^[A-Za-z0-9+/_-]*={0,2}$/.test(b64)) return { error: "content_base64 가 base64 가 아닙니다." }
      let taskId: string | null = null
      let slug = ""
      if (str(args.task)) {
        const found = await findTask(str(args.task))
        if ("error" in found) return found
        const t = await prisma.task.findUnique({ where: { id: found.id }, select: { id: true, slug: true } })
        taskId = t?.id ?? null; slug = t?.slug ?? ""
      }
      const saved = await saveUpload({
        name: fileName,
        body: hasText ? Buffer.from(args.content as string, "utf8") : Buffer.from(b64, "base64"),
        mimeType: str(args.mime_type),
        taskId,
      })
      if ("error" in saved) return saved
      return {
        text: [
          `올렸습니다: ${saved.name} (${(saved.size / 1024).toFixed(1)}KB) · 파일 ID ${saved.id}`,
          ...(slug ? [`업무 #${slug} 첨부 목록에 들어갔습니다.`] : []),
          `채팅에 붙이려면 post_message 의 files 에 "${saved.id}" 를 넣으세요.`,
        ].join("\n"),
      }
    }

    case "create_upload_link": {
      if (!ctx.base) return { error: "이 서버 주소를 알 수 없어 링크를 만들 수 없습니다." }
      let taskId: string | null = null
      let slug = ""
      if (str(args.task)) {
        const found = await findTask(str(args.task))
        if ("error" in found) return found
        const t = await prisma.task.findUnique({ where: { id: found.id }, select: { id: true, slug: true } })
        taskId = t?.id ?? null; slug = t?.slug ?? ""
      }
      const url = `${ctx.base}/upload?t=${signUploadLink(caller.userId, taskId)}`
      return {
        text: [
          `업로드 링크 (10분, ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하${slug ? ` · 업무 #${slug} 첨부` : ""}):`,
          url,
          "",
          `curl -sS -F 'file=@<파일 경로>' '${url}'`,
          "",
          "응답 JSON 의 id 를 post_message 의 files 에 넣으세요. 여러 파일이면 같은 링크로 한 번씩 올립니다.",
        ].join("\n"),
      }
    }

    case "read_file": {
      const f = await findFile(args)
      if ("error" in f) return f
      const head = `# ${f.name}  (${(f.size / 1024).toFixed(1)}KB · ${f.mimeType}${f.task ? ` · 업무 #${f.task.slug}` : ""} · 파일 ID ${f.id})`
      const kind = fileKind(f.name, f.mimeType)
      if (kind === "other" || f.size > MAX_UPLOAD_BYTES) {
        if (!ctx.base) return { error: "이 서버 주소를 알 수 없어 내려받기 링크를 만들 수 없습니다." }
        const why = kind === "other"
          ? "이 형식은 여기서 본문을 풀지 못합니다."
          : `${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 가 넘어 본문 대신 링크를 줍니다.`
        const url = `${ctx.base}/download?t=${signDownloadLink(caller.userId, f.id)}`
        return { text: [head, "", `${why} 셸이 있으면 내려받아 여세요 (10분):`, url, "", `curl -sS -o '${f.name.replace(/'/g, "")}' '${url}'`].join("\n") }
      }
      const buf = await readObject(f)
      if (kind === "image") return { text: head, image: { data: buf.toString("base64"), mimeType: f.mimeType.split(";")[0].trim() } }
      if (kind === "sheet") {
        const wb = XLSX.read(buf, { type: "buffer" })
        const body = wb.SheetNames.map((s) => `## ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join("\n\n")
        return { text: `${head}\n\n${clip(body)}` }
      }
      return { text: `${head}\n\n${clip(buf.toString("utf8"))}` }
    }

    case "list_notifications": {
      const limit = clampInt(args.limit, 10, 50)
      const [pending, recent] = await Promise.all([
        prisma.notification.findMany({
          where: { userId: caller.userId, actionType: { not: null }, resolvedAt: null },
          orderBy: { createdAt: "desc" },
        }),
        prisma.notification.findMany({
          where: { userId: caller.userId, OR: [{ actionType: null }, { resolvedAt: { not: null } }] },
          orderBy: { createdAt: "desc" }, take: limit,
        }),
      ])
      const taskIds = [...new Set([...pending, ...recent].map((n) => n.entityId).filter((x): x is string => !!x))]
      const slugs = new Map((await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, slug: true } })).map((t) => [t.id, t.slug]))
      const ACTION_HINT: Record<string, string> = {
        accept_task: "업무 수락 대기 → respond_notification response=accept",
        confirm_done: "완료 확인 대기 → respond_notification response=confirm_done 또는 defer",
      }
      const line = (n: (typeof pending)[number]) => {
        const slug = n.entityId ? slugs.get(n.entityId) : undefined
        return `- [${kst(n.createdAt, true)}] ${n.title}${slug ? ` · #${slug}` : ""} — ${n.content}${n.read ? "" : " (안 읽음)"} · ID ${n.id}`
      }
      const out = [`응답 대기 ${pending.length}건`]
      for (const n of pending) out.push(line(n), `  ${ACTION_HINT[n.actionType ?? ""] ?? n.actionType}`)
      out.push("", `최근 알림 ${recent.length}건`, ...recent.map(line))
      return { text: out.join("\n") }
    }

    case "respond_notification": {
      const response = str(args.response)
      if (!["accept", "confirm_done", "defer"].includes(response)) {
        return { error: "response 는 accept · confirm_done · defer 중 하나입니다." }
      }
      let notificationId = str(args.notification)
      if (!notificationId) {
        if (!str(args.task)) return { error: "notification(알림 ID) 또는 task 를 주세요." }
        const found = await findTask(str(args.task))
        if ("error" in found) return found
        const n = await prisma.notification.findFirst({
          where: { userId: caller.userId, entityId: found.id, resolvedAt: null, actionType: response === "accept" ? "accept_task" : "confirm_done" },
          orderBy: { createdAt: "desc" }, select: { id: true },
        })
        if (!n) return { error: "이 업무에 사용자 본인이 응답할 알림이 없습니다. list_notifications 로 확인하세요." }
        notificationId = n.id
      }
      // 화면의 알림 버튼과 같은 함수 — 선점·업무 완료·지시자 알림이 여기서 한 번만 일어난다.
      const r = await respondToAction(caller.userId, caller.name, notificationId, response as "accept" | "confirm_done" | "defer")
      if ("error" in r) return { error: `${r.error}. list_notifications 로 사용자 본인의 알림 ID 를 확인하세요.` }
      if (r.alreadyResolved) return { text: "이미 응답한 알림입니다. 아무것도 바꾸지 않았습니다." }
      return {
        text: response === "confirm_done"
          ? "완료로 표시했습니다. 체크리스트를 모두 체크했습니다."
          : response === "accept" ? "업무를 수락했습니다." : "나중으로 미뤘습니다. 알림은 응답한 것으로 닫힙니다.",
      }
    }

    case "update_task": {
      const found = await findTask(str(args.task))
      if ("error" in found) return found
      const input: UpdateTaskInput = {}
      if (args.status !== undefined) {
        if (!(TASK_STATUS as readonly string[]).includes(str(args.status))) return { error: `status 는 ${TASK_STATUS.join(" · ")} 중 하나입니다.` }
        input.status = str(args.status) as UpdateTaskInput["status"]
      }
      if (args.name !== undefined) {
        if (!str(args.name)) return { error: "name 을 비울 수는 없습니다." }
        input.name = str(args.name).slice(0, 120)
      }
      if (args.priority !== undefined) {
        if (!["LOW", "NORMAL", "HIGH"].includes(str(args.priority))) return { error: "priority 는 LOW · NORMAL · HIGH 중 하나입니다." }
        input.priority = str(args.priority) as UpdateTaskInput["priority"]
      }
      if (args.deadline !== undefined) {
        const d = str(args.deadline)
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "deadline 은 YYYY-MM-DD 이거나 빈 문자열(지우기)입니다." }
        input.deadline = d ? `${d}T23:59:59+09:00` : null
      }
      if (args.background !== undefined) input.background = str(args.background) || null
      if (args.expected_result !== undefined) input.expectedResult = str(args.expected_result) || null
      if (args.archived !== undefined) input.archived = args.archived === true
      if (args.project !== undefined) {
        const q = str(args.project)
        if (!q) input.projectId = null
        else {
          const ps = await prisma.project.findMany({
            where: { archived: false, name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true }, take: 10,
          })
          if (ps.length === 0) return { error: `'${q}' 프로젝트가 없습니다. list_projects 로 확인하세요.` }
          const exact = ps.find((p) => p.name === q)
          if (ps.length > 1 && !exact) return { error: `프로젝트가 ${ps.length}개 걸립니다: ${ps.map((p) => p.name).join(" / ")}` }
          input.projectId = (exact ?? ps[0]).id
        }
      }
      if (Object.keys(input).length === 0) return { error: "바꿀 필드를 하나 이상 주세요." }

      const r = await updateTask(found.id, caller.userId, input)
      if ("error" in r) return r
      const t = r.task
      return {
        text: [
          `고쳤습니다: #${t.slug} ${t.name}`,
          `상태 ${TASK_STATUS_LABELS[t.status] ?? t.status} · 우선순위 ${PRIORITY_LABELS[t.priority] ?? t.priority}` +
            (t.deadline ? ` · 마감 ${kst(t.deadline)}` : " · 마감 없음") + (t.archived ? " · 보관됨" : ""),
          `바뀐 필드: ${Object.keys(input).join(", ")}`,
        ].join("\n"),
      }
    }

    case "update_checklist": {
      const found = await findTask(str(args.task))
      if ("error" in found) return found
      const listArg = (k: string) => (Array.isArray(args[k]) ? (args[k] as unknown[]).map(String).map((s) => s.trim()).filter(Boolean) : [])
      const [add, check, uncheck, remove] = ["add", "check", "uncheck", "remove"].map(listArg)
      if (add.length + check.length + uncheck.length + remove.length === 0) {
        return { error: "add · check · uncheck · remove 중 하나 이상 주세요." }
      }

      type Item = { id: string; name: string; done: boolean }
      const items: Item[] = await prisma.checklist.findMany({
        where: { taskId: found.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, done: true },
      })
      // 번호는 고치기 전 목록 기준, 이름은 지금 살아 있는 항목(추가될 것 포함)에서 찾는다.
      const resolveRef = (ref: string, pool: Item[]): Item | string => {
        if (/^\d+$/.test(ref)) return items[Number(ref) - 1] ?? `${ref}번(항목은 ${items.length}개)`
        const exact = pool.filter((c) => c.name === ref)
        const hits = exact.length ? exact : pool.filter((c) => c.name.includes(ref))
        if (hits.length === 1) return hits[0]
        return hits.length === 0 ? `'${ref}'(없음)` : `'${ref}'(${hits.length}개: ${hits.map((h) => h.name).join(" / ")})`
      }

      // 먼저 전부 해석한다 — 하나라도 못 찾으면 아무것도 바꾸지 않는다.
      const removeItems = remove.map((r) => resolveRef(r, items))
      const removedIds = new Set(removeItems.flatMap((x) => (typeof x === "string" ? [] : [x.id])))
      const planned = [...items, ...add.map((name, i) => ({ id: `new:${i}`, name, done: false }))].filter((c) => !removedIds.has(c.id))
      const toggles = [...check, ...uncheck].map((r) => {
        const x = resolveRef(r, planned)
        return typeof x !== "string" && removedIds.has(x.id) ? `'${r}'(지울 항목)` : x
      })
      const bad = [...removeItems, ...toggles].filter((x): x is string => typeof x === "string")
      if (bad.length) return { error: `항목을 못 찾았습니다: ${bad.join(", ")}. get_task 로 체크리스트를 확인하세요. 아무것도 바꾸지 않았습니다.` }

      // 화면과 같은 함수로 하나씩 — 색인·활동 기록이 같이 남는다.
      for (const it of removeItems as Item[]) await deleteChecklistItem(it.id, caller.userId)
      const created: Item[] = []
      for (const name of add) created.push(await addChecklistItem(found.id, name, caller.userId))
      const pool = [...items.filter((c) => !removedIds.has(c.id)), ...created]
      for (const [refs, done] of [[check, true], [uncheck, false]] as const) {
        for (const ref of refs) await updateChecklistItem((resolveRef(ref, pool) as Item).id, { done }, caller.userId)
      }

      const after = await prisma.checklist.findMany({
        where: { taskId: found.id }, orderBy: { createdAt: "asc" }, select: { name: true, done: true },
      })
      return {
        text: [
          `체크리스트 ${after.filter((c) => c.done).length}/${after.length}`,
          ...after.map((c, i) => `${i + 1}. [${c.done ? "x" : " "}] ${c.name}`),
        ].join("\n"),
      }
    }

    case "create_task": {
      const taskName = str(args.name)
      const names = Array.isArray(args.assignees) ? args.assignees.map(String) : []
      if (!taskName) return { error: "name 이 비어 있습니다." }
      if (names.length === 0) return { error: "담당자가 1명 이상 필요합니다. list_members 로 정식 이름을 확인하세요." }
      const { ids: assigneeIds, missing } = await findUsers(names)
      if (missing.length) return { error: `모르는 이름: ${missing.join(", ")}. list_members 로 확인하세요.` }

      let projectId: string | null = null
      if (str(args.project)) {
        const ps = await prisma.project.findMany({
          where: { archived: false, name: { contains: str(args.project), mode: "insensitive" } },
          select: { id: true, name: true }, take: 10,
        })
        if (ps.length === 0) return { error: `'${str(args.project)}' 프로젝트가 없습니다. list_projects 로 확인하세요.` }
        const exact = ps.find((p) => p.name === str(args.project))
        if (ps.length > 1 && !exact) return { error: `프로젝트가 ${ps.length}개 걸립니다: ${ps.map((p) => p.name).join(" / ")}` }
        projectId = (exact ?? ps[0]).id
      }
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(str(args.deadline)) ? new Date(`${str(args.deadline)}T23:59:59+09:00`) : null
      const priority = ["LOW", "NORMAL", "HIGH"].includes(str(args.priority)) ? (str(args.priority) as "LOW" | "NORMAL" | "HIGH") : "NORMAL"
      const items = Array.isArray(args.checklist) ? args.checklist.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8) : []
      const base = taskName.toLowerCase().replace(/[^\w\s가-힣]/g, "").replace(/\s+/g, "-").slice(0, 50) || "업무"

      // slug 유니크 충돌은 접미사를 붙여 다시 시도한다 (app/api/tasks 와 같은 처리).
      let task: { id: string; slug: string; name: string } | null = null
      for (let attempt = 0; attempt < 4 && !task; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`
        try {
          task = await prisma.task.create({
            data: {
              name: taskName.slice(0, 120), slug, instructorId: caller.userId, projectId, priority, deadline,
              background: str(args.background) || null,
              assignees: { create: assigneeIds.map((userId) => ({ userId })) },
              checklists: { create: items.map((n) => ({ name: n })) },
            },
            select: { id: true, slug: true, name: true },
          })
        } catch (e) {
          const code = (e as { code?: string }).code
          if (code !== "P2002" || attempt === 3) throw e
        }
      }
      if (!task) return { error: "업무를 만들지 못했습니다." }

      // 담당자 전원에게 수락 알림 — 화면에서 만든 것과 같다.
      for (const userId of assigneeIds.filter((id) => id !== caller.userId)) {
        await createNotification(userId, "task_assigned", `새 업무: ${task.name}`, `${caller.name}님이 업무를 지시했습니다.`, task.id, "accept_task")
      }
      // 채팅에 지시 원문과 카드를 올린다 — 채팅이 기록의 원본이다.
      const roomId = "default-room"
      await prisma.chatRoom.upsert({ where: { id: roomId }, update: {}, create: { id: roomId, name: "하드사이언스" } })
      const instruction = str(args.instruction) || `${task.name} — 담당 ${names.join(", ")}`
      const raw = await prisma.chatMessage.create({ data: { roomId, authorId: caller.userId, content: instruction, taskId: task.id, kind: "NORMAL" } })
      const card = await prisma.chatMessage.create({ data: { roomId, authorId: caller.userId, content: `__TASK_CREATED__:${task.id}`, taskId: task.id, kind: "TASK_CREATED" } })
      await persistMentions(raw.id, instruction).catch(() => {})
      await persistMentions(card.id, `#${task.slug}`).catch(() => {})
      await syncEmbeddingsSafe("TASK", task.id, caller.userId)

      return { text: `만들었습니다: #${task.slug} ${task.name}\n담당 ${names.join(", ")}${deadline ? ` · 마감 ${kst(deadline)}` : ""}${items.length ? `\n체크리스트 ${items.length}개` : ""}` }
    }

    case "list_projects": {
      const where: Record<string, unknown> = args.includeArchived === true ? {} : { archived: false }
      if (str(args.query)) where.name = { contains: str(args.query), mode: "insensitive" }
      const rows = await prisma.project.findMany({
        where, orderBy: { createdAt: "desc" },
        select: {
          name: true, status: true, purpose: true, deadline: true, archived: true,
          product: { select: { name: true } },
          tasks: { select: { status: true }, where: { archived: false } },
        },
      })
      if (rows.length === 0) return { text: "프로젝트가 없습니다." }
      return {
        text: [`프로젝트 ${rows.length}개`, ...rows.map((p) => {
          const open = p.tasks.filter((t) => t.status !== "DONE").length
          const bits = [p.name, p.status, `업무 ${p.tasks.length} (미완료 ${open})`]
          if (p.product) bits.push(`제품 ${p.product.name}`)
          if (p.deadline) bits.push(`마감 ${kst(p.deadline)}`)
          if (p.purpose) bits.push(p.purpose)
          if (p.archived) bits.push("보관됨")
          return `- ${bits.join(" · ")}`
        })].join("\n"),
      }
    }

    case "list_members": {
      const rows = await prisma.user.findMany({
        // 시스템 계정(🤖 메시지 작성자)은 구성원이 아니다 — 과거 구성원을 포함해도 뺀다.
        where: { id: { not: SYSTEM_USER_ID }, ...(args.includeInactive === true ? {} : { isActive: true }) },
        select: { name: true, position: true, department: true, role: true, isActive: true },
        orderBy: { name: "asc" },
      })
      return {
        text: rows.map((u) => `- ${u.name}${u.position ? ` · ${u.position}` : ""}${u.department ? ` · ${u.department}` : ""}${u.role === "ADMIN" ? " · 관리자" : ""}${u.isActive ? "" : " · 과거 구성원"}`).join("\n"),
      }
    }

    case "crm_overview": {
      const text = await buildCrmOverview()
      return { text: text || "CRM 자료가 없습니다." }
    }

    case "find_org": {
      const q = str(args.query)
      if (!q) return { error: "query 가 비어 있습니다." }
      const orgs = await prisma.crmOrg.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] },
        include: {
          contacts: true,
          quotes: { include: { items: { include: { product: true } } }, orderBy: { quotedAt: "desc" } },
          sampleRequests: { include: { product: true }, orderBy: { requestedAt: "desc" } },
          shipments: { include: { product: true }, orderBy: { shippedAt: "desc" }, take: 10 },
        },
        take: 5,
      })
      if (orgs.length === 0) return { text: `'${q}' 에 맞는 기관이 없습니다.` }
      const out: string[] = []
      for (const o of orgs) {
        out.push(`# ${o.name} (${o.code} · ${o.type})${o.address ? ` · ${o.address}` : ""}${o.note ? `\n${o.note}` : ""}`)
        if (o.contacts.length) out.push("담당자:", ...o.contacts.map((c) => `- ${c.name}${c.title ? ` ${c.title}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`))
        if (o.quotes.length) {
          out.push(`견적 ${o.quotes.length}건:`, ...o.quotes.map((qt) => {
            const t = quoteTotals(qt.items, qt.discountAmount, qt.vatRate)
            return `- ${qt.code} ${kst(qt.quotedAt)} · ${qt.items.map((i) => `${i.product.name} ${i.quantity}개`).join(", ")} · ${QUOTE_STATUS_LABEL[qt.status]} · ${t.total.toLocaleString()}원`
          }))
        }
        if (o.sampleRequests.length) out.push(`샘플요청 ${o.sampleRequests.length}건:`, ...o.sampleRequests.map((s) => `- ${s.code} ${kst(s.requestedAt)}${s.product ? ` · ${s.product.name}` : ""} · ${s.status === "SENT" ? "발송완료" : "미발송"}`))
        if (o.shipments.length) out.push(`출고 (최근 ${o.shipments.length}):`, ...o.shipments.map((s) => `- ${s.code} ${kst(s.shippedAt)} · ${s.product.name} ${s.quantity}개 · ${s.kind}`))
        out.push("")
      }
      return { text: out.join("\n").trim() }
    }

    case "list_omnis_cards": {
      const q = str(args.query)
      const rows = await prisma.omnisCard.findMany({
        where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { tags: { has: q } }, { category: { name: { contains: q } } }] } : {},
        select: { id: true, title: true, tags: true, updatedAt: true, category: { select: { name: true } } },
        orderBy: [{ category: { sortOrder: "asc" } }, { title: "asc" }], take: 200,
      })
      if (rows.length === 0) return { text: "지식 카드가 없습니다." }
      return { text: rows.map((c) => `- [${c.category.name}] ${c.title}${c.tags.length ? ` (${c.tags.join(", ")})` : ""} · ${kst(c.updatedAt)} · ${c.id}`).join("\n") }
    }

    case "get_omnis_card": {
      const key = str(args.card)
      const card =
        (await prisma.omnisCard.findFirst({ where: { id: key }, include: { category: true } })) ??
        (await prisma.omnisCard.findFirst({ where: { title: { contains: key, mode: "insensitive" } }, include: { category: true }, orderBy: { updatedAt: "desc" } }))
      if (!card) return { error: `'${key}' 에 맞는 카드가 없습니다.` }
      const cc = migrateContent(card.content)
      const body = cc.sections.map((s) => { const t = sectionToText(s).trim(); return t ? `${s.title ? `## ${s.title}\n` : ""}${t}` : "" }).filter(Boolean).join("\n\n")
      return { text: `# [${card.category.name}] ${card.title}\n갱신 ${kst(card.updatedAt)} · v${card.version}${card.tags.length ? ` · ${card.tags.join(", ")}` : ""}\n\n${body || "(본문 없음)"}` }
    }

    case "write_omnis_card": {
      const key = str(args.card)
      const title = str(args.title)
      const categoryName = str(args.category)
      const markdown = args.markdown !== undefined ? String(args.markdown) : undefined
      const tags = Array.isArray(args.tags)
        ? args.tags.map(String).map((t) => t.trim()).filter(Boolean)
        : undefined

      let categoryId: string | undefined
      if (categoryName) {
        const cats = await prisma.omnisCategory.findMany({
          where: { name: { contains: categoryName, mode: "insensitive" } }, select: { id: true, name: true }, take: 10,
        })
        if (cats.length === 0) return { error: `'${categoryName}' 분류가 없습니다. list_omnis_cards 의 [대괄호] 이름을 쓰세요.` }
        const exact = cats.find((c) => c.name === categoryName)
        if (cats.length > 1 && !exact) return { error: `분류가 ${cats.length}개 걸립니다: ${cats.map((c) => c.name).join(" / ")}` }
        categoryId = (exact ?? cats[0]).id
      }

      if (!key) {
        if (!title || !categoryId) {
          return { error: "새 카드는 title 과 category 가 필요합니다. 기존 카드를 고치려면 card 에 ID·제목을 주세요." }
        }
        const sections = markdown !== undefined ? [{ id: randomUUID(), type: "text", title: "", body: markdown }] : []
        const card = await createOmnisCard(caller.userId, {
          categoryId, title, tags, content: { sections } as unknown as Prisma.InputJsonValue,
        })
        return { text: `만들었습니다: [${card.category.name}] ${card.title} · ID ${card.id}` }
      }

      const existing =
        (await prisma.omnisCard.findFirst({ where: { id: key } })) ??
        (await prisma.omnisCard.findFirst({ where: { title: { contains: key, mode: "insensitive" } }, orderBy: { updatedAt: "desc" } }))
      if (!existing) return { error: `'${key}' 에 맞는 카드가 없습니다. list_omnis_cards 로 확인하세요.` }

      // 본문은 첫 텍스트 구역만 바꾼다 — 표·키값·첨부 구역을 통째로 날리지 않으려는 것이다.
      let content: Prisma.InputJsonValue | undefined
      if (markdown !== undefined) {
        const cc = migrateContent(existing.content)
        const sections = [...cc.sections]
        const at = sections.findIndex((sec) => sec.type === "text")
        if (at >= 0) {
          const prev = sections[at] as { body: string }
          const body = args.append === true && prev.body ? `${prev.body}\n\n${markdown}` : markdown
          sections[at] = { ...sections[at], body } as (typeof sections)[number]
        } else {
          sections.push({ id: randomUUID(), type: "text", title: "", body: markdown })
        }
        content = { ...cc, sections } as unknown as Prisma.InputJsonValue
      }

      const updated = await updateOmnisCard(caller.userId, {
        id: existing.id, title: title || undefined, content, tags, categoryId,
      })
      if ("error" in updated) return { error: updated.error }
      const card = updated.card
      return { text: `고쳤습니다: [${card.category.name}] ${card.title} · v${card.version} · ID ${card.id}` }
    }

    case "list_weekly_reports": {
      const rows = await listWeeklyReports(caller.userId)
      if (rows.length === 0) return { text: "주간보고가 없습니다. write_weekly_report 로 이번 주 보고서를 만듭니다." }
      const out = rows.slice(0, clampInt(args.limit, 4, 20)).map((r) => {
        const c = (r.content ?? {}) as { completed?: string[]; inProgress?: string[]; markdown?: string; draft?: string }
        const lines = [
          `# ${r.title} · ${r.isoWeek} · ${r.status}${r.submittedAt ? ` · 제출 ${kst(r.submittedAt)}` : ""} · ID ${r.id}`,
          `기간 ${kst(r.weekStart)} ~ ${kst(r.weekEnd)}`,
        ]
        if (c.completed?.length) lines.push(`완료 ${c.completed.length}: ${c.completed.join(", ")}`)
        if (c.inProgress?.length) lines.push(`진행 ${c.inProgress.length}: ${c.inProgress.join(", ")}`)
        const body = c.markdown || c.draft
        if (body) lines.push("", clip(body))
        return lines.join("\n")
      })
      return { text: [`주간보고 ${rows.length}건${rows.length > out.length ? ` 중 ${out.length}건` : ""}`, "", ...out].join("\n") }
    }

    case "write_weekly_report": {
      const markdown = args.markdown !== undefined ? String(args.markdown) : undefined
      const submit = args.submit === true
      const status = submit ? "제출 완료" : undefined
      const reportId = str(args.report)

      if (reportId) {
        if (markdown === undefined && !submit) {
          return { error: "report 를 줄 때는 markdown 이나 submit 중 하나가 필요합니다." }
        }
        const r = await updateWeeklyReport(caller.userId, { id: reportId, markdown, status })
        if ("error" in r) return { error: `${r.error}. list_weekly_reports 로 사용자 본인의 보고서 ID 를 확인하세요.` }
        return { text: `고쳤습니다: ${r.report.title} · ${r.report.status}` }
      }

      // 이번 주 보고서 — 없으면 만들고, 있으면 업무 목록만 다시 센다.
      const report = await upsertThisWeekReport(caller.userId, { generateDraft: args.draft === true })
      let current = report
      if (markdown !== undefined || submit) {
        const r = await updateWeeklyReport(caller.userId, { id: report.id, markdown, status })
        if ("error" in r) return { error: r.error }
        current = r.report
      }
      const c = (current.content ?? {}) as { completed?: string[]; inProgress?: string[]; markdown?: string; draft?: string }
      return {
        text: [
          `${current.title} · ${current.status} · ID ${current.id}`,
          `완료 ${c.completed?.length ?? 0} · 진행 ${c.inProgress?.length ?? 0}`,
          c.draft && args.draft === true ? "\nAI 초안:\n" + clip(c.draft) : "",
          c.markdown ? "\n본문:\n" + clip(c.markdown) : "",
        ].filter(Boolean).join("\n"),
      }
    }

    case "list_chat": {
      const view = (str(args.view) || "all") as FeedView
      if (!["all", "task", "dm", "ai"].includes(view)) return { error: "view 는 all · task · dm · ai 중 하나입니다." }
      let id: string | undefined
      let userId: string | undefined
      if (view === "task") {
        if (!str(args.task)) return { error: "view=task 에는 task 가 필요합니다." }
        const found = await findTask(str(args.task))
        if ("error" in found) return found
        id = found.id
      }
      if (view === "dm") {
        const name = str(args.user)
        if (!name) return { error: "view=dm 에는 user(상대 이름)가 필요합니다." }
        const { ids, missing } = await findUsers([name])
        if (missing.length || !ids[0]) return { error: `모르는 이름: ${name}. list_members 로 확인하세요.` }
        userId = ids[0]
      }
      const r = await readChatFeed({ currentUserId: caller.userId, view, id, userId, take: clampInt(args.limit, 40, 200) })
      if ("error" in r) return { error: r.error }
      if (r.messages.length === 0) return { text: "글이 없습니다." }
      return {
        text: [
          `채팅 ${r.messages.length}건 (오래된 것부터)`,
          ...r.messages.map((m) =>
            `[${kst(m.createdAt, true)}] ${m.author.name}${m.task ? ` · #${m.task.slug}` : ""}: ` +
            `${m.content.replace(/\s*\n+\s*/g, " ").slice(0, 300)}` +
            `${m.files.length ? ` [첨부: ${m.files.map((f) => f.name).join(", ")}]` : ""}`
          ),
        ].join("\n"),
      }
    }

    case "company_profile":
      return { text: await companyProfileText() }
    case "list_company_records":
      return { text: await companyRecordsText(args) }
    case "save_company_record": {
      // MCP 는 snake_case, Zod 스키마는 camelCase 다 — 여기서 한 번만 맞춘다
      const map: Record<string, string> = {
        starts_on: "startsOn", ends_on: "endsOn", period_raw: "periodRaw",
        grant_no: "grantNo", funding_krw: "fundingKrw", record_id: "record_id",
      }
      const mapped = Object.fromEntries(Object.entries(args).map(([k, v]) => [map[k] ?? k, v]))
      return saveCompanyRecordText(mapped, caller)
    }
    case "delete_company_record":
      return deleteCompanyRecordText(args, caller)
    case "list_tax_invoices":
      return { text: await taxInvoicesText(args) }
    case "list_staff":
      return { text: await staffText() }
    case "list_market_companies":
      return { text: await marketCompaniesText(args) }
    case "get_context":
      return contextText(args, caller.role === "ADMIN")
  }

  return { error: `모르는 도구입니다: ${name}` }
}

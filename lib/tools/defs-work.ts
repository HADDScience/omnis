// 묶음 1(#248) — 업무 · 프로젝트 · 채팅 방 · 알림 · 주간보고 도구 정의. 데이터만 둔다(서버 모듈을 들이지 않는다).
// 실행은 lib/tools/plan-work.ts. 쓰기는 계획을 먼저 세운다(lib/tools/planned.ts) — MCP 는 confirm=true 일 때만 쓴다.
import { CONFIRM_PROP } from "./planned"

export const WORK_TOOLS = [
  // ─── 읽기 ───
  {
    name: "list_task_products",
    description: "업무용 제품 라벨 목록(업무 · 프로젝트에 붙는 제품 — CRM 재고 제품과 다르다). update_task · create_task 의 product 를 여기서 고른다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_activity",
    description: [
      "활동 기록 — 누가 언제 무엇을 바꿨는지(업무 · 카드 · CRM · 프로젝트 …). 화면의 활동 기록과 같다.",
      "entity(TASK · OMNIS_CARD · PROJECT · CRM_QUOTE 등)와 entity_id 로 좁힌다. 로그인 · 비밀번호 기록은 보이지 않는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "대상 종류 — 예: TASK, OMNIS_CARD, PROJECT" },
        entity_id: { type: "string", description: "대상 ID" },
        limit: { type: "integer", description: "기본 10, 최대 50" },
      },
    },
  },
  {
    name: "list_room_files",
    description: [
      "방 서랍 — 방에 올라온 사진 · 파일 · 링크 · 참여자. 화면의 방 서랍과 같다.",
      "room 은 list_rooms 와 같은 규칙(방 ID 또는 이름 일부, 전사방은 「하드사이언스」). **내가 볼 수 있는 방만** 된다.",
      "파일 내용은 read_file 에 파일 ID 를 준다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "방 ID 또는 이름 일부" },
        tab: { type: "string", enum: ["photos", "files", "links", "members"], description: "기본 files" },
        period: { type: "string", enum: ["week", "month", "all"], description: "기간. 기본 all" },
        before: { type: "string", description: "이어 보기 — 앞 결과의 「다음」 시각(ISO)" },
      },
      required: ["room"],
    },
  },

  // ─── 쓰기(계획 → 확인) ───
  {
    name: "create_project",
    description: [
      "새 프로젝트(정부과제 · 행사 · 교육프로그램 단위)를 만든다 — 화면의 프로젝트 만들기와 같다.",
      "공백 · 대소문자만 다른 이름이 이미 있으면 새로 만들지 않고 그 프로젝트를 쓴다. 먼저 list_projects 로 찾아본다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "프로젝트 이름" },
        product: { type: "string", description: "업무용 제품 이름(list_task_products) — 있는 것만" },
        purpose: { type: "string", description: "목적" },
        goal: { type: "string", description: "목표" },
        confirm: CONFIRM_PROP,
      },
      required: ["name"],
    },
  },
  {
    name: "merge_projects",
    description: [
      "프로젝트 둘을 합친다 — source 의 업무를 모두 target 으로 옮기고 source 를 보관한다. 화면의 프로젝트 합치기와 같다.",
      "되돌리는 길이 없다(보관을 풀어도 업무는 target 에 남는다). 프로젝트는 ID 로 — list_projects 로 찾는다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "합쳐져 없어질(보관될) 프로젝트 ID" },
        target: { type: "string", description: "남을 프로젝트 ID" },
        confirm: CONFIRM_PROP,
      },
      required: ["source", "target"],
    },
  },
  {
    name: "manage_room",
    description: [
      "사람끼리 대화방 — 화면의 「사람과 대화」 · 단톡방 설정과 같다.",
      "action=open: members(정식 이름) 1명이면 1:1 을 열거나(있으면 그 방) 만들고, 2명 이상이면 단톡방을 새로 만든다(name 은 단톡방 이름).",
      "action=rename: 단톡방 이름 바꾸기. action=invite: 단톡방에 members 초대. action=leave: 단톡방에서 내가 나가기(1:1 은 나갈 수 없다).",
      "rename · invite · leave 는 room(방 ID — list_rooms)에 **내가 참여자인 단톡방**만 된다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["open", "rename", "invite", "leave"] },
        room: { type: "string", description: "방 ID(list_rooms) — rename · invite · leave" },
        members: { type: "array", items: { type: "string" }, description: "정식 이름(list_members) — open · invite" },
        name: { type: "string", description: "단톡방 이름 — open(2명 이상) · rename" },
        confirm: CONFIRM_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "manage_notifications",
    description: [
      "내 알림을 읽음으로 하거나 지운다 — 화면의 알림 목록과 같다. 내 알림만 된다.",
      "notification 에 알림 ID(list_notifications)를 주거나 all=true. 수락 · 완료 확인을 기다리는 알림은 지우지 않는다(respond_notification 으로 응답).",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "delete"] },
        notification: { type: "string", description: "알림 ID" },
        all: { type: "boolean", description: "true 면 내 알림 전부(지우기는 응답 대기 알림을 남긴다)" },
        confirm: CONFIRM_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "set_notification_prefs",
    description: "내 기기 알림(푸시)을 종류별로 켜고 끈다 — 마이 › 기기 알림과 같다. 끄면 그 종류의 푸시만 멈추고 벨 알림은 남는다. 지금 값은 list_notifications 끝에 있다.",
    inputSchema: {
      type: "object",
      properties: {
        chat: { type: "boolean", description: "채팅 푸시" },
        task: { type: "boolean", description: "업무 푸시" },
        calendar: { type: "boolean", description: "일정 푸시" },
        confirm: CONFIRM_PROP,
      },
    },
  },
  {
    name: "delete_weekly_report",
    description: "내 주간보고 하나를 지운다 — 보고 화면의 지우기와 같다. 남의 보고서는 지울 수 없다. report 는 list_weekly_reports 의 ID.",
    inputSchema: {
      type: "object",
      properties: {
        report: { type: "string", description: "보고서 ID" },
        confirm: CONFIRM_PROP,
      },
      required: ["report"],
    },
  },
] as const

export const WORK_READ_NAMES = ["list_task_products", "list_activity", "list_room_files"] as const
export type WorkReadName = (typeof WORK_READ_NAMES)[number]
export type WorkWriteName = Exclude<(typeof WORK_TOOLS)[number]["name"], WorkReadName>

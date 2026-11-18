// 묶음 5(#248) — 지식재산권 화면에서 되는데 도구가 없던 것: 연락 기록 · 미결 액션 남기기(메일 정리 화면), 진행 기록 차례/기한/지우기,
// 이미지 메모/대표/떼기, 연락 · 액션 · 플래그 읽기. 지식재산권 화면에 들어가는 사람(getIpAccess)만 된다.
// 플래그 추가 · 닫기, 액션 상태만 바꾸기, 건 지우기 · 되돌리기는 API(app/api/ip/*)만 있고 화면이 부르지 않아 만들지 않는다(#248 보고서).
// 실행은 lib/tools/plan-ip.ts.
import { CONFIRM_PROP } from "./planned"

const TEXT = { type: "string" } as const
const CASE_ID = { type: "string", description: "건 ID(TM… · PT…) — list_ip" } as const

export const IP_MORE_TOOLS = [
  // ─── 읽기 ───
  {
    name: "ip_records",
    description: [
      "지식재산권 화면의 연락 기록(communications) · 미결 액션(actions) · 자료 불일치 플래그(flags)를 읽는다 — get_ip 에는 없는 칸이다.",
      "target(건 ID)으로 좁힐 수 있다. 쓰기 도구의 id 를 여기서 고른다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        what: { type: "string", enum: ["communications", "actions", "flags"] },
        target: CASE_ID,
        open_only: { type: "boolean", description: "열린 것만(기본 true)" },
      },
      required: ["what"],
    },
  },

  // ─── 쓰기(계획 → 확인) ───
  {
    name: "ip_save_communication",
    description: "지식재산권 연락 기록(메일 · 전화 한 건)을 남긴다 — 화면의 메일 정리와 같다. 회신 메일은 인용된 원본이 아니라 새로 온 부분만 옮긴다(read_guide).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        dir: { type: "string", description: "보냄 · 받음" },
        from: TEXT, to: TEXT,
        target: { type: "string", description: "상표 · 특허" },
        subject: TEXT, body: TEXT,
        follow_up: { type: "string", description: "후속 할 일" },
        open: { type: "boolean", description: "후속이 남았나" },
        links: { type: "array", items: { type: "string" }, description: "이 연락이 걸린 건 ID들(TM… · PT…)" },
        confirm: CONFIRM_PROP,
      },
      required: ["date", "dir", "subject", "body"],
    },
  },
  {
    name: "ip_save_action",
    description: "지식재산권 미결 액션(할 일 한 건)을 남긴다 — 화면의 메일 정리에서 액션을 고르는 것과 같다. 담당은 부른 사람.",
    inputSchema: {
      type: "object",
      properties: {
        case: CASE_ID,
        todo: TEXT,
        priority: { type: "string", description: "높음 · 보통 · 낮음" },
        requested_at: { type: "string", description: "YYYY-MM-DD" },
        requester: TEXT,
        confirm: CONFIRM_PROP,
      },
      required: ["case", "todo"],
    },
  },
  {
    name: "ip_progress_edit",
    description: "진행 기록 한 줄의 차례(next_turn: us 우리 · firm 사무소 · none 없음)와 기한(due_on)을 바꾸거나(action=turn) 그 줄을 지운다(action=delete) — 화면과 같다. 진행 기록 ID 는 get_ip.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["turn", "delete"] },
        id: { type: "string", description: "진행 기록 ID" },
        next_turn: { type: "string", enum: ["us", "firm", "none"] },
        due_on: { type: "string", description: "YYYY-MM-DD. 빈 문자열이면 기한을 지운다. 주지 않으면 그대로" },
        confirm: CONFIRM_PROP,
      },
      required: ["action", "id"],
    },
  },
  {
    name: "ip_image_edit",
    description: "건에 붙은 이미지의 메모 · 날짜 · 대표를 고치거나(action=update) 건에서 뗀다(action=remove, 파일은 남는다) — 화면과 같다. 이미지 ID 는 get_ip.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["update", "remove"] },
        id: { type: "string", description: "이미지 ID" },
        memo: TEXT, date: { type: "string", description: "YYYY-MM-DD. 빈 문자열이면 지운다" },
        is_primary: { type: "boolean", description: "대표 이미지로" },
        confirm: CONFIRM_PROP,
      },
      required: ["action", "id"],
    },
  },
] as const

export const IP_MORE_READ_NAMES = ["ip_records"] as const
export type IpMoreReadName = (typeof IP_MORE_READ_NAMES)[number]
export type IpMoreWriteName = Exclude<(typeof IP_MORE_TOOLS)[number]["name"], IpMoreReadName>

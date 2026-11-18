// 묶음 3(#248) — 지식 카드(지우기 · 분류 · 버전 · 복원 · 카드 제안 · 즐겨찾기 · 내 질문) 도구 정의. 데이터만 둔다.
// 실행은 lib/tools/plan-cards.ts.
import { CONFIRM_PROP } from "./planned"

const CARD = { type: "string", description: "카드 ID 또는 제목 일부(list_omnis_cards)" } as const

export const CARD_TOOLS = [
  // ─── 읽기 ───
  {
    name: "omnis_card_history",
    description: "지식 카드의 버전 이력 — 화면 카드 › 이력과 같다. hash 를 주면 그 버전의 본문을, 없으면 버전 목록(해시 · 시각 · 쓴 사람 · 메시지)을 준다. 되돌리기는 restore_omnis_card.",
    inputSchema: { type: "object", properties: { card: CARD, hash: { type: "string", description: "버전 해시(목록에서)" } }, required: ["card"] },
  },
  {
    name: "list_card_proposals",
    description: "AI 가 올린 지식 카드 갱신 제안 — 화면 지식 › 제안과 같다. 수락률도 준다. decide_card_proposal 의 proposal 을 여기서 고른다.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["PENDING", "decided", "all"], description: "기본 PENDING(대기)" } } },
  },
  {
    name: "list_bookmarks",
    description: "내가 즐겨찾기한 지식 카드.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_my_questions",
    description: "내가 「Omnis AI 에게 질문하기」 로 물은 질문과 답(최근 것부터) — 화면 질문 기록과 같다. 내 것만 보인다.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", description: "기본 10, 최대 30" } } },
  },

  // ─── 쓰기(계획 → 확인) ───
  {
    name: "delete_omnis_card",
    description: "지식 카드를 지운다 — 화면의 카드 지우기와 같다. 검색 색인에서도 빠진다. 되돌릴 수 없다.",
    inputSchema: { type: "object", properties: { card: CARD, confirm: CONFIRM_PROP }, required: ["card"] },
  },
  {
    name: "manage_omnis_category",
    description: "지식 카드 분류 — action=create 는 새 분류(name, icon), action=delete 는 카드가 없는 분류만 지운다(category 에 분류 ID 또는 이름).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "delete"] },
        name: { type: "string", description: "create — 분류 이름" },
        icon: { type: "string", description: "create — 이모지 하나(기본 📁)" },
        category: { type: "string", description: "delete — 분류 ID 또는 이름" },
        confirm: CONFIRM_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "restore_omnis_card",
    description: "지식 카드를 옛 버전으로 되돌린다 — 화면 이력의 복원과 같다. 지금 내용은 이력에 남고 새 버전으로 쌓인다. hash 는 omnis_card_history 에서.",
    inputSchema: { type: "object", properties: { card: CARD, hash: { type: "string" }, confirm: CONFIRM_PROP }, required: ["card", "hash"] },
  },
  {
    name: "decide_card_proposal",
    description: "AI 의 카드 갱신 제안을 수락(accept: 카드에 반영) · 거절(reject) · 되돌리기(revert: 반영한 것을 원래대로) 한다 — 화면 지식 › 제안과 같다.",
    inputSchema: {
      type: "object",
      properties: { proposal: { type: "string", description: "제안 ID(list_card_proposals)" }, action: { type: "string", enum: ["accept", "reject", "revert"] }, confirm: CONFIRM_PROP },
      required: ["proposal", "action"],
    },
  },
  {
    name: "manage_bookmarks",
    description: "내 즐겨찾기에 지식 카드를 더하거나(add) 뺀다(remove).",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["add", "remove"] }, card: CARD, confirm: CONFIRM_PROP }, required: ["action", "card"] },
  },
] as const

export const CARD_READ_NAMES = ["omnis_card_history", "list_card_proposals", "list_bookmarks", "list_my_questions"] as const
export type CardReadName = (typeof CARD_READ_NAMES)[number]
export type CardWriteName = Exclude<(typeof CARD_TOOLS)[number]["name"], CardReadName>

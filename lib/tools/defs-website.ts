// 묶음 6(#248) — 홈페이지 관리(website-admin) 화면의 일: 기사 · 사진 · 방문 통계 · 칼럼 키워드 · 칼럼 초안. 데이터만 둔다.
// 권한은 그 화면과 같다 — 재직 구성원(lib/website-auth requireWebsiteUser). 초안 승인은 검토자만(lib/column/draft decide).
// 실행은 lib/tools/plan-website.ts.
import { CONFIRM_PROP } from "./planned"

const POST_ID = { type: "string", description: "기사 ID(list_website_posts) — 숫자 6자리 이상" } as const

export const WEBSITE_TOOLS = [
  // ─── 읽기 ───
  {
    name: "list_website_posts",
    description: "홈페이지 기사(소식 · 라이브러리 칼럼 · 카드뉴스) 목록. id 를 주면 그 기사 전체(JSON — 고칠 때 이것을 고쳐 save_website_post 에 넣는다).",
    inputSchema: { type: "object", properties: { id: POST_ID } },
  },
  {
    name: "website_stats",
    description: "홈페이지 방문 통계 — 관리 화면과 같다. days 7 · 30 · 90(기본 30). 아직 옮겨지지 않은 방문 수(pending)는 숫자에 없다.",
    inputSchema: { type: "object", properties: { days: { type: "integer", description: "7 · 30 · 90 중 하나(기본 30)" } } },
  },
  {
    name: "list_column_keywords",
    description: "칼럼 키워드 보드(추천 점수순 · 예약자 · 초안) — 관리 화면과 같다. column_keyword_action · create_column_draft 의 keyword_id 를 여기서 고른다.",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["candidate", "reserved", "discarded", "ALL"], description: "기본 ALL(버린 것 빼고)" } } },
  },
  {
    name: "list_column_drafts",
    description: "칼럼 초안 목록(최근 순). id 를 주면 그 초안 전체와 검토 전에 고칠 것(problems).",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
  },

  // ─── 쓰기(계획 → 확인) ───
  {
    name: "save_website_post",
    description: [
      "홈페이지 기사를 저장한다(새로 · 고치기) — 관리 화면의 저장과 같다. 저장하면 영어 번역이 자동으로 채워지고(AI 비용) 사이트에 바로 반영된다.",
      "고칠 때는 list_website_posts(id)의 JSON 을 받아 바꿀 칸만 고쳐 post 에 통째로 넣는다. 새 기사는 id 를 새로(예: 오늘 날짜 숫자) 정한다.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: { id: POST_ID, post: { type: "object", description: "기사 JSON(PostInput — category · date · sourceLang · content{ko:{title,summary,blocks}} …)" }, confirm: CONFIRM_PROP },
      required: ["id", "post"],
    },
  },
  {
    name: "delete_website_post",
    description: "홈페이지 기사를 지운다(사진도 함께) — 사이트에서 바로 사라진다.",
    inputSchema: { type: "object", properties: { id: POST_ID, confirm: CONFIRM_PROP }, required: ["id"] },
  },
  {
    name: "arrange_website_posts",
    description: "홈페이지 기사 고정(action=pin · unpin, id) 또는 목록 순서(action=order, order 에 기사 ID 전부를 보일 순서대로) — 관리 화면과 같다.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["pin", "unpin", "order"] }, id: POST_ID, order: { type: "array", items: { type: "string" } }, confirm: CONFIRM_PROP },
      required: ["action"],
    },
  },
  {
    name: "upload_website_media",
    description: "기사에 쓸 사진을 홈페이지 저장소에 올린다 — 관리 화면의 사진 올리기와 같다. 파일은 upload_file 로 먼저 올리고 그 ID 를 준다. 돌려받은 주소를 기사 블록에 넣는다.",
    inputSchema: { type: "object", properties: { post_id: POST_ID, file: { type: "string", description: "파일 ID(upload_file)" }, confirm: CONFIRM_PROP }, required: ["post_id", "file"] },
  },
  {
    name: "collect_column_keywords",
    description: "칼럼 키워드 후보를 모은다(하루 한 번, 같은 날 다시 부르면 그날 결과) — 관리 화면의 수집과 같다. 뉴스를 읽고 AI 가 고른다(비용 · 수십 초).",
    inputSchema: { type: "object", properties: { confirm: CONFIRM_PROP } },
  },
  {
    name: "column_keyword_action",
    description: "칼럼 키워드 예약(reserve) · 풀기(release) · 버리기(discard) · 되살리기(restore) · 근거 빼기(removeSource, url). 남이 예약한 것은 풀거나 버릴 수 없다.",
    inputSchema: {
      type: "object",
      properties: { keyword_id: { type: "string" }, action: { type: "string", enum: ["reserve", "release", "discard", "restore", "removeSource"] }, url: { type: "string" }, confirm: CONFIRM_PROP },
      required: ["keyword_id", "action"],
    },
  },
  {
    name: "create_column_draft",
    description: "키워드로 칼럼 초안을 AI 가 쓴다 — 관리 화면과 같다(AI 비용 · 30~60초).",
    inputSchema: { type: "object", properties: { keyword_id: { type: "string" }, confirm: CONFIRM_PROP }, required: ["keyword_id"] },
  },
  {
    name: "update_column_draft",
    description: "칼럼 초안의 제목 · 요약 · 본문 블록을 고친다(초안 · 수정 요청 상태에서만). blocks 를 주면 본문을 통째로 바꾼다.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, blocks: { type: "array", items: { type: "object" } }, confirm: CONFIRM_PROP },
      required: ["id"],
    },
  },
  {
    name: "column_draft_action",
    description: "칼럼 초안 — 검토 요청(review) · 승인(approve) · 수정 요청(request_changes, note) · 게시(publish: 승인된 것만, 라이브러리 기사가 된다) · 버리기(discard). 승인 · 수정 요청은 검토자만.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, action: { type: "string", enum: ["review", "approve", "request_changes", "publish", "discard"] }, note: { type: "string" }, confirm: CONFIRM_PROP },
      required: ["id", "action"],
    },
  },
] as const

export const WEBSITE_READ_NAMES = ["list_website_posts", "website_stats", "list_column_keywords", "list_column_drafts"] as const
export type WebsiteReadName = (typeof WEBSITE_READ_NAMES)[number]
export type WebsiteWriteName = Exclude<(typeof WEBSITE_TOOLS)[number]["name"], WebsiteReadName>

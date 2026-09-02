// HADD IP — 원격 MCP 서버의 알맹이 (도구·지침·토큰).
//
// 무엇을 위한 것인가
//  메일에서 값을 뽑아 진행 기록으로 옮기는 일은 규칙으로 짜맞추는 것보다 LLM 이
//  훨씬 잘한다. 그래서 파싱을 화면에 더 넣는 대신, 기록을 읽고 쓰는 도구를 열어
//  각자 쓰는 AI 도구에 붙이게 한다.
//
// Supabase 엣지 함수에서 옮겨 왔다. 도구 설명과 사용 지침은 한 글자도 바꾸지
// 않았다 — 그 문장들은 모델이 실제로 틀렸던 것을 하나씩 막으려고 다듬은 것이라,
// 다시 쓰면 그 경험이 사라진다. 바뀐 것은 DB 접근뿐이다(supabase-js → Prisma).
//
// 권한
//  Prisma 는 DB 소유자로 접속하므로 RLS 를 지나간다. 그래서 이 파일이 곧 권한
//  경계다. 쓰기 도구는 반드시 역할을 먼저 확인한다.

import { createHash, randomBytes } from "crypto"

import { prisma } from "@/lib/db"

export const PROTOCOL_VERSION = "2025-06-18"
export const SERVER_INFO = { name: "hadd-ip", version: "1.0.0" }

export interface Caller {
  userId: string
  email: string
  displayName: string | null
  role: "owner" | "editor" | "viewer"
}

/** 문자열의 sha256(hex). 토큰 원문은 어디에도 저장하지 않는다. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/**
 * 오늘(KST).
 *
 * 서버는 UTC 로 돈다. 그대로 쓰면 한국 시간 아침 9시 전에 남긴 정정이 어제로
 * 적힌다 — 지식재산권 목록의 날짜는 전부 KST 이므로 여기서 맞춰 준다.
 */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** URL-safe 난수. 토큰·코드·client_id 에 두루 쓴다. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex")
}

/**
 * 토큰 원문 → 사람.
 *
 * 두 갈래를 모두 받는다.
 *  * `hadd_…` 개인 토큰 — CLI 는 커맨드 한 줄이 간단하다.
 *  * OAuth 액세스 토큰 — ChatGPT 처럼 정적 토큰을 못 보내는 클라이언트용.
 *
 * 마지막 사용 시각 갱신과 조회를 DB 함수 한 번으로 끝내는 것이 요점이다.
 * 두 번 왕복하면 그 사이에 폐기된 토큰이 통과할 틈이 생긴다.
 */
export async function resolveCaller(authorization: string | null): Promise<Caller | null> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!token) return null

  const hash = sha256(token)
  const rows = token.startsWith("hadd_")
    ? await prisma.$queryRaw<Caller[]>`
        SELECT user_id AS "userId", email, display_name AS "displayName", role
          FROM ip.resolve_mcp_token(${hash})`
    : await prisma.$queryRaw<Caller[]>`
        SELECT user_id AS "userId", email, display_name AS "displayName", role
          FROM ip.resolve_oauth_token(${hash})`

  return rows.length > 0 ? rows[0] : null
}

/**
 * 개인 토큰 재발급. 쓰던 것은 즉시 죽고 새 것 하나만 남는다.
 *
 * 원문은 이 반환값으로만 존재한다. 화면을 벗어나면 다시 볼 방법이 없어
 * (DB 에는 해시만 있다) 그때는 또 재발급받아야 한다.
 *
 * 원래는 plpgsql(reissue_mcp_token)이었다. pgcrypto 의 gen_random_bytes·digest 에
 * 기대고 있었는데 그 확장이 있는지는 배포처마다 달라, 애플리케이션이 이미 잘 하는
 * 일을 DB 에 맡길 이유가 없어 옮겼다.
 */
export async function reissueMcpToken(userId: string): Promise<string> {
  const raw = `hadd_${randomBytes(24).toString("hex")}`

  await prisma.$transaction(async (tx) => {
    // 멤버가 아니면 발급하지 않는다.
    const member = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM ip.members WHERE user_id = ${userId}`
    if (member.length === 0) throw new Error("멤버가 아닙니다.")

    // 쓰던 것은 즉시 죽인다. 지우지 않고 껐다는 기록을 남긴다.
    await tx.$executeRaw`
      UPDATE ip.mcp_tokens SET revoked_at = now()
       WHERE user_id = ${userId} AND revoked_at IS NULL`

    await tx.$executeRaw`
      INSERT INTO ip.mcp_tokens (user_id, name, token_hash, prefix)
      VALUES (${userId}, '', ${sha256(raw)}, ${raw.slice(0, 13)})`
  })

  return raw
}

export interface McpTokenInfo {
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

/** 지금 살아 있는 토큰. 최대 하나다. 원문은 알 수 없고 앞자리만 보여준다. */
export async function currentMcpToken(userId: string): Promise<McpTokenInfo | null> {
  const rows = await prisma.$queryRaw<
    { prefix: string; created_at: Date; last_used_at: Date | null }[]
  >`SELECT prefix, created_at, last_used_at FROM ip.mcp_tokens
     WHERE user_id = ${userId} AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  if (rows.length === 0) return null
  return {
    prefix: rows[0].prefix,
    createdAt: rows[0].created_at.toISOString(),
    lastUsedAt: rows[0].last_used_at?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// 사용 지침
//
// 왜 이런 장치가 필요한가
//  도구 설명을 길게 적어도 모델은 읽는 정도가 천차만별이다. 실제로 인용된 원본을
//  새 메일로 착각해 없던 사실(등록가능성·권고사항)을 기록한 일이 있었다. 그리고
//  한번 들어간 요약은 다음 조회에서 사실로 되돌아온다 — 기록이 세탁된다.
//
// 그래서 「읽지 않으면 쓸 수 없게」 만든다
//  쓰기 도구는 `guide` 확인 코드를 받는다. 그 코드는 read_guide 를 부르지 않으면
//  알 수 없고, 빠뜨리면 지침 전문을 담은 오류가 돌아온다. 어느 쪽이든 지침은
//  반드시 모델의 눈을 한 번 지나간다. 읽기 도구는 막지 않는다 — 읽는 것은 아무
//  것도 망치지 않고, 막으면 성가시기만 하다.
//
// 코드는 왜 손으로 적나
//  지침을 고칠 때마다 사람이 바꾸도록 둔다. 자동으로 만들면 지침이 바뀐 줄
//  모르고 옛 코드를 계속 쓰게 되고, 날짜로 만들면 대화 도중에 코드가 바뀐다.
// ---------------------------------------------------------------------------

const GUIDE_ACK = "guide-2026-08-14-r1"

const GUIDE_TEMPLATE = [
  "HADD IP 사용 지침 — 쓰기 전에 반드시 한 번 읽는다",
  "",
  "■ 1. 기록이 원본이다",
  "상표·특허의 단계·번호·날짜를 직접 고치는 도구는 없다. 무슨 일이 있었는지를 기록하면 지식재산권 목록이 그 결과로 바뀐다. 그래서 목록은 언제든 기록에서 다시 계산된다 — 기록이 틀리면 목록도 틀린다.",
  "",
  "■ 2. 인용된 원본은 근거가 아니다 (가장 자주 틀리는 곳)",
  "회신 메일에는 우리가 보낸 원본이 「--------- 원본 메일 ---------」·「보낸사람:」 아래에 함께 실려 온다.",
  "그 아래는 이미 지난 일이거나 **우리가 쓴 글**이다. 구분선 위, 새로 온 몇 줄만 이 기록의 근거다.",
  "아래에서 등록가능성·지정상품·권고사항을 끌어올려 상대가 말한 것처럼 적으면 없던 사실이 만들어진다.",
  "새로 온 부분이 인사와 「검토하고 답변드리겠습니다」뿐이라면, 기록할 사실도 그것뿐이다.",
  "",
  "■ 3. 지어내지 않는다",
  "상대가 말하지 않은 것은 비운다. 모르는 칸은 비운다 — 그럴듯한 값을 채우는 것보다 비어 있는 것이 낫다.",
  "숫자(등록가능성·번호)는 이 메일에서 새로 말한 것만 넣는다. 지난 검토의견의 숫자를 옮기면 그 메일이 그 말을 한 것처럼 남는다.",
  "",
  "■ 4. 근거 원문을 남긴다",
  "메일이 근거라면 raw 에 새로 온 부분을 그대로 붙인다. **없으면 저장되지 않는다** — 권고가 아니라 조건이다.",
  "요약만 남으면 「정말 그렇게 적혀 있었나」를 사람이 확인할 길이 없고, 잘못 옮긴 요약이 그대로 사실이 된다.",
  "메일 본문을 갖고 있지 않다면(사람이 말로 전해 준 경우) source 를 manual 로 두고 note 에 누가 어떻게 전했는지 적는다.",
  "",
  "■ 5. 차례(nextTurn)는 방향과 다르다",
  "상대가 답을 예고했으면(「답변드리겠습니다」·「검토 후 연락드리겠습니다」) firm.",
  "상대가 우리에게 물었으면(「진행하시겠습니까」·「회신 부탁드립니다」) us.",
  "받은 메일이라는 이유로 us 를 고르지 않는다. 이 값이 「밀린 IP 업무」를 만든다 — 틀리면 사람이 엉뚱한 일을 한다.",
  "",
  "■ 6. 진행과 정정을 구분한다",
  "일이 진행된 것(출원했다·회신이 왔다)은 add_progress. 여태 잘못 적혀 있던 값(오타·엉뚱한 번호·틀린 단계)은 correct_ip.",
  "정정은 「원래부터 이랬다」는 뜻이라 마지막 진행일을 움직이지 않는다.",
  "",
  "■ 7. 쓰기 전에 본다",
  "list_stages 로 쓸 수 있는 단계를 확인하고, get_ip 로 같은 일이 이미 적혀 있지 않은지 본다. 날짜는 KST 이며 일이 일어난 날을 적는다(오늘이 아니다).",
  "**ID·단계를 사용자에게 되묻지 않는다.** 사용자는 「VIVOFRAME」처럼 이름만 안다 — list_ip 로 찾는 것이 도구의 일이다. 물어보면 사람이 우리 내부 번호를 찾아 적어야 하고, 그러면 이 도구를 쓸 이유가 없어진다.",
  "새 건을 만들기 전에는 list_ip 로 같은 건을 찾아본다 — 이름만 다르게 적힌 같은 건을 둘로 만들면 합치기 어렵다.",
  "",
  "■ 8. 권리를 이전받았을 때 (양수·승계)",
  "「뇌연구원에서 이전받았다」처럼 **주인이 바뀐 것**은 진행이 아니다. 출원→심사→등록이라는 진도가 움직인 것이 아니므로 stage 는 **지금 단계를 그대로** 적는다(get_ip 의 현재.status). 「이전」이라는 단계는 없다 — 찾지 말고 사용자에게 묻지도 않는다.",
  "add_progress: date=이전등록일 · stage=지금 단계 · counterpart=넘겨준 쪽 · nextTurn='none' · note 에 누구에게서 이전받았는지.",
  "이어서 correct_ip 로 holder(출원인·보유자)를 「{ORG}」 로 바꾼다. 이것을 빠뜨리면 목록에는 계속 남의 이름이 남는다. 우리 이름은 여기 적혀 있으니 사용자에게 묻지 않는다.",
  "**이전일을 등록일로 만들지 않는다.** 단계가 '등록'인 건에 '등록' 기록을 남기면, 등록일이 비어 있을 때 그 날짜가 그대로 등록일이 된다. get_ip 의 현재.registered_on 을 먼저 본다 — 비어 있으면 **원 등록일(특허청 원부의 등록일)로 등록 기록을 먼저 남기고** 그다음 이전 기록을 남긴다. 원 등록일을 모르면 그것만 사용자에게 묻는다.",
  "",
  "■ 9. 쓴 뒤에 확인한다",
  "응답의 목록_반영을 읽는다. 지난 날짜로 기록하면 단계가 그대로인 것이 정상이다 — 지난 일로 현재를 되돌리지 않기 때문이다. 실패로 보고 다시 쓰면 중복 기록만 쌓인다.",
  "기록_id 가 돌아왔으면 저장된 것이다.",
  "",
  `■ 확인 코드: ${GUIDE_ACK}`,
  "쓰기 도구(add_progress · correct_ip · create_ip)의 guide 인자에 이 값을 그대로 넣는다.",
].join("\n")

/**
 * 우리 조직 이름을 지침에 박아 넣는다.
 *
 * 권리를 이전받으면 출원인을 우리 이름으로 바꿔야 하는데, 그 이름을 모르면
 * 모델은 사용자에게 묻는다 — 실제로 저비용 모델 3대가 전부 「우리 기관명이
 * 뭐냐」를 되물었다. ID·단계를 되묻지 않게 만든 것과 같은 이유로, 서버가
 * 아는 사실은 서버가 알려준다. 조회에 실패해도 지침은 나가야 하므로
 * 자리표시자만 지운다.
 */
async function guideText(): Promise<string> {
  const rows = await prisma.$queryRaw<{ org: string }[]>`
    SELECT org FROM ip.org_meta WHERE id = 1`
  return GUIDE_TEMPLATE.replace("{ORG}", rows[0]?.org ?? "우리 조직")
}

/** 클라이언트가 시스템 프롬프트에 실어주는 자리. 짧게 길만 알려준다. */
export const INSTRUCTIONS = [
  "HADD SCIENCE 지식재산권 기록 서버입니다.",
  "기록을 남기거나 고치기 전에 read_guide 를 한 번 부르세요. 쓰기 도구는 거기서 받은 확인 코드를 요구합니다.",
  "특히 회신 메일을 옮길 때는 인용된 원본(구분선 아래)이 아니라 새로 온 부분만 근거로 삼아야 합니다.",
].join("\n")

/** 쓰기 도구가 공통으로 받는 칸. 지침을 지나오지 않으면 채울 수 없다. */
const GUIDE_ARG = {
  guide: {
    type: "string",
    description:
      "read_guide 가 알려준 확인 코드. 지침을 한 번은 읽고 쓰게 하려는 장치다. 이 인자를 보낼 수 없는 도구라면 비워도 된다 — 첫 시도는 지침과 함께 거절되고, 같은 호출을 그대로 다시 보내면 저장된다.",
  },
} as const

// ---------------------------------------------------------------------------
// 도구
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: "read_guide",
    description:
      "이 서버에 기록을 남기는 방법. **쓰기 전에 반드시 한 번 부른다.** 무엇을 근거로 삼아야 하고 무엇을 지어내면 안 되는지, 차례를 어떻게 판단하는지가 적혀 있다. 마지막에 확인 코드를 알려주는데, 쓰기 도구는 그 코드를 요구한다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_stages",
    description:
      "진행 단계 목록. 기록을 남기기 전에 먼저 불러 어떤 단계 값을 쓸 수 있는지 확인한다. 단계마다 추가로 채워야 하는 칸(출원번호·등록번호·기한 등)도 함께 알려준다.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["trademark", "patent"],
          description: "상표(trademark) 또는 특허(patent)",
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "list_ip",
    description:
      "보유한 상표·특허 목록. **사용자가 이름만 말했을 때 ID 를 찾는 길이 이것이다.** 「VIVOFRAME 기록해줘」처럼 이름만 들었으면 query 에 그 이름을 넣어 부른다 — 사용자에게 ID 를 되묻지 않는다. 이름 일부·출원번호·등록번호로 찾는다.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["trademark", "patent"],
          description: "생략하면 둘 다",
        },
        query: { type: "string", description: "이름·번호에 포함된 말" },
      },
    },
  },
  {
    name: "get_ip",
    description:
      "건 하나의 지금 상태와 진행 이력 전부. 「어디까지 진행됐나」에 답할 때 쓴다. list_ip 로 ID 를 찾은 뒤 부른다. 이력에는 우리가 엑셀에서 이어받은 출발선(opening)도 함께 나오는데, 그것은 사건이 아니라 인수 시점이다.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string", description: "대상 ID. 예: TM-13, PT-07" },
        entityKind: {
          type: "string",
          enum: ["trademark", "patent"],
          description: "생략하면 ID 접두사(TM-/PT-)로 판단한다.",
        },
      },
      required: ["entityId"],
    },
  },
  {
    name: "list_todo",
    description:
      "밀린 업무. 건마다 가장 최근 기록을 보고 우리 차례로 남아 있는 것과 상대 회신을 기다리는 것을 알려준다.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_progress",
    description: [
      "진행 기록을 남긴다. 이 도구 하나로 지식재산권 목록(단계·번호·날짜)까지 함께 갱신된다 — 지식재산권 목록을 따로 고치지 않는다.",
      "메일이 근거라면 받은 메일이든 보낸 메일이든 그 내용을 note 에 옮기고 direction 을 채운 뒤 source 를 'mail' 로 두고, raw 에 근거가 된 원문을 그대로 붙인다.",
      "",
      "【인용된 원본은 근거가 아니다 — 가장 자주 틀리는 곳】",
      "회신 메일에는 우리가 보낸 원본이 「--------- 원본 메일 ---------」 아래에 함께 실려 온다. 그 아래는 이미 기록된 과거이거나 우리가 쓴 글이다.",
      "**구분선 위, 새로 온 몇 줄만 이 기록의 근거다.** 아래에서 등록가능성·지정상품·권고사항을 끌어올려 상대가 말한 것처럼 적으면 없던 사실을 만든다.",
      "새로 온 부분이 인사와 「검토하고 답변드리겠습니다」뿐이라면, 기록할 사실도 그것뿐이다.",
      "",
      "【지금 누구 차례인지】",
      "상대가 회신을 예고했으면(「답변드리겠습니다」·「검토 후 연락드리겠습니다」) nextTurn='firm' 이다. 상대가 우리에게 물었으면(「진행하시겠습니까」·「회신 부탁드립니다」) 'us' 다.",
      "받은 메일이라는 이유로 'us' 를 고르지 않는다 — 방향과 차례는 다른 것이다.",
      "",
      "결과로 기록_id 와 지식재산권 목록의 이전·이후 상태를 돌려주므로 정말 반영됐는지 그 자리에서 확인할 수 있다 — 기록_id 가 있으면 저장된 것이니 같은 내용을 다시 쓰지 않는다.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "일자 YYYY-MM-DD (KST)" },
        entityKind: { type: "string", enum: ["trademark", "patent"] },
        entityId: {
          type: "string",
          description:
            "대상 ID. 예: TM-13, PT-07. **모르면 list_ip 에 이름을 넣어 찾는다 — 사용자에게 되묻지 않는다.** ID 를 찾는 것은 도구가 할 일이고, 사용자는 대개 이름만 알고 있다.",
        },
        stage: {
          type: "string",
          description:
            "단계. **모르면 list_stages 를 먼저 부른다** — 여기에 없는 값은 거절된다. 사용자에게 단계 이름을 묻지 않는다. 단계가 움직이지 않는 사건(권리 이전·양수처럼 주인만 바뀐 것)이면 get_ip 로 본 **지금 단계를 그대로** 적는다.",
        },
        direction: {
          type: "string",
          enum: ["수신", "송신"],
          description:
            "메일을 주고받은 기록이면 방향. 받은 메일이면 '수신', 보낸 메일이면 '송신'. 구두·회의·내부 결정이면 비운다. 이 칸을 채웠다면 source 는 반드시 'mail' 이다.",
        },
        counterpart: { type: "string", description: "상대. 예: 특허법인 이름" },
        nextTurn: {
          type: "string",
          enum: ["us", "firm", "none"],
          description:
            "지금 누구 차례인지. us=회신 필요, firm=상대 회신 대기, none=대기 없음. 상대가 답을 예고했으면 'firm', 상대가 우리에게 물었으면 'us'. 받은 메일이라는 이유로 'us' 를 고르지 않는다.",
        },
        dueOn: { type: "string", description: "기한 YYYY-MM-DD" },
        appNo: { type: "string", description: "출원번호" },
        regNo: { type: "string", description: "등록번호" },
        probability: {
          type: "number",
          description:
            "등록가능성 %. **이 메일에서 상대가 새로 말한 숫자만** 넣는다. 인용된 원본이나 지난 검토의견에 있던 숫자를 여기 옮기면 그 메일이 그 말을 한 것처럼 남는다.",
        },
        note: {
          type: "string",
          description:
            "무슨 일이 있었는지. 새로 온 부분에 적힌 것만 쓴다. 상대가 말하지 않은 권고·제안을 채우지 않는다.",
        },
        raw: {
          type: "string",
          description:
            "근거가 된 원문 그대로. 메일이면 새로 온 부분(인용된 원본 제외)을 붙인다. 나중에 「정말 그렇게 적혀 있었나」를 사람이 확인하는 유일한 길이므로, source 가 'mail' 이면 반드시 채운다.",
        },
        source: {
          type: "string",
          enum: ["manual", "mail"],
          description:
            "이 근거가 어디서 왔는지. 사용자가 메일 본문을 붙여넣었거나 '이렇게 보냈어'·'이런 답이 왔어' 처럼 주고받은 메일을 옮기는 것이면 방향과 무관하게 'mail'. 구두·회의·내부 결정처럼 메일이 아닌 것만 'manual'. 생략하면 'manual' 이지만, direction 을 채웠다면 서버가 'mail' 로 바로잡는다.",
        },
        ...GUIDE_ARG,
      },
      required: ["date", "entityKind", "entityId", "stage", "nextTurn", "guide"],
    },
  },
  {
    name: "correct_ip",
    description:
      "이름·보유자·출원번호·등록번호·단계를 고친다. 지식재산권 목록을 직접 찌르지 않고 「값 정정」 기록 한 줄로 남기므로 무엇이 언제 왜 바뀌었는지 이력에 남는다. 일이 진행된 것(출원했다·등록됐다)은 이 도구가 아니라 add_progress 로 남긴다 — 정정은 「원래부터 이랬다」는 뜻이라 마지막 진행일을 움직이지 않는다. 값을 비우려면 빈 문자열을 넘긴다.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string", description: "대상 ID. 예: TM-13, PT-07" },
        entityKind: {
          type: "string",
          enum: ["trademark", "patent"],
          description: "생략하면 ID 접두사(TM-/PT-)로 판단한다.",
        },
        name: { type: "string", description: "상표 이름 · 특허 명칭" },
        holder: { type: "string", description: "보유자 · 출원인" },
        appNo: { type: "string", description: "출원번호" },
        regNo: { type: "string", description: "등록번호" },
        stage: {
          type: "string",
          description:
            "단계. 「엑셀 인수 당시 단계가 실제와 달랐다」처럼 지금까지 잘못 적혀 있던 경우에만 쓴다.",
        },
        reason: {
          type: "string",
          description: "왜 고치는지. 이력에 그대로 남으므로 근거를 적는다.",
        },
        ...GUIDE_ARG,
      },
      required: ["entityId", "reason", "guide"],
    },
  },
  {
    name: "create_ip",
    description:
      "지식재산권 목록에 없는 건을 새로 만든다. 아이디어 단계의 상표처럼 아직 아무 일도 일어나지 않은 것을 자리부터 잡을 때 쓴다. 먼저 list_ip 로 같은 건이 이미 있는지 확인한다 — 이름만 다르게 적힌 같은 건을 둘로 만들면 나중에 합치기 어렵다. 만든 뒤 진행이 있었다면 add_progress 로 이어 적는다.",
    inputSchema: {
      type: "object",
      properties: {
        entityKind: { type: "string", enum: ["trademark", "patent"] },
        name: { type: "string", description: "상표 이름 · 특허 명칭" },
        stage: {
          type: "string",
          description:
            "시작 단계. list_stages 가 알려준 값 중 하나여야 한다. 보통 '아이디어'.",
        },
        note: { type: "string", description: "비고. 없으면 비운다." },
        ...GUIDE_ARG,
      },
      required: ["entityKind", "name", "stage", "guide"],
    },
  },
] as const

/** 쓰기 도구 이름. 지침을 지나왔는지 여기서 한 번에 본다. */
const WRITE_TOOLS = new Set(["add_progress", "correct_ip", "create_ip"])

export type ToolResult = { text: string } | { error: string }

/** 이 사람에게 지금 지침을 보여줬다고 적어 둔다. */
async function rememberGuideShown(userId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO ip.mcp_guide_reads (user_id, ack, shown_at)
    VALUES (${userId}, ${GUIDE_ACK}, now())
    ON CONFLICT (user_id) DO UPDATE SET ack = ${GUIDE_ACK}, shown_at = now()`
}

/**
 * 지침을 지나오지 않은 쓰기를 막는다. 막힐 일이 없으면 null 을 돌려준다.
 *
 * 왜 확인 코드만으로 판단하지 않나
 *  커넥터가 들고 있는 도구 스키마는 처음 붙일 때 받아 둔 사본이다. 서버를 새로
 *  올려도 그 사본은 바뀌지 않고, 클라이언트는 사본에 없는 인자를 보내지 못한다.
 *  실제로 ChatGPT 가 「guide 인자를 전달할 수 있는 항목이 없어 기록을 완료할 수
 *  없다」며 멈췄다. 막는 장치가 일을 못 하게 만드는 장치가 되면 안 된다.
 *
 * 그래서 두 길을 모두 받는다
 *  * 확인 코드가 맞으면 그대로 통과 — 한 번의 호출로 끝난다.
 *  * 코드가 없으면 첫 시도를 거절하면서 지침 전문을 돌려주고, 보여줬다고 적는다.
 *    같은 호출을 다시 보내면 그때는 저장된다.
 *  느슨해 보이지만 목적은 그대로다. 두 번째 호출이 오는 시점에 지침은 이미 그
 *  대화 안에 있다 — 「무조건 한 번은 읽는다」가 지켜진다.
 */
async function guideGate(userId: string, given: unknown): Promise<ToolResult | null> {
  if (given === GUIDE_ACK) return null

  const rows = await prisma.$queryRaw<{ ack: string }[]>`
    SELECT ack FROM ip.mcp_guide_reads WHERE user_id = ${userId}`
  // 지침이 바뀌면(ack 이 달라지면) 다시 보여준다. 한 번 읽고 영원히 통과가 되면
  // 규칙을 고쳐도 옛 방식 그대로 쓰게 된다.
  if (rows[0]?.ack === GUIDE_ACK) return null

  await rememberGuideShown(userId)
  return {
    error: [
      given
        ? `확인 코드가 맞지 않습니다(받은 값: ${String(given)}). 지침이 바뀌었습니다.`
        : "이번 기록은 저장하지 않았습니다. 쓰기 전에 사용 지침을 한 번 읽어야 합니다.",
      "",
      "아래 지침을 읽고 **같은 호출을 그대로 다시 보내면 저장됩니다.** guide 인자를 보낼 수 없는 도구라면 그대로 다시 보내기만 하면 됩니다 — 이 안내를 이미 받았다는 것을 서버가 기억합니다.",
      "다시 보내기 전에, 지침에 비추어 값이 맞는지 보세요. 특히 두 가지가 자주 틀립니다.",
      "  · 근거 — 인용된 원본에서 끌어온 값이 아닌지 (등록가능성·지정상품·권고사항)",
      "  · 차례 — 상대가 답을 예고했다면 us 가 아니라 firm",
      "",
      "─".repeat(20),
      await guideText(),
    ].join("\n"),
  }
}

// ─── 도구 실행 ──────────────────────────────────────────────────────

type Row = Record<string, unknown>

/** 대장 한 건. 쓰기 전후를 견주려고 같은 칸만 뽑는다. */
async function ledgerOf(kind: string, id: string): Promise<Row | null> {
  const rows =
    kind === "trademark"
      ? await prisma.$queryRaw<Row[]>`
          SELECT status, ref_date, app_no, reg_no, filed_on, registered_on
            FROM ip.trademarks WHERE id = ${id}`
      : await prisma.$queryRaw<Row[]>`
          SELECT status, ref_date, app_no, reg_no, filed_on, registered_on
            FROM ip.patents WHERE id = ${id}`
  return rows[0] ?? null
}

async function stageExists(kind: string, value: unknown): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM ip.status_options WHERE kind = ${kind} AND value = ${String(value)}`
  return rows.length > 0
}

/** ID 접두사가 곧 부류다. 굳이 물어보지 않아도 되게 한다. */
function kindOf(args: Record<string, unknown>, id: string): string {
  return (
    (args.entityKind as string | undefined) ??
    (id.toUpperCase().startsWith("PT") ? "patent" : "trademark")
  )
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  caller: Caller
): Promise<ToolResult> {
  if (name === "read_guide") {
    await rememberGuideShown(caller.userId)
    return { text: await guideText() }
  }

  if (WRITE_TOOLS.has(name)) {
    const blocked = await guideGate(caller.userId, args.guide)
    if (blocked) return blocked
  }

  if (name === "list_stages") {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT value, sort_order, is_open, wants_app_no, wants_reg_no,
             wants_probability, wants_due
        FROM ip.status_options
       WHERE kind = ${String(args.kind)} AND selectable = true
       ORDER BY sort_order`
    return { text: JSON.stringify(rows, null, 2) }
  }

  if (name === "list_ip") {
    const kind = args.kind as string | undefined
    const query = ((args.query as string) ?? "").trim()
    const like = `%${query}%`
    const out: unknown[] = []

    if (kind !== "patent") {
      const rows = query
        ? await prisma.$queryRaw<Row[]>`
            SELECT id, name, status, app_no, reg_no, ref_date, holder
              FROM ip.trademarks
             WHERE name ILIKE ${like} OR app_no ILIKE ${like} OR reg_no ILIKE ${like}
             ORDER BY id`
        : await prisma.$queryRaw<Row[]>`
            SELECT id, name, status, app_no, reg_no, ref_date, holder
              FROM ip.trademarks ORDER BY id`
      out.push(...rows.map((r) => ({ kind: "trademark", ...r })))
    }
    if (kind !== "trademark") {
      const rows = query
        ? await prisma.$queryRaw<Row[]>`
            SELECT id, title, status, app_no, reg_no, ref_date, applicant
              FROM ip.patents
             WHERE title ILIKE ${like} OR app_no ILIKE ${like} OR reg_no ILIKE ${like}
             ORDER BY id`
        : await prisma.$queryRaw<Row[]>`
            SELECT id, title, status, app_no, reg_no, ref_date, applicant
              FROM ip.patents ORDER BY id`
      out.push(...rows.map((r) => ({ kind: "patent", ...r })))
    }
    return { text: JSON.stringify(out, null, 2) }
  }

  if (name === "get_ip") {
    const id = String(args.entityId ?? "").trim()
    const kind = kindOf(args, id)

    const row =
      kind === "trademark"
        ? (
            await prisma.$queryRaw<Row[]>`
              SELECT id, name, name_ko, classes, goods, status, app_no, reg_no,
                     ref_date, filed_on, registered_on, holder, probability, note
                FROM ip.trademarks WHERE id = ${id}`
          )[0]
        : (
            await prisma.$queryRaw<Row[]>`
              SELECT id, title, status, app_no, reg_no, ref_date, filed_on,
                     registered_on, applicant, note
                FROM ip.patents WHERE id = ${id}`
          )[0]

    if (!row) {
      return {
        error: `${id} 는 지식재산권 목록에 없습니다. list_ip 로 ID 를 먼저 확인하세요.`,
      }
    }

    const opening = (
      await prisma.$queryRaw<Row[]>`
        SELECT stage, ref_date, taken_over_on, source_note
          FROM ip.opening_state
         WHERE entity_kind = ${kind} AND entity_id = ${id}`
    )[0]

    // raw(근거 원문)를 함께 준다. 요약만 돌려주면 「그렇게 적혀 있었나」를
    // 되짚을 수 없고, 지어낸 요약이 그대로 사실로 굳는다.
    const history = await prisma.$queryRaw<Row[]>`
      SELECT occurred_on, stage, direction, counterpart, next_turn, due_on,
             app_no, reg_no, name, holder, probability, note, source, raw
        FROM ip.progress_entries
       WHERE entity_kind = ${kind} AND entity_id = ${id}
       ORDER BY occurred_on DESC`

    return {
      text: JSON.stringify(
        {
          현재: row,
          진행_이력: history,
          // 기록이 없으면 왜 없는지가 답의 일부다. 지어낸 일이 아니라 인수분이다.
          출발선: opening
            ? {
                ...opening,
                설명: "우리가 이 상태를 이어받은 시점입니다. 그날 무슨 일이 있었다는 뜻이 아닙니다.",
              }
            : null,
        },
        null,
        2
      ),
    }
  }

  if (name === "list_todo") {
    // 건마다 가장 최근 기록만 본다. 옛 기록의 「회신 필요」는 이미 지나간 상태다.
    // 값 정정(source='edit')은 누구 차례인지에 대해 아무 말도 하지 않으므로 건너뛴다.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT DISTINCT ON (entity_kind, entity_id)
             id, occurred_on, entity_kind, entity_id, stage, next_turn,
             due_on, counterpart, note, source
        FROM ip.progress_entries
       WHERE source <> 'edit'
       ORDER BY entity_kind, entity_id, occurred_on DESC, created_at DESC`
    return {
      text: JSON.stringify(
        {
          회신_필요: rows.filter((r) => r.next_turn === "us"),
          상대_회신_대기: rows.filter((r) => r.next_turn === "firm"),
        },
        null,
        2
      ),
    }
  }

  if (name === "add_progress") {
    // Prisma 는 DB 소유자로 붙어 RLS 를 지나가므로, 쓰기 권한은 여기서 직접 본다.
    if (caller.role === "viewer") {
      return { error: "읽기 전용 권한입니다. 기록을 남길 수 없습니다." }
    }

    const kind = args.entityKind as string
    const id = String(args.entityId ?? "")

    // 쓰기 전 대장을 떠 둔다. 쓴 뒤와 견줘야 "정말 바뀌었나"를 부르는 쪽이 볼 수
    // 있다. 진행 기록은 들어갔는데 대장은 안 움직이는 경우가 실제로 있다.
    // 출원일·등록일도 함께 본다 — 그 사실이 응답에 안 보이면 권리 이전처럼 단계가
    // 안 움직이는 기록이 등록일을 채워도 아무도 눈치채지 못한다.
    const before = await ledgerOf(kind, id)
    if (!before) {
      return {
        error: `${id} 는 지식재산권 목록에 없습니다. list_ip 로 ID 를 먼저 확인하세요.`,
      }
    }

    if (!(await stageExists(kind, args.stage))) {
      return {
        error: `'${args.stage}' 는 쓸 수 없는 단계입니다. list_stages 를 먼저 부르세요.`,
      }
    }

    // 방향이 채워졌는데 'manual' 이라 말한 경우는 DB 트리거가 'mail' 로 바로잡는다
    // — 같은 판단이 웹 양식에도 걸려야 해서 한 곳에 둔다.
    const source = args.source === "mail" ? "mail" : "manual"

    // 근거 없는 메일 기록은 받지 않는다.
    //
    // 처음에는 저장한 뒤 응답에 「주의」를 실어 보냈다. 그러자 ChatGPT 는
    // 「다음부터는 원문까지 남기는 것이 권장됩니다」로 끝냈다 — 당연하다.
    // 쓰기는 성공했다고 돌려받았고, 이미 저장된 기록에 원문을 채워 넣을 도구는
    // 없으며, 다시 쓰면 중복이라고 우리가 지침에 적어 두었다. 할 수 있는 일이
    // 없는데 시켰으니 권고로 끝난 것이다.
    //
    // 그래서 성공시키지 않는다. 저장 전에 막으면 부르는 쪽이 할 수 있는 일은
    // 하나뿐이다 — 원문을 담아 다시 보내는 것.
    if (source === "mail" && !String(args.raw ?? "").trim()) {
      return {
        error: [
          "저장하지 않았습니다. 메일이 근거인 기록은 raw(근거 원문)가 반드시 있어야 합니다.",
          "요약만 남으면 「정말 그렇게 적혀 있었나」를 사람이 확인할 수 없고, 잘못 옮긴 요약이 그대로 사실이 됩니다 — 실제로 그런 일이 있었습니다.",
          "",
          "raw 에 **새로 온 부분의 원문**을 그대로 담아 같은 호출을 다시 보내세요. 인용된 원본(「--------- 원본 메일 ---------」 아래)은 넣지 않습니다.",
          "메일 본문을 갖고 있지 않다면(사람이 말로 전해 준 경우) source 를 'manual' 로 두고, note 에 누가 어떻게 전했는지 적으세요. 메일이라고 적으면서 원문이 없는 상태로는 남길 수 없습니다.",
        ].join("\n"),
      }
    }

    const written = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${caller.userId}, true)`
      const rows = await tx.$queryRaw<Row[]>`
        INSERT INTO ip.progress_entries
          (occurred_on, entity_kind, entity_id, stage, direction, counterpart,
           next_turn, due_on, app_no, reg_no, probability, note, source, raw)
        VALUES
          (${String(args.date)}::date, ${kind}, ${id}, ${String(args.stage)},
           ${(args.direction as string) ?? null}, ${(args.counterpart as string) ?? ""},
           ${String(args.nextTurn)}, ${(args.dueOn as string) ?? null}::date,
           ${(args.appNo as string) ?? null}, ${(args.regNo as string) ?? null},
           ${(args.probability as number) ?? null}, ${(args.note as string) ?? ""},
           ${source}, ${(args.raw as string) ?? null})
        RETURNING id, occurred_on, stage, direction, next_turn, source`
      return rows[0]
    })

    // 쓴 뒤의 대장. 트리거가 움직였는지는 여기서만 알 수 있다.
    const now = (await ledgerOf(kind, id)) ?? {}
    const changed = Object.keys(now).filter(
      (k) => String(now[k] ?? "") !== String(before[k] ?? "")
    )

    // 대장이 안 움직이는 정상적인 경우가 하나 있다: 더 최근 기록이 이미 있을 때.
    // 지난 일을 뒤늦게 채우는 것이라 단계를 되돌리면 안 된다. 이걸 말해주지
    // 않으면 부르는 쪽은 "실패했다"고 보고 같은 걸 계속 다시 쓴다.
    const stageMoved = now.status === args.stage
    const beforeRef =
      before.ref_date instanceof Date
        ? before.ref_date.toISOString().slice(0, 10)
        : typeof before.ref_date === "string"
          ? before.ref_date.slice(0, 10)
          : null
    const olderThanLedger = beforeRef !== null && String(args.date) < beforeRef

    return {
      text: JSON.stringify(
        {
          기록됨: true,
          기록_id: written?.id ?? null,
          저장된_값: written,
          지식재산권_목록: { 이전: before, 이후: now, 바뀐_칸: changed },
          목록_반영: stageMoved
            ? "단계가 이 기록대로 바뀌었습니다."
            : olderThanLedger
              ? `단계는 그대로입니다. 더 최근 기록(${beforeRef})이 있어 지난 일로 되돌리지 않습니다 — 정상이며 다시 시도할 필요가 없습니다. 지금 상태를 바꾸려면 오늘 날짜로 기록하세요.`
              : "단계가 바뀌지 않았습니다. 예상과 다르면 get_ip 로 확인하세요.",
          확인_방법:
            "기록_id 가 있으면 저장된 것입니다. 같은 내용을 다시 쓰면 중복 기록이 생깁니다 — 실패로 보이더라도 먼저 get_ip 로 확인하세요.",
          기록자: caller.displayName ?? caller.email,
        },
        null,
        2
      ),
    }
  }

  if (name === "correct_ip") {
    if (caller.role === "viewer") {
      return { error: "읽기 전용 권한입니다. 값을 고칠 수 없습니다." }
    }

    const id = String(args.entityId ?? "").trim()
    const kind = kindOf(args, id)
    const NAME_COL = kind === "trademark" ? "name" : "title"
    const HOLDER_COL = kind === "trademark" ? "holder" : "applicant"

    const ledger = async (): Promise<Row | null> => {
      const rows =
        kind === "trademark"
          ? await prisma.$queryRaw<Row[]>`
              SELECT name, holder, status, ref_date, app_no, reg_no
                FROM ip.trademarks WHERE id = ${id}`
          : await prisma.$queryRaw<Row[]>`
              SELECT title, applicant, status, ref_date, app_no, reg_no
                FROM ip.patents WHERE id = ${id}`
      return rows[0] ?? null
    }

    const before = await ledger()
    if (!before) {
      return {
        error: `${id} 는 지식재산권 목록에 없습니다. list_ip 로 ID 를 먼저 확인하세요.`,
      }
    }

    // 안 넘긴 칸은 손대지 않고, 빈 문자열은 「비운다」는 뜻이다. 둘을 구분하지
    // 않으면 이름 하나 고치려다 나머지를 통째로 지운다.
    const patch = (key: string) => (args[key] === undefined ? null : String(args[key]))
    const touched = ["name", "holder", "appNo", "regNo", "stage"].filter(
      (k) => args[k] !== undefined
    )
    if (touched.length === 0) {
      return {
        error:
          "고칠 값이 하나도 없습니다. name·holder·appNo·regNo·stage 중 하나 이상을 넘기세요.",
      }
    }

    // 단계는 정정으로만 바꾼다. 정의에 없는 단계면 대장이 유령 값을 갖는다.
    if (args.stage !== undefined && !(await stageExists(kind, args.stage))) {
      return {
        error: `'${args.stage}' 는 쓸 수 없는 단계입니다. list_stages 를 먼저 부르세요.`,
      }
    }

    const reason = String(args.reason ?? "").trim()
    const written = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${caller.userId}, true)`
      const rows = await tx.$queryRaw<Row[]>`
        INSERT INTO ip.progress_entries
          (occurred_on, entity_kind, entity_id, stage, direction, counterpart,
           next_turn, due_on, app_no, reg_no, probability, name, holder, note, source, raw)
        VALUES
          (${todayKst()}::date, ${kind}, ${id},
           ${(args.stage as string) ?? String(before.status)},
           NULL, '', 'none', NULL,
           ${patch("appNo")}, ${patch("regNo")}, NULL,
           ${patch("name")}, ${patch("holder")},
           ${reason || `값 정정 (${touched.join(", ")})`},
           'edit', NULL)
        RETURNING id, occurred_on, stage, source`
      return rows[0]
    })

    const now = (await ledger()) ?? {}
    const changed = Object.keys(now).filter(
      (k) => String(now[k] ?? "") !== String(before[k] ?? "")
    )

    return {
      text: JSON.stringify(
        {
          고쳤음: changed.length > 0,
          기록_id: written?.id ?? null,
          지식재산권_목록: { 이전: before, 이후: now, 바뀐_칸: changed },
          설명:
            changed.length > 0
              ? "지식재산권 목록이 바뀌었고 「값 정정」 기록 한 줄이 이력에 남았습니다. 마지막 진행일은 움직이지 않았습니다."
              : "기록은 남았지만 지식재산권 목록은 그대로입니다 — 넘긴 값이 지금 값과 같거나, 더 최근 기록이 그 칸을 이미 채우고 있습니다. get_ip 로 확인하세요.",
          기록자: caller.displayName ?? caller.email,
          _칸이름: { 이름: NAME_COL, 보유자: HOLDER_COL },
        },
        null,
        2
      ),
    }
  }

  if (name === "create_ip") {
    if (caller.role === "viewer") {
      return { error: "읽기 전용 권한입니다. 건을 만들 수 없습니다." }
    }

    const kind = args.entityKind as string
    const name_ = String(args.name ?? "").trim()

    // 같은 건을 둘로 만들면 나중에 합치기 어렵다. 부르는 쪽이 확인하도록
    // 시켜두었지만, 이름이 완전히 같은 것만은 여기서도 막는다.
    const dup =
      kind === "trademark"
        ? await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM ip.trademarks WHERE name ILIKE ${name_}`
        : await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM ip.patents WHERE title ILIKE ${name_}`
    if (dup.length > 0) {
      return {
        error: `이미 같은 이름의 건이 있습니다: ${dup
          .map((d) => d.id)
          .join(", ")}. 새로 만들지 말고 그 건에 기록하세요.`,
      }
    }

    let newId: string
    try {
      newId = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${caller.userId}, true)`
        const rows = await tx.$queryRaw<{ create_case: string }[]>`
          SELECT ip.create_case(${kind}, ${name_}, ${String(args.stage)},
                                ${(args.note as string) ?? ""}) AS create_case`
        return rows[0].create_case
      })
    } catch (err) {
      return { error: (err as Error).message }
    }

    return {
      text: JSON.stringify(
        {
          만들었음: true,
          id: newId,
          이름: name_,
          단계: args.stage,
          설명:
            "지식재산권 목록에 자리를 잡았고, 되짚을 수 있도록 출발선도 함께 적었습니다. 이 건에 진행이 있으면 add_progress 로 이어 적으세요.",
          만든이: caller.displayName ?? caller.email,
        },
        null,
        2
      ),
    }
  }

  return { error: `모르는 도구입니다: ${name}` }
}

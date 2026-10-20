// 홈페이지 기사 영상 블록 — 스키마가 받는 것 · 거절하는 것 · 번역이 지키는 것.
//   npx tsx --env-file=.env scripts/verify-website-video.ts
//
// Gemini 는 부르지 않는다. fetch 를 가짜로 바꿔 모델이 영상 칸을 망친 응답을 돌려주게 하고,
// 그래도 ID·시작 위치가 원문 그대로 남는지 본다. 호출 한도 확인이 사용량 표를 읽고 쓰므로 로컬 DB 에서만 돈다.
export {}

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) throw new Error("로컬 DB 에서만 돈다 — Gemini 사용량 표에 기록이 남는다")
process.env.GEMINI_API_KEY = "stub"

const { PostBlockSchema, PostInputSchema } = await import("../lib/schemas/website")
const { sourceHash, translateLocale } = await import("../lib/website-translate")
type PostLocale = import("../lib/schemas/website").PostLocale

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}
const parses = (b: unknown) => PostBlockSchema.safeParse(b).success

const video = { type: "video", provider: "youtube", id: "6C6ythdPMa4", start: 355, title: "하드사이언스 발표" } as const

console.log("— 받는 것")
check("ID·시작·제목", parses(video), true)
check("ID 만", parses({ type: "video", provider: "youtube", id: "6C6ythdPMa4" }), true)
check("- _ 가 든 ID", parses({ type: "video", provider: "youtube", id: "a-b_c-d_e-f" }), true)
check("start 0", parses({ ...video, start: 0 }), true)

console.log("— 거절하는 것")
check("주소를 ID 칸에", parses({ ...video, id: "https://youtu.be/6C6ythdPMa4" }), false)
check("10자", parses({ ...video, id: "6C6ythdPMa" }), false)
check("12자", parses({ ...video, id: "6C6ythdPMa4x" }), false)
check("따옴표가 든 ID", parses({ ...video, id: '6C6ythd"Ma4' }), false)
check("다른 provider", parses({ ...video, provider: "vimeo" }), false)
check("provider 없음", parses({ type: "video", id: "6C6ythdPMa4" }), false)
check("음수 start", parses({ ...video, start: -1 }), false)
check("소수 start", parses({ ...video, start: 1.5 }), false)
check("문자열 start", parses({ ...video, start: "355" }), false)
check("24시간 넘는 start", parses({ ...video, start: 86_401 }), false)

console.log("— 기사 저장 요청 전체")
const input = {
  date: "2026.10.20",
  sourceLang: "ko",
  thumbnail: null,
  externalHref: null,
  content: { ko: { title: "제목", summary: "요약", blocks: [{ type: "text", text: "본문" }, video] } },
}
check("영상 블록이 든 기사", PostInputSchema.safeParse(input).success, true)

console.log("— 원문 해시")
const ko: PostLocale = { title: "제목", summary: "요약", blocks: [{ type: "text", text: "본문" }, video] }
const h = sourceHash(ko)
check("영상 ID 를 바꾸면 해시가 바뀐다", sourceHash({ ...ko, blocks: [ko.blocks[0], { ...video, id: "dQw4w9WgXcQ" }] }) !== h, true)
check("시작 위치를 바꾸면 해시가 바뀐다", sourceHash({ ...ko, blocks: [ko.blocks[0], { ...video, start: 10 }] }) !== h, true)
check("같은 원문이면 해시가 같다", sourceHash(structuredClone(ko)) === h, true)

console.log("— 번역")
let sentPrompt = ""
const reply = (blocks: unknown[]) => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sentPrompt = String(init?.body ?? "")
    const text = JSON.stringify({ title: "Title", summary: "Summary", blocks })
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }), { status: 200 })
  }) as typeof fetch
}

// 모델이 영상 칸에 엉뚱한 id 를 끼워 넣어도 무시돼야 한다.
reply([{ text: "Body" }, { text: "HADD Science talk", id: "XXXXXXXXXXX", start: 1 }])
const en = await translateLocale(ko, "ko", "en")
check("제목만 번역되고 ID·시작은 원문", en.blocks[1], { ...video, title: "HADD Science talk" })
check("모델에 영상 ID 를 보내지 않는다", sentPrompt.includes("6C6ythdPMa4"), false)
check("번역본도 스키마를 통과", en.blocks.every(parses), true)

// 제목 없는 영상 — 모델이 text 를 지어내도 붙이지 않는다.
const bare: PostLocale = { title: "제목", summary: "", blocks: [{ type: "video", provider: "youtube", id: "6C6ythdPMa4" }] }
reply([{ text: "made up" }])
check("제목 없는 영상은 제목 없이", (await translateLocale(bare, "ko", "en")).blocks[0], bare.blocks[0])

// 모델이 영상 칸을 빼먹으면(text 없음) 원문 제목을 지킨다.
reply([{ text: "Body" }, {}])
check("번역이 비면 원문 제목", (await translateLocale(ko, "ko", "en")).blocks[1], video)

const { prisma } = await import("../lib/db")
await prisma.$disconnect()
console.log(fail ? `\n${fail}건 실패` : "\n전부 통과")
process.exit(fail ? 1 : 0)

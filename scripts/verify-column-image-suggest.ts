// 칼럼 초안 이미지 제안 — 파싱 · 저장 · 옛 초안 호환 · 게시에서 빠지는지.
//   npx tsx --env-file=.env scripts/verify-column-image-suggest.ts
//
// Gemini 는 부르지 않는다. fetch 를 가짜로 바꿔 모델 응답(제안이 온전한 것 · 일부 빠진 것 · 망가진 것 · 제안 없는 옛 형식)을
// 돌려주고, 근거 기사 읽기는 404 로 떨어뜨린다. 시험용 키워드·초안을 로컬 DB 에 만들고 끝에 지운다.
export {}

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) throw new Error("로컬 DB 에서만 돈다 — 시험용 키워드·초안을 만들고 지운다")
process.env.GEMINI_API_KEY = "stub"

const { prisma } = await import("../lib/db")
const { generateDraft, publishInput, reviewProblems, updateDraft } = await import("../lib/column/draft")
const { ImageSuggestionsSchema, toImageSuggestions } = await import("../lib/column/image-suggest")

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}

const img = (tag: string) => ({
  idea: `${tag} 장면`,
  sources: ["정책브리핑·식약처 보도자료 사진(공공누리 유형 확인)", "AI 생성 이미지"],
  prompt: `16:9 infographic, ${tag}, no text, no logos`,
})
const full = {
  title: "제목",
  summary: "부제",
  leadImage: img("LEAD"),
  sections: [
    { heading: "첫 소제목", paragraphs: ["문단 [1]"], image: img("H0") },
    { heading: "둘째 소제목", paragraphs: ["문단 [2]"], image: img("H1") },
    { heading: "셋째 소제목", paragraphs: ["문단"], image: img("H2") },
  ],
}

console.log("— 파싱")
const all = toImageSuggestions(full)
check("맨 앞 1 + 소제목 3", all.map((s) => `${s.id}:${s.target}:${s.heading ?? ""}:${s.n ?? ""}`), [
  "lead:lead::",
  "h0:heading:첫 소제목:0",
  "h1:heading:둘째 소제목:1",
  "h2:heading:셋째 소제목:2",
])
check("세 칸이 다 들어간다", all[1], { id: "h0", target: "heading", heading: "첫 소제목", n: 0, ...img("H0") })
check("제안 없는 옛 응답", toImageSuggestions({ sections: [{ heading: "a", paragraphs: ["b"] } as never] }), [])
check("leadImage 만 빠짐", toImageSuggestions({ ...full, leadImage: undefined }).map((s) => s.id), ["h0", "h1", "h2"])
check(
  "망가진 제안은 버리고 나머지는 살린다",
  toImageSuggestions({
    leadImage: "그림 하나",
    sections: [
      { heading: "a", image: 42 },
      { heading: "b", image: { idea: "", prompt: "" } },
      { heading: "c", image: { idea: "아이디어", sources: "출처 하나", prompt: 7 } },
    ],
  }),
  [{ id: "h2", target: "heading", heading: "c", n: 2, idea: "아이디어", sources: ["출처 하나"], prompt: "" }]
)
check("출처는 3개까지", toImageSuggestions({ leadImage: { idea: "x", sources: ["1", "2", "3", "4"], prompt: "p" } })[0].sources, ["1", "2", "3"])
check("긴 소제목(1,500자)의 제안도 살린다", toImageSuggestions({ sections: [{ heading: "가".repeat(1_500), image: img("L") }] }).length, 1)
check("소제목 없는 섹션은 번호를 먹지 않는다", toImageSuggestions({ sections: [{ heading: "", image: img("X") }, { heading: "b", image: img("Y") }] })[0].n, 0)

console.log("— 저장 형식(PUT)")
check("빈 배열", ImageSuggestionsSchema.safeParse([]).success, true)
check("완료 표시", ImageSuggestionsSchema.safeParse([{ ...all[0], done: true }]).success, true)
check("거절: target 이 이상함", ImageSuggestionsSchema.safeParse([{ ...all[0], target: "footer" }]).success, false)
check("거절: id 없음", ImageSuggestionsSchema.safeParse([{ ...all[0], id: "" }]).success, false)
check("거절: 출처가 문자열", ImageSuggestionsSchema.safeParse([{ ...all[0], sources: "x" }]).success, false)
check("거절: 프롬프트가 너무 김", ImageSuggestionsSchema.safeParse([{ ...all[0], prompt: "x".repeat(4_001) }]).success, false)

console.log("— 초안 생성(가짜 Gemini)")
const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
if (!user) throw new Error("로컬 DB 에 사용자가 없다")
const tag = `verify-colimg-${Date.now()}`
const keyword = await prisma.columnKeyword.create({
  data: {
    term: tag,
    normalized: tag,
    topic: "시험",
    summary: "시험 키워드",
    sources: [{ title: "근거", url: "https://example.invalid/a", publisher: "매체", date: null }],
  },
})
let geminiReply: unknown = full
let sentPrompt = ""
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  if (!String(url).includes("generativelanguage")) return new Response("", { status: 404 })
  sentPrompt = String(init?.body ?? "")
  const text = JSON.stringify(geminiReply)
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: {} }), { status: 200 })
}) as typeof fetch

const created: string[] = []
try {
  const { draft } = await generateDraft(keyword.id, user.id)
  created.push(draft.id)
  check("프롬프트에 제안 지시가 들어간다", ["leadImage", "no text, no letters, no logos", "공공누리"].every((s) => sentPrompt.includes(s)), true)
  const saved = draft.imageSuggestions as { id: string }[]
  check("초안에 제안 4개 저장", saved.map((s) => s.id), ["lead", "h0", "h1", "h2"])
  const blocksJson = JSON.stringify(draft.blocks)
  check("본문 블록에는 제안이 없다", ["LEAD", "H0", "no logos", "공공누리"].some((s) => blocksJson.includes(s)), false)
  check("본문 블록 종류(안내 상자 · 소제목/본문 3쌍 · 참고 기사)", (draft.blocks as { type: string }[]).map((b) => b.type).join(","), "quote,heading,text,heading,text,heading,text,links")

  console.log("— 검토 요청 전 검사")
  const base = reviewProblems(draft)
  check("제안이 있어도 사진 없음 경고는 그대로", base.some((p) => p.startsWith("사진이 없습니다")), true)
  const withImage = (draft.blocks as object[]).filter((b) => (b as { type: string }).type !== "quote")
  withImage.splice(1, 0, { type: "image", src: "/x.webp", alt: "", caption: "사진 = 하드사이언스" })
  check("사진·출처 넣고 안내 상자 지우면 막힘 없음(제안은 남아 있음)", reviewProblems({ title: draft.title, blocks: withImage }), [])

  console.log("— 고치기")
  const kept = await updateDraft(draft.id, { title: "새 제목", summary: "부제", blocks: withImage as never })
  check("제안을 안 보내면(옛 편집기) 그대로 둔다", (kept.imageSuggestions as unknown[]).length, 4)
  const doneList = toImageSuggestions(full).map((s, i) => (i === 1 ? { ...s, done: true } : s))
  const marked = await updateDraft(draft.id, { title: "새 제목", summary: "부제", blocks: withImage as never, imageSuggestions: doneList })
  check("완료 표시가 저장된다", (marked.imageSuggestions as { done?: boolean }[]).map((s) => !!s.done), [false, true, false, false])
  const removed = await updateDraft(draft.id, { title: "새 제목", summary: "부제", blocks: withImage as never, imageSuggestions: doneList.slice(2) })
  check("지운 제안은 사라진다", (removed.imageSuggestions as { id: string }[]).map((s) => s.id), ["h1", "h2"])

  console.log("— 게시용 블록")
  const input = publishInput(removed)
  const inputJson = JSON.stringify(input)
  check("WebsitePost 저장 요청에 제안이 없다", ["imageSuggestions", "H1", "H2", "no logos", "공공누리"].some((s) => inputJson.includes(s)), false)
  check("저장 요청의 칸", Object.keys(input).sort(), ["category", "content", "date", "externalHref", "sourceLang", "thumbnail"])
  check("본문 근거 번호는 지워진다", input.content.ko?.blocks.find((b) => b.type === "text")?.text, "문단")

  console.log("— 옛 초안(제안 없음)")
  geminiReply = { title: "옛 제목", summary: "옛 부제", sections: [{ heading: "a", paragraphs: ["b"] }] }
  const old = await prisma.columnDraft.create({
    data: { keywordId: keyword.id, createdById: user.id, title: "옛 초안", summary: "", blocks: [{ type: "text", text: "본문" }], model: "old" },
  })
  created.push(old.id)
  check("imageSuggestions 는 null", old.imageSuggestions, null)
  const oldSaved = await updateDraft(old.id, { title: "옛 초안 고침", summary: "", blocks: [{ type: "text", text: "본문" }] })
  check("옛 편집기 형식으로 저장된다 · 여전히 null", [oldSaved.title, oldSaved.imageSuggestions], ["옛 초안 고침", null])
  const oldNew = await updateDraft(old.id, { title: "옛 초안 고침", summary: "", blocks: [{ type: "text", text: "본문" }], imageSuggestions: [] })
  check("새 편집기가 빈 배열을 보내도 저장된다", oldNew.imageSuggestions, [])
  check("옛 초안 게시 요청도 만들어진다", publishInput(oldNew).content.ko?.title, "옛 초안 고침")
  const { draft: noImg } = await generateDraft(keyword.id, user.id)
  created.push(noImg.id)
  check("모델이 제안을 안 줘도 초안은 만들어진다", [noImg.title, noImg.imageSuggestions], ["옛 제목", []])
} finally {
  await prisma.columnDraft.deleteMany({ where: { id: { in: created } } })
  await prisma.columnKeyword.delete({ where: { id: keyword.id } })
  await prisma.$disconnect()
}

console.log(fail ? `\n${fail}건 실패` : "\n전부 통과")
process.exit(fail ? 1 : 0)

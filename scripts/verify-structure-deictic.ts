// 지시어 대상 사례를 실제 구조화 프롬프트 · Claude 구독으로 돌려 본다. 예시 글만 쓰고 DB 에 닿지 않는다.
//   npx tsx scripts/verify-structure-deictic.ts [--model opus]
import { execFile } from "node:child_process"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const model = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "opus"
const m = (i: number, t: string, text: string, u = "예시대표") => ({ i, t: `01-01 ${t}`, u, m: text })

const cases = [
  {
    name: "뒷부분 — 끊긴 앞 사진이 대상, 뒤의 링크 · 혼잣말은 별건",
    session: {
      id: "c1@5", start: "2026-01-01 16:39",
      before: [m(-2, "16:29", "다른 얘기는 나중에 하죠"), m(-1, "16:36", "Photo")],
      messages: [m(0, "16:39", "요것을 행사 안내 카드에 지금 명찰 빼고 이것 넣으세요~"), m(1, "16:40", "https://www.youtube.com/watch?v=example"), m(2, "16:40", "아고 이건 또 언제 나왔지!!!")],
    },
    must: [/사진|이미지/], mustNot: [/영상|유튜브|링크/], picks: { has: [-1, 0], not: [1, 2] },
  },
  {
    name: "같은 세션 — 앞 사진이 대상",
    session: {
      id: "c2", start: "2026-01-01 10:00",
      messages: [m(0, "10:00", "Photo"), m(1, "10:01", "이것 홈페이지 배너에 넣어주세요"), m(2, "10:01", "https://example.com/news"), m(3, "10:02", "이 기사 재밌네요 ㅎㅎ")],
    },
    must: [/사진|이미지/], mustNot: [/기사|링크/], picks: { has: [0, 1], not: [2, 3] },
  },
  {
    name: "뒤 첨부가 대상 — 앞에 첨부가 없다",
    session: {
      id: "c3", start: "2026-01-01 11:00",
      messages: [m(0, "11:00", "요것 회의 전까지 인쇄해 주세요"), m(1, "11:00", "File: 예시안내문.pdf")],
    },
    must: [/인쇄|출력/], mustNot: [], picks: { has: [0, 1], not: [] },
  },
  {
    name: "회귀 — 링크를 분명히 가리키면 링크가 대상",
    session: {
      id: "c4", start: "2026-01-01 12:00",
      messages: [m(0, "12:00", "https://example.com/video"), m(1, "12:01", "이 링크 소개 페이지 맨 아래에 넣어주세요")],
    },
    must: [/링크|영상/], mustNot: [], picks: { has: [0, 1], not: [] },
  },
]

function ask(prompt: string): Promise<string> {
  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.ANTHROPIC_API_KEY
  return new Promise((resolve, reject) => {
    const child = execFile("claude", ["-p", "--model", model, "--output-format", "json", prompt], { env, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 }, (err, stdout) => {
      if (err) return reject(new Error(`claude 실패 (${err.code ?? "unknown"})`))
      resolve((JSON.parse(stdout) as { result?: string }).result ?? "")
    })
    child.stdin?.end()
  })
}

const template = readFileSync("import-tools/prompts/structure.md", "utf8")
const context = { projects: [], products: [], members: ["예시대표", "예시담당"], omnisCards: [], priorTasks: [] }
const input = { round: 1, totalRounds: 1, context, sessions: cases.map((c) => c.session) }
const text = await ask(template.replace("{{COUNT}}", String(cases.length)).replace("{{INPUT}}", JSON.stringify(input)))
const out = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { id: string; tasks: { name: string; background?: string; checklist?: string[]; messages?: number[] }[] }[]

let failed = 0
for (const c of cases) {
  const tasks = out.find((o) => o.id === c.session.id)?.tasks ?? []
  const task = tasks.find((t) => c.picks.has.every((i) => t.messages?.includes(i)))
  const words = task ? [task.name, task.background ?? "", ...(task.checklist ?? [])].join(" ") : ""
  try {
    assert.ok(task, `지시와 대상을 함께 고른 업무가 없다: ${JSON.stringify(tasks)}`)
    for (const r of c.must) assert.match(words, r)
    for (const r of c.mustNot) assert.doesNotMatch(words, r)
    for (const i of c.picks.not) assert.ok(!task.messages?.includes(i), `별건 메시지 ${i} 를 골랐다`)
    console.log(`✓ ${c.name} — ${task.name}`)
  } catch (e) {
    failed++
    console.log(`✗ ${c.name} — ${(e as Error).message.split("\n")[0]}`)
  }
}
if (failed) process.exit(1)

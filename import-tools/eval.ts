// 이식 품질 실측 — 최근 대화를 근거로 물어봤을 때 옴니스 AI 와 업무 재구성이 맥락을 잇는지.
//
//   npx tsx import-tools/eval.ts <시나리오.json> [--base http://localhost:3000] [--user 정우창] [--password ...]
//
// 시나리오 파일:
//   { "ask": [{ "q": "...", "expect": ["근거1", "근거2"] }],
//     "rebuild": [{ "task": "업무명 일부", "say": "추가 지시 문장", "expect": ["..."] }] }
//
// 결과는 사람이 읽고 판단한다 — 답변 본문·근거·업무 카드 전후를 그대로 찍는다.
// expect 는 답변에 그 문자열이 들어있는지만 센다 (거친 지표, 눈으로 확인하는 것을 대신하지 않는다).
import { readFileSync } from "fs"

interface Scenario {
  ask: { q: string; expect: string[] }[]
  rebuild: { task: string; say: string; expect: string[] }[]
}

const args = process.argv.slice(2)
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const BASE = opt("--base", "http://localhost:3000")
const USER = opt("--user", "정우창")
const PASSWORD = opt("--password", process.env.EVAL_PASSWORD ?? "hadd1234")
const file = args.find((a) => a.endsWith(".json"))
if (!file) { console.error("시나리오 JSON 을 주세요"); process.exit(1) }
const scenario = JSON.parse(readFileSync(file, "utf8")) as Scenario

let cookie = ""
async function login() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const jar = [csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")]
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar[0] },
    body: new URLSearchParams({ csrfToken, name: USER, password: PASSWORD }),
  })
  const set = res.headers.getSetCookie().map((c) => c.split(";")[0])
  cookie = [...jar, ...set].join("; ")
  if (!set.some((c) => c.includes("session-token"))) throw new Error(`로그인 실패 (${res.status}) — 비밀번호를 --password 로 주세요`)
  const me = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookie } }).then((r) => r.json()) as { user?: { name: string } }
  console.log(`로그인: ${me.user?.name} @ ${BASE}\n`)
}

const api = async (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) as Record<string, unknown> | null }))

const hits = (text: string, expect: string[]) => expect.filter((e) => text.includes(e))

async function main() {
  await login()
  const score = { askHit: 0, askTotal: 0, rebuildHit: 0, rebuildTotal: 0 }

  console.log("═══ A. 옴니스 AI 질문 ═══")
  for (const [i, c] of scenario.ask.entries()) {
    const t0 = Date.now()
    const { status, json } = await api("/api/omnis/ask", { question: c.q })
    const answer = String(json?.answer ?? json?.error ?? "")
    const sources = (json?.sources as { source: string; title: string; similarity?: number }[] | undefined) ?? []
    const got = hits(answer, c.expect)
    score.askHit += got.length; score.askTotal += c.expect.length
    console.log(`\nA${i + 1}. ${c.q}   [${status} · ${((Date.now() - t0) / 1000).toFixed(1)}s · 근거 ${got.length}/${c.expect.length}]`)
    console.log(answer.split("\n").map((l) => `   │ ${l}`).join("\n"))
    if (sources.length) console.log(`   출처: ${sources.slice(0, 6).map((s) => `${s.source}:${s.title}`).join(" · ")}`)
    const miss = c.expect.filter((e) => !got.includes(e))
    if (miss.length) console.log(`   빠짐: ${miss.join(" / ")}`)
  }

  console.log("\n═══ B. 업무 추가 지시 → 재구성 ═══")
  const taskList = await fetch(`${BASE}/api/tasks?limit=2000`, { headers: { Cookie: cookie } }).then((r) => r.json()).catch(() => null) as unknown
  const tasks = (Array.isArray(taskList) ? taskList : (taskList as { tasks?: unknown[] })?.tasks ?? []) as { id: string; name: string; slug: string; status: string }[]
  for (const [i, c] of scenario.rebuild.entries()) {
    const task = tasks.find((t) => t.name.includes(c.task))
    console.log(`\nB${i + 1}. "${c.task}" → ${task ? `#${task.slug} (${task.status})` : "업무를 못 찾음"}`)
    if (!task) continue
    const before = await fetch(`${BASE}/api/tasks/${task.id}`, { headers: { Cookie: cookie } }).then((r) => r.json()) as { checklists?: { name: string; done: boolean }[]; background?: string }
    console.log(`   전: 체크리스트 ${(before.checklists ?? []).map((x) => `[${x.done ? "x" : " "}] ${x.name}`).join(" · ")}`)
    const t0 = Date.now()
    const { status, json } = await api("/api/chat/messages", { roomId: "default-room", content: `#${task.slug} ${c.say}` })
    const upd = json?._taskUpdate as { action?: string; summary?: string } | undefined
    console.log(`   말함: ${c.say}`)
    console.log(`   응답: [${status} · ${((Date.now() - t0) / 1000).toFixed(1)}s] ${upd ? `${upd.action} — ${upd.summary}` : "taskUpdate 없음"}`)
    const after = await fetch(`${BASE}/api/tasks/${task.id}`, { headers: { Cookie: cookie } }).then((r) => r.json()) as { checklists?: { name: string; done: boolean }[]; background?: string; status?: string }
    const afterText = `${after.background ?? ""}\n${(after.checklists ?? []).map((x) => x.name).join("\n")}\n${upd?.summary ?? ""}`
    console.log(`   후: (${after.status}) 체크리스트 ${(after.checklists ?? []).map((x) => `[${x.done ? "x" : " "}] ${x.name}`).join(" · ")}`)
    if (after.background && after.background !== before.background) console.log(`   배경 바뀜: ${after.background.slice(0, 200)}`)
    const got = hits(afterText, c.expect)
    score.rebuildHit += got.length; score.rebuildTotal += c.expect.length
    const miss = c.expect.filter((e) => !got.includes(e))
    console.log(`   근거 ${got.length}/${c.expect.length}${miss.length ? ` · 빠짐: ${miss.join(" / ")}` : ""}`)
  }

  console.log(`\n═══ 합계 ═══  질문 근거 ${score.askHit}/${score.askTotal} · 재구성 근거 ${score.rebuildHit}/${score.rebuildTotal}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

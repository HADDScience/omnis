// 2단계 — 아직 분류되지 않은 세션을 Claude 로 분류한다 (세션끼리 독립이라 병렬).
//
// 결과는 final.json 에 누적된다. 처음 633세션 때는 3패스 다수결이었고, 이 CLI 는
// 1패스다 — "애매하면 업무" 규칙이 있어 놓치는 쪽보다 넘치는 쪽으로 기울고,
// 넘친 것은 구조화에서 confidence 로 걸러진다.
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import {
  DATA_DIR, ROOMS, askClaude, loadClassified, parseJsonArray, runParallel, saveClassified, pad2,
  type Classified, type RawSession,
} from "../kakao-common"

const BATCH = 30
const LABELS = new Set(["업무", "정보공유", "잡담", "빈껍데기"])

function sessionText(s: RawSession): string {
  const lines = s.msgs.map((m) => `  [${m.t}] ${m.u}: ${m.m}`)
  return `### id=${s.id} 방=${s.room} ${s.start} (${s.n}건)\n${lines.join("\n")}`
}

/** 이미 분류된 세션들이 쓴 프로젝트 이름. 새 분류가 같은 철자를 쓰게 한다. */
function projectVocab(classified: Map<string, Classified>): string {
  const count = new Map<string, number>()
  for (const c of classified.values()) if (c.project) count.set(c.project, (count.get(c.project) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([n]) => n).join(" / ") || "(아직 없음)"
}

/**
 * 분류가 필요한 세션.
 * - 처음 보는 세션
 * - 분류 뒤 메시지가 늘어난 세션 중 '업무' 가 아니었던 것 — 내보내기 시점에 잘렸다가
 *   뒤에 업무 대화가 붙었을 수 있다. 이미 업무면 다시 볼 필요가 없다(카드는 이미 있거나 생긴다).
 */
export function pendingSessions(sessions: RawSession[], classified: Map<string, Classified>): RawSession[] {
  return sessions.filter((s) => {
    if (!ROOMS[s.room]) return false
    const c = classified.get(s.id)
    if (!c) return true
    return c.label !== "업무" && c.messages != null && s.n > c.messages
  })
}

export async function classify(
  sessions: RawSession[],
  opts: { model: string; workers: number; dry: boolean },
): Promise<{ classified: number; failed: string[] }> {
  const classified = loadClassified()
  const pending = pendingSessions(sessions, classified)
  console.log(`  미분류 ${pending.length}세션 (분류됨 ${classified.size})`)
  if (pending.length === 0 || opts.dry) return { classified: 0, failed: opts.dry ? pending.map((s) => s.id) : [] }

  const template = readFileSync(`${import.meta.dirname}/../prompts/classify.md`, "utf8")
  const vocab = projectVocab(classified)
  const runId = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  const dir = `${DATA_DIR}/classify`
  mkdirSync(`${dir}/in`, { recursive: true }); mkdirSync(`${dir}/out`, { recursive: true })

  const batches: RawSession[][] = []
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH))
  console.log(`  ${batches.length}배치 × ≤${BATCH}세션 · 동시 ${opts.workers} · ${opts.model}`)

  const failed: string[] = []
  let done = 0
  await runParallel(batches, opts.workers, async (batch, i) => {
    const tag = `${runId}-${pad2(i + 1)}`
    let todo = batch
    for (let attempt = 1; attempt <= 2 && todo.length > 0; attempt++) {
      const input = todo.map(sessionText).join("\n\n")
      const prompt = template
        .replace("{{PROJECT_VOCAB}}", vocab)
        .replace("{{COUNT}}", String(todo.length))
        .replace("{{INPUT}}", input)
      writeFileSync(`${dir}/in/${tag}${attempt > 1 ? `-retry${attempt}` : ""}.md`, prompt)
      try {
        const text = await askClaude(prompt, { model: opts.model })
        writeFileSync(`${dir}/out/${tag}${attempt > 1 ? `-retry${attempt}` : ""}.json`, text)
        const rows = parseJsonArray<Classified>(text)
        const byId = new Map(rows.map((r) => [r.id, r]))
        const got: RawSession[] = []
        for (const s of todo) {
          const r = byId.get(s.id)
          if (!r || !LABELS.has(r.label)) continue
          classified.set(s.id, {
            id: s.id, label: r.label, topic: String(r.topic ?? "").slice(0, 80),
            project: r.project ? String(r.project) : null,
            actionable: r.label === "업무" && r.actionable !== false,
            messages: s.n, classifiedAt: new Date().toISOString(),
          })
          got.push(s)
        }
        todo = todo.filter((s) => !got.includes(s))
      } catch (e) {
        console.log(`\n  ⚠ 배치 ${i + 1} 시도 ${attempt}: ${(e as Error).message.split("\n")[0]}`)
      }
    }
    failed.push(...todo.map((s) => s.id))
    done++
    process.stdout.write(`\r  분류 진행 ${done}/${batches.length}배치`)
    // 배치마다 저장한다 — 중간에 끊겨도 한 배치는 살아남는다.
    saveClassified(classified)
  })
  console.log()

  const fresh = [...classified.values()].filter((c) => c.classifiedAt?.startsWith(new Date().toISOString().slice(0, 10)))
  const dist = new Map<string, number>()
  for (const c of fresh) dist.set(c.label, (dist.get(c.label) ?? 0) + 1)
  console.log(`  오늘 분류 ${fresh.length}: ${[...dist].map(([k, v]) => `${k} ${v}`).join(" · ")} · 실행가능 ${fresh.filter((c) => c.actionable).length}`)
  if (failed.length > 0) console.log(`  ⚠ 분류 실패 ${failed.length}세션 — 다음 실행에서 다시 시도한다`)
  return { classified: pending.length - failed.length, failed }
}

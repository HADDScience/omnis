// A/B 평가 한 바퀴 스모크 — run → vote 를 API 와 같은 서버 함수로 직접 부른다. 로그인 가드는 여기서만 건너뛴다.
//
//   npx tsx bench/lab-ab/smoke.ts [--pair N0-R] [--user 정우창]
//   LAB_AB_DIR=bench/results/lab-ab-smoke npx tsx bench/report-ab.ts --force
//
// 기록은 bench/results/lab-ab-smoke/ 에 쓴다 (본 평가 votes.jsonl 과 섞이지 않게). 원가는 장부에 lab-ab 로 남는다 — 실제로 나간 돈이다.
import "dotenv/config"
import type { Pair } from "./trial"

process.env.LAB_AB_DIR ??= "bench/results/lab-ab-smoke"

const args = process.argv.slice(2)
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  // LAB_AB_DIR 를 정한 뒤에 불러야 한다 — trial.ts 가 불러올 때 경로를 읽는다
  const { prisma } = await import("@/lib/db")
  const { runTrial, recordVote, pickQuestion, labStatus, LAB_DIR } = await import("./trial")
  try {
    const pair = (opt("--pair") ?? "N0-R") as Pair
    const name = opt("--user") ?? "정우창"
    const user = await prisma.user.findFirst({ where: { name: { contains: name }, isActive: true, role: "ADMIN" }, select: { id: true, name: true } })
    if (!user) throw new Error(`ADMIN 사용자 "${name}" 를 찾지 못했습니다`)
    const picked = pickQuestion(pair)
    if (!picked) throw new Error("뽑을 문항이 없습니다")
    console.log(`기록 폴더 ${LAB_DIR} · 쌍 ${pair} · 문항 ${picked.qid} (${picked.file})\nQ: ${picked.q}\n`)

    const t0 = Date.now()
    const row = await runTrial({ question: picked.q, qid: picked.qid, pair }, { userId: user.id, name: user.name, role: "ADMIN", ip: null }, (e) => {
      const at = `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6)
      if (e.type === "step") console.log(`${at}  [${e.side}] ${e.label}${e.detail ? ` · ${e.detail}` : ""}`)
      else if (e.type === "finished") console.log(`${at}  [${e.side}] 끝 — 다른 쪽 기다림`)
      else if (e.type === "result") {
        // 화면으로 나가는 것과 같은 모양 — 팔 이름이 없어야 한다
        console.log(`${at}  result 이벤트 키: ${JSON.stringify(Object.keys(e))} · A 키: ${JSON.stringify(Object.keys(e.sides.A))}`)
        for (const s of ["A", "B"] as const) console.log(`        ${s}: ${e.sides[s].sec}초 · ${e.sides[s].krw}원 · 답 ${e.sides[s].answer.length}자${e.sides[s].failed ? " · 실패" : ""}`)
      } else console.log(`${at}  ${JSON.stringify(e)}`)
    })

    const vote = recordVote({
      trialId: row.trialId, prefer: "tie",
      scores: { A: { satisfy: 3, trust: 3, worthWait: 3, agentic: 3 }, B: { satisfy: 3, trust: 3, worthWait: 3, agentic: 3 } },
      guessed: "스모크 — 짐작 메모 집계 확인용", note: "스모크",
    }, user.name)
    console.log(`\nvote 기록: ${vote.trialId} prefer=${vote.prefer}`)
    const st = labStatus()
    console.log(`현황: ${JSON.stringify(st)}`)
    try {
      recordVote({ trialId: row.trialId, prefer: "A", scores: vote.scores }, user.name)
      console.log("✗ 같은 시행 두 번째 평가가 통과했다")
      process.exitCode = 1
    } catch (err) {
      console.log(`거부 확인 (중복 평가): ${(err as Error).message}`)
    }
    try {
      recordVote({ trialId: "없는-id", prefer: "A", scores: vote.scores }, user.name)
      console.log("✗ 없는 trialId 가 통과했다")
      process.exitCode = 1
    } catch (err) {
      console.log(`거부 확인 (없는 trialId): ${(err as Error).message}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })

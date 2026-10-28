// 결과 표 — results.jsonl → summary.md · summary.csv
//
//   npx tsx bench/agent/report.ts bench/results/agent-<run> [--workdays 22] [--compare bench/results/<전부-sol 실행>]
//                                 [--ideal 싼모델,강한모델]   # 이상적 라우터 상한의 두 모델 (기본: meta 의 라우터 설정 또는 gpt-6-luna,gpt-6.1-sol)
//
// 표 넷: 모델별 요약 · 월 예산(하루 20/50/100건 × 건당 원) · 유형별 완수 · 과제별 상세.
// dry-run 결과면 끝에 "돌리기 전 비용 추산" 을 붙인다.
// 라우터 모드 행이 있으면 라우팅 분포 · 잘못 보낸 과제 · 전부-강한모델 실행(--compare)과의 비교를 더한다.
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { KRW_PER_USD } from "../config"
import { estimateMarkdown } from "./estimate"
import { KIND_LABEL, LEVEL_LABEL, type AgentRow, type TaskKind, type TaskLevel } from "./types"

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–")
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]
}

export function loadRows(dir: string): AgentRow[] {
  const f = join(dir, "results.jsonl")
  if (!existsSync(f)) return []
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentRow)
}

const writeTask = (r: AgentRow) => r.det.expectedProposals > 0 || r.kind === "clarify" || r.kind === "write" || r.kind === "knowledge"

/** 라우터 절. 판단 기준(계획서 0-b): 완수율이 비교 대상보다 떨어지지 않으면서 건당 원이 30% 이상 줄면 채택 */
function routerMarkdown(rows: AgentRow[], compareDir?: string): string[] {
  const routed = rows.filter((r) => r.router)
  if (!routed.length) return []
  const out: string[] = [``, `## 라우터`]
  for (const name of [...new Set(routed.map((r) => r.model))]) {
    const rs = routed.filter((r) => r.model === name)
    const d0 = rs[0].router!
    const cheapKey = d0.cheap
    const strongKey = d0.strong
    const toCheap = rs.filter((r) => r.router!.chosen === r.router!.cheap)
    const fb = (f: string) => rs.filter((r) => r.router!.fallback === f).length
    const jevKrw = avg(rs.map((r) => r.router!.costUsd * KRW_PER_USD))
    const confs = rs.map((r) => r.router!.confidence).filter((c): c is number => c !== null)
    out.push(
      ``, `### ${name}`, ``,
      `Jev ${d0.jevModel} (${d0.route}) · 확신도 기준 ${d0.threshold}. Jev 에는 요청 원문만 보냈다(유형 라벨·정답 없음).`, ``,
      `| 건수 | 싼 모델로 | 강한 모델로 | ↳ complex | ↳ 확신 낮음 | ↳ 형식 오류 | ↳ 호출 오류 | 확신도 평균 | Jev 건당 원 | Jev 지연 p50 |`,
      `|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`,
      `| ${rs.length} | ${toCheap.length} (${pct(toCheap.length, rs.length)}) | ${rs.length - toCheap.length} | ${rs.filter((r) => r.router!.label === "complex" && !r.router!.fallback).length} | ${fb("low_confidence")} | ${fb("malformed")} | ${fb("error")} | ${confs.length ? avg(confs).toFixed(2) : "–"} | ${jevKrw.toFixed(3)} | ${quantile(rs.map((r) => r.router!.ms), 0.5)}ms |`,
      ``, `유형별 — 싼 모델(${cheapKey})로 보낸 비율 (강한 모델 ${strongKey}):`, ``,
      `| 유형 | 싼 모델로 / 전체 | 싼 모델 완수 | 강한 모델 완수 |`, `|---|---:|---:|---:|`
    )
    for (const k of [...new Set(rs.map((r) => r.kind))] as TaskKind[]) {
      const ks = rs.filter((r) => r.kind === k)
      const kc = ks.filter((r) => toCheap.includes(r))
      const kst = ks.filter((r) => !toCheap.includes(r))
      out.push(`| ${KIND_LABEL[k]} | ${kc.length}/${ks.length} | ${pct(kc.filter((r) => r.completed).length, kc.length)} | ${pct(kst.filter((r) => r.completed).length, kst.length)} |`)
    }
    const levels = [...new Set(rs.map((r) => r.level).filter((l): l is TaskLevel => !!l))].sort()
    if (levels.length) {
      out.push(``, `등급별 — 싼 모델로 보낸 비율 (등급은 Jev 에 넘기지 않았다):`, ``, `| 등급 | 싼 모델로 / 전체 | 비율 | 싼 모델 완수 | 강한 모델 완수 |`, `|---|---:|---:|---:|---:|`)
      for (const lv of levels) {
        const ls = rs.filter((r) => r.level === lv)
        const lc = ls.filter((r) => toCheap.includes(r))
        const lst = ls.filter((r) => !toCheap.includes(r))
        out.push(`| ${LEVEL_LABEL[lv]} | ${lc.length}/${ls.length} | ${pct(lc.length, ls.length)} | ${pct(lc.filter((r) => r.completed).length, lc.length)} | ${pct(lst.filter((r) => r.completed).length, lst.length)} |`)
      }
    }
    const wrong = toCheap.filter((r) => !r.completed)
    out.push(``, `잘못 보낸 과제 (싼 모델로 보냈는데 실패) ${wrong.length}건${wrong.length ? ":" : ""}`)
    for (const r of wrong) {
      const why = [r.error, ...r.det.violations, r.det.matched.length < r.det.expectedProposals ? `제안 ${r.det.matched.length}/${r.det.expectedProposals}` : "", r.det.hits.length < r.det.minHits ? `expect ${r.det.hits.length}/${r.det.minHits}` : "", r.judge && r.judge.score === 0 ? `심판 0` : ""].filter(Boolean)
      out.push(`- ${r.taskId}#${r.rep} (${KIND_LABEL[r.kind]}, 확신 ${r.router!.confidence?.toFixed(2) ?? "-"}): ${why.join(" · ").slice(0, 200)}`)
    }

    // 전부-강한 모델 실행과 비교
    if (compareDir) {
      const base = loadRows(compareDir).filter((r) => r.model === strongKey)
      const taskIds = new Set(rs.map((r) => r.taskId))
      const baseSame = base.filter((r) => taskIds.has(r.taskId))
      if (baseSame.length) {
        const stat = (xs: AgentRow[]) => ({ n: xs.length, done: xs.filter((r) => r.completed).length / xs.length, krw: avg(xs.map((r) => r.costKrw)), p50: quantile(xs.map((r) => r.ms / 1000), 0.5) })
        const a = stat(baseSame)
        const b = stat(rs)
        const save = 1 - b.krw / a.krw
        const ok = b.done >= a.done && save >= 0.3
        out.push(
          ``, `비교 — 전부 ${strongKey} (${compareDir.split("/").pop()}, 같은 과제 ${baseSame.length}건):`, ``,
          `| | 건수 | 완수율 | 건당 원 | 지연 p50 |`, `|---|---:|---:|---:|---:|`,
          `| 전부 ${strongKey} | ${a.n} | ${Math.round(a.done * 100)}% | ${a.krw.toFixed(1)} | ${a.p50.toFixed(1)}s |`,
          `| ${name} | ${b.n} | ${Math.round(b.done * 100)}% | ${b.krw.toFixed(1)} | ${b.p50.toFixed(1)}s |`,
          `| 차이 | | ${Math.round((b.done - a.done) * 100)}%p | ${Math.round(-save * 100)}% | ${(b.p50 - a.p50 >= 0 ? "+" : "")}${(b.p50 - a.p50).toFixed(1)}s |`,
          ``, `판단 기준(완수율 유지 · 건당 원 30% 이상 절감): ${ok ? "충족" : "미충족"}${rs.some((r) => r.router!.route === "dry") ? " — dry-run 이라 의미 없음" : ""}`
        )
      } else out.push(``, `비교 대상 ${compareDir} 에 ${strongKey} 행이 없다`)
    }
  }
  return out
}

/**
 * 이상적 라우터 상한 — 같은 run 안에 싼 모델·강한 모델 결과가 둘 다 있으면, (과제, 반복)마다 통과하는 쪽 중
 * 싼 것을 골랐다고 친다. 둘 다 실패하면 강한 모델로 보냈다고 보고 그 비용·실패를 센다.
 * 실제 라우터가 다가갈 수 있는 한계다(Jev 비용 0, 미리 답을 안다고 가정).
 */
function idealRouterMarkdown(rows: AgentRow[], cheap: string, strong: string): string[] {
  const key = (r: AgentRow) => `${r.taskId}#${r.rep}`
  const c = new Map(rows.filter((r) => r.model === cheap).map((r) => [key(r), r]))
  const s = new Map(rows.filter((r) => r.model === strong).map((r) => [key(r), r]))
  const both = [...c.keys()].filter((k) => s.has(k))
  if (!both.length) return []
  const pick = both.map((k) => {
    const a = c.get(k)!, b = s.get(k)!
    if (a.completed && (!b.completed || a.costKrw <= b.costKrw)) return { row: a, used: cheap }
    if (b.completed) return { row: b, used: strong }
    return { row: b, used: strong }
  })
  const strongRows = both.map((k) => s.get(k)!)
  const done = pick.filter((p) => p.row.completed).length
  const krw = avg(pick.map((p) => p.row.costKrw))
  const sKrw = avg(strongRows.map((r) => r.costKrw))
  const out = [
    ``, `## 이상적 라우터 상한 (${cheap} / ${strong})`, ``,
    `같은 run 의 (과제, 반복) ${both.length}쌍마다 통과하는 쪽 중 싼 것을 골랐다고 친 값. 둘 다 실패하면 ${strong} 로 센다. Jev 비용은 0 으로 둔다.`, ``,
    `| | 완수율 | 건당 원 | ${cheap} 로 간 비율 |`, `|---|---:|---:|---:|`,
    `| 전부 ${strong} | ${pct(strongRows.filter((r) => r.completed).length, both.length)} | ${sKrw.toFixed(1)} | 0% |`,
    `| 이상적 라우터 | ${pct(done, both.length)} | ${krw.toFixed(1)} (${sKrw ? Math.round((1 - krw / sKrw) * 100) : 0}% 절감) | ${pct(pick.filter((p) => p.used === cheap).length, both.length)} |`,
  ]
  const levels = [...new Set(pick.map((p) => p.row.level).filter((l): l is TaskLevel => !!l))].sort()
  if (levels.length) {
    out.push(``, `| 등급 | 쌍 | 이상적 완수율 | 이상적 건당 원 | ${cheap} 로 |`, `|---|---:|---:|---:|---:|`)
    for (const lv of levels) {
      const ps = pick.filter((p) => p.row.level === lv)
      out.push(`| ${LEVEL_LABEL[lv]} | ${ps.length} | ${pct(ps.filter((p) => p.row.completed).length, ps.length)} | ${avg(ps.map((p) => p.row.costKrw)).toFixed(1)} | ${pct(ps.filter((p) => p.used === cheap).length, ps.length)} |`)
    }
  }
  return out
}

export function writeAgentReport(dir: string, opts: { workdays?: number; repeat?: number; compareDir?: string; ideal?: [string, string] } = {}): string {
  const rows = loadRows(dir)
  const workdays = opts.workdays ?? 22
  const meta = existsSync(join(dir, "meta.json")) ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) : {}
  const models = [...new Set(rows.map((r) => r.model))]
  const by = (m: string) => rows.filter((r) => r.model === m)

  const out: string[] = [
    `# 에이전트형 과제 벤치 — ${meta.runId ?? dir}`,
    ``,
    `DB ${meta.dbHost ?? "?"} · 질문자 ${meta.caller ?? "?"} · 과제 ${meta.taskFile ?? "?"} (스냅샷 ${meta.snapshotDate ?? "?"}) · 환율 ${KRW_PER_USD}원/$ · 심판 ${meta.judge ?? "끔"}${meta.dryRun ? " · **dry-run (모델 대신 고정 스크립트, 비용 0)**" : ""}`,
    ``,
    `## 모델별 요약`,
    ``,
    `완수 = 결정적 통과(expect 적중 · 기대 제안 일치 · 군더더기 제안 0 · 금지 행동 0) && 심판 1점 이상(심판을 돌렸을 때).`,
    `쓰기 정확도 = 쓰기가 걸린 과제(제안 기대 · 되묻기 · 업무/지식 유형) 중 제안이 기대와 정확히 맞고 금지 제안이 없던 비율. 정밀도 = 맞은 제안 / 받아들여진 제안.`,
    ``,
    `| 모델 | 건수 | 완수율 | 결정 통과 | 심판 평균 | 쓰기 정확도 | 제안 정밀도 | 평균 턴 | 평균 도구 | 건당 원 | 건당 원 p90 | 지연 p50 | 지연 p90 | 오류 |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`,
  ]
  const csv = ["model,n,completed,det_pass,judge_avg,write_ok,proposal_precision,avg_turns,avg_tools,krw_avg,krw_p90,ms_p50,ms_p90,errors"]
  const perModelKrw = new Map<string, number>()

  for (const m of models) {
    const rs = by(m)
    const judged = rs.filter((r) => r.judge)
    const wt = rs.filter(writeTask)
    const wOk = wt.filter((r) => r.det.matched.length === r.det.expectedProposals && r.det.extra === 0 && !r.det.violations.some((v) => v.startsWith("금지 제안") || v.startsWith("실행했다고")) && !r.judge?.badWrite)
    const acceptedProps = rs.reduce((a, r) => a + r.proposals.filter((p) => !p.rejected).length, 0)
    const matchedProps = rs.reduce((a, r) => a + r.det.matched.length, 0)
    const krws = rs.map((r) => r.costKrw)
    const secs = rs.map((r) => r.ms / 1000)
    const krwAvg = avg(krws)
    perModelKrw.set(m, krwAvg)
    const row = {
      n: rs.length,
      completed: rs.filter((r) => r.completed).length,
      det: rs.filter((r) => r.det.pass).length,
      judge: judged.length ? avg(judged.map((r) => r.judge!.score)).toFixed(2) : "–",
      turns: avg(rs.map((r) => r.turns.length)).toFixed(1),
      tools: avg(rs.map((r) => r.turns.reduce((a, t) => a + t.calls.length, 0))).toFixed(1),
      errors: rs.filter((r) => r.error).length,
    }
    out.push(
      `| ${m} | ${row.n} | ${pct(row.completed, row.n)} | ${pct(row.det, row.n)} | ${row.judge} | ${pct(wOk.length, wt.length)} | ${pct(matchedProps, acceptedProps)} | ${row.turns} | ${row.tools} | ${krwAvg.toFixed(1)} | ${quantile(krws, 0.9).toFixed(1)} | ${quantile(secs, 0.5).toFixed(1)}s | ${quantile(secs, 0.9).toFixed(1)}s | ${row.errors} |`
    )
    csv.push([m, row.n, row.completed, row.det, row.judge, wt.length ? (wOk.length / wt.length).toFixed(3) : "", acceptedProps ? (matchedProps / acceptedProps).toFixed(3) : "", row.turns, row.tools, krwAvg.toFixed(2), quantile(krws, 0.9).toFixed(2), Math.round(quantile(secs, 0.5) * 1000), Math.round(quantile(secs, 0.9) * 1000), row.errors].join(","))
  }

  // ─── 월 예산 ───
  out.push(
    ``,
    `## 월 예산 — 하루 N건 × 건당 원 × ${workdays}영업일`,
    ``,
    `건당 원은 위 표의 평균(모델 호출만. 심판 제외). 운영에서는 실패 재시도·긴 대화가 더해지므로 p90 열도 함께 본다.`,
    ``,
    `| 모델 | 건당 원 | 하루 20건 | 하루 50건 | 하루 100건 | 하루 50건 (p90 단가) |`,
    `|---|---:|---:|---:|---:|---:|`
  )
  for (const m of models) {
    const k = perModelKrw.get(m) ?? 0
    const p90 = quantile(by(m).map((r) => r.costKrw), 0.9)
    const mon = (n: number, unit: number) => `${Math.round(n * unit * workdays).toLocaleString()}원`
    out.push(`| ${m} | ${k.toFixed(1)} | ${mon(20, k)} | ${mon(50, k)} | ${mon(100, k)} | ${mon(50, p90)} |`)
  }

  // ─── 유형별 ───
  const kinds = [...new Set(rows.map((r) => r.kind))] as TaskKind[]
  out.push(``, `## 유형별 완수율`, ``, `| 유형 | ${models.join(" | ")} |`, `|---|${models.map(() => "---:").join("|")}|`)
  for (const k of kinds) {
    out.push(`| ${KIND_LABEL[k]} | ${models.map((m) => { const rs = by(m).filter((r) => r.kind === k); return `${pct(rs.filter((r) => r.completed).length, rs.length)} (${rs.length})` }).join(" | ")} |`)
  }

  // ─── 등급별 ───
  const levels = [...new Set(rows.map((r) => r.level).filter((l): l is TaskLevel => !!l))].sort()
  if (levels.length) {
    out.push(``, `## 등급별 완수율 · 건당 원`, ``, `칸: 완수율 · 건당 원 (건수)`, ``, `| 등급 | ${models.join(" | ")} |`, `|---|${models.map(() => "---:").join("|")}|`)
    for (const lv of levels) {
      out.push(`| ${LEVEL_LABEL[lv]} | ${models.map((m) => { const rs = by(m).filter((r) => r.level === lv); return rs.length ? `${pct(rs.filter((r) => r.completed).length, rs.length)} · ${avg(rs.map((r) => r.costKrw)).toFixed(1)}원 (${rs.length})` : "–" }).join(" | ")} |`)
    }
    const splits = [...new Set(rows.map((r) => r.split).filter(Boolean))]
    if (splits.length > 1) {
      out.push(``, `| 묶음 | ${models.join(" | ")} |`, `|---|${models.map(() => "---:").join("|")}|`)
      for (const sp of splits) out.push(`| ${sp} | ${models.map((m) => { const rs = by(m).filter((r) => r.split === sp); return rs.length ? `${pct(rs.filter((r) => r.completed).length, rs.length)} · ${avg(rs.map((r) => r.costKrw)).toFixed(1)}원 (${rs.length})` : "–" }).join(" | ")} |`)
    }
  }

  out.push(...idealRouterMarkdown(rows, opts.ideal?.[0] ?? meta.router?.cheap ?? "gpt-6-luna", opts.ideal?.[1] ?? meta.router?.strong ?? "gpt-6.1-sol"))

  // ─── 과제별 ───
  out.push(``, `## 과제별`, ``, `✓ 완수 · △ 결정 통과했으나 심판 0점 · ✗ 실패. 괄호: 적중/기대 · 맞은 제안/기대 제안 · 턴 · 원.`, ``)
  out.push(`| 과제 | 유형 | ${models.join(" | ")} |`, `|---|---|${models.map(() => "---").join("|")}|`)
  const taskIds = [...new Set(rows.map((r) => r.taskId))]
  for (const t of taskIds) {
    const kind = rows.find((r) => r.taskId === t)!.kind
    out.push(`| ${t} | ${KIND_LABEL[kind]} | ${models.map((m) => by(m).filter((r) => r.taskId === t).map((r) =>
      `${r.completed ? "✓" : r.det.pass ? "△" : "✗"}${r.judge ? r.judge.score : ""} (${r.det.hits.length}/${r.det.hitTotal} · ${r.det.matched.length}/${r.det.expectedProposals} · ${r.turns.length}턴 · ${r.costKrw}원)`
    ).join("<br>") || "–").join(" | ")} |`)
  }

  out.push(...routerMarkdown(rows, opts.compareDir ?? (meta.compare ? join("bench/results", meta.compare) : undefined)))

  // ─── 실패 사유 ───
  const fails = rows.filter((r) => !r.completed)
  if (fails.length) {
    out.push(``, `## 실패 사유`, ``)
    for (const r of fails) {
      const why = [r.error, ...r.det.violations, r.det.hits.length < r.det.minHits ? `expect ${r.det.hits.length}/${r.det.minHits}` : "", r.det.matched.length < r.det.expectedProposals ? `제안 ${r.det.matched.length}/${r.det.expectedProposals}` : "", r.det.extra ? `군더더기 제안 ${r.det.extra}` : "", r.judge && r.judge.score === 0 ? `심판 0: ${r.judge.reason}` : ""].filter(Boolean)
      out.push(`- ${r.model} · ${r.taskId}#${r.rep}: ${why.join(" · ")}`)
    }
  }

  // ─── 비용 · 추산 보정 ───
  const judgeUsd = rows.reduce((a, r) => a + (r.judge?.costUsd ?? 0), 0)
  const modelKrw = rows.reduce((a, r) => a + r.costKrw, 0)
  out.push(``, `## 비용`, ``, `모델 호출 합계 ${Math.round(modelKrw).toLocaleString()}원 · 심판 합계 ${Math.round(judgeUsd * KRW_PER_USD).toLocaleString()}원.`)
  const real = rows.filter((r) => !r.model.startsWith("dry-") && r.usage.input > 0)
  if (real.length) {
    out.push(``, `추산식 보정 — 실제 입력 토큰 / 추정 입력 토큰 (1 보다 크면 추산이 적게 잡은 것):`, ``)
    for (const m of models.filter((x) => !x.startsWith("dry-"))) {
      const rs = real.filter((r) => r.model === m)
      const est = rs.reduce((a, r) => a + r.turns.reduce((b, t) => b + t.estInput, 0), 0)
      const act = rs.reduce((a, r) => a + r.usage.input, 0)
      if (est) out.push(`- ${m}: ${(act / est).toFixed(2)} (실제 ${act.toLocaleString()} / 추정 ${est.toLocaleString()})`)
    }
  }
  out.push(``, `운영 기본 모델 gemini-3.6-flash(lib/ai.ts)는 config.ts 에 요금이 없어 비교하지 않았다 — 요금 미확인.`)

  if (rows.some((r) => r.model === "dry-perfect")) out.push(``, estimateMarkdown(rows, opts.repeat ?? 2))

  const md = out.join("\n") + "\n"
  writeFileSync(join(dir, "summary.md"), md)
  writeFileSync(join(dir, "summary.csv"), csv.join("\n") + "\n")
  return md
}

if (process.argv[1]?.endsWith("report.ts")) {
  const dir = process.argv[2]
  if (!dir) throw new Error("사용법: npx tsx bench/agent/report.ts bench/results/agent-<run> [--workdays 22]")
  const i = process.argv.indexOf("--workdays")
  const c = process.argv.indexOf("--compare")
  const d = process.argv.indexOf("--ideal")
  const ideal = d > 0 ? (process.argv[d + 1].split(",") as [string, string]) : undefined
  console.log(writeAgentReport(dir, { workdays: i > 0 ? Number(process.argv[i + 1]) : undefined, compareDir: c > 0 ? process.argv[c + 1] : undefined, ideal }))
}

/**
 * e2e 조각(샤드)들의 JSON 보고서를 모아 판정한다 — CI 의 `e2e` job 이 부른다(.github/workflows/ci.yml).
 *
 *   node scripts/e2e-gate.mjs <보고서 폴더> [--shards=4]
 *
 * - 마지막 시도까지 실패한 시험만 센다(재시도로 통과한 것은 flaky 로 따로 적는다)
 * - tests/e2e-known-failures.json 에 있는 실패는 「알려진 실패」 로 적고 판정에서 뺀다
 * - 그 밖의 실패가 하나라도 있거나 조각 보고서가 모자라면 exit 1
 * - 요약은 표준 출력과 $GITHUB_STEP_SUMMARY 에, 새 실패 목록은 $E2E_GATE_OUT(있으면) 에 쓴다
 *
 * 보고서 모양은 Playwright json reporter 의 것: suites[] → (suites[] | specs[]) → specs[].tests[]
 */
import fs from "node:fs"
import path from "node:path"

const knownPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "tests", "e2e-known-failures.json")
const known = JSON.parse(fs.readFileSync(knownPath, "utf8")).known

/** tests/ 기준 경로로 맞춘다 — 보고서의 file 은 testDir(tests/feature) 기준이라 앞이 다를 수 있다 */
function norm(file) {
  const f = file.replace(/\\/g, "/")
  const i = f.lastIndexOf("tests/")
  if (i >= 0) return f.slice(i + "tests/".length)
  return f.startsWith("feature/") ? f : `feature/${f}`
}

export function isKnown(t, list = known) {
  return list.some(
    (k) => k.file === t.file && (!k.project || k.project === t.project) && (!k.title || new RegExp(k.title).test(t.title)),
  )
}

function walk(suite, titles, out) {
  const here = suite.title && !suite.title.endsWith(".ts") ? [...titles, suite.title] : titles
  for (const s of suite.suites ?? []) walk(s, here, out)
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      out.push({
        file: norm(spec.file ?? suite.file ?? ""),
        line: spec.line,
        project: t.projectName,
        title: [...here, spec.title].join(" › "),
        status: t.status, // expected | unexpected | flaky | skipped
      })
    }
  }
}

export function classify(reports) {
  const tests = []
  for (const r of reports) for (const s of r.suites ?? []) walk(s, [], tests)
  const failed = tests.filter((t) => t.status === "unexpected")
  return {
    total: tests.length,
    passed: tests.filter((t) => t.status === "expected").length,
    flaky: tests.filter((t) => t.status === "flaky"),
    skipped: tests.filter((t) => t.status === "skipped").length,
    knownFailed: failed.filter((t) => isKnown(t)),
    newFailed: failed.filter((t) => !isKnown(t)),
    // 시험 밖 오류(파일을 못 읽음 · 전역 설정 실패 · 시간 상한) — 시험 목록에 안 잡히므로 따로 센다
    errors: reports.flatMap((r) => (r.errors ?? []).map((e) => String(e.message ?? e).split("\n")[0])),
  }
}

function main() {
  const args = process.argv.slice(2)
  const dir = args.find((a) => !a.startsWith("--"))
  const shards = Number(args.find((a) => a.startsWith("--shards="))?.split("=")[1] ?? 0)
  if (!dir) {
    console.error("usage: node scripts/e2e-gate.mjs <보고서 폴더> [--shards=N]")
    process.exit(2)
  }
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f))
    : []
  const reports = []
  const broken = []
  for (const f of files) {
    try {
      reports.push(JSON.parse(fs.readFileSync(f, "utf8")))
    } catch {
      broken.push(f)
    }
  }
  const r = classify(reports)
  const missing = shards > 0 ? Math.max(0, shards - reports.length) : 0
  const line = (t) => `- [${t.project}] tests/${t.file}:${t.line} › ${t.title}`

  const md = [
    `### e2e 판정`,
    ``,
    `보고서 ${reports.length}${shards ? `/${shards}` : ""}개 · 시험 ${r.total} · 통과 ${r.passed} · 건너뜀 ${r.skipped} · flaky ${r.flaky.length} · 알려진 실패 ${r.knownFailed.length} · **새 실패 ${r.newFailed.length}**`,
    ...(missing || broken.length ? [``, `**보고서가 모자란다** — 빠짐 ${missing} · 읽지 못함 ${broken.length}. 조각이 시간 초과 · 기동 실패로 끝났을 수 있다(그 job 로그를 본다)`] : []),
    ...(r.errors.length ? [``, `#### 시험 밖 오류`, ...r.errors.map((e) => `- ${e}`)] : []),
    ...(r.newFailed.length ? [``, `#### 새 실패`, ...r.newFailed.map(line)] : []),
    ...(r.knownFailed.length ? [``, `#### 알려진 실패 (tests/e2e-known-failures.json — 판정에서 뺌)`, ...r.knownFailed.map(line)] : []),
    ...(r.flaky.length ? [``, `#### flaky (재시도로 통과)`, ...r.flaky.map(line)] : []),
  ].join("\n")

  console.log(md)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n")
  const bad = r.newFailed.length > 0 || r.errors.length > 0 || missing > 0 || broken.length > 0
  if (process.env.E2E_GATE_OUT) {
    const body = [
      ...r.newFailed.map(line),
      ...r.errors.map((e) => `- 시험 밖 오류: ${e}`),
      ...(missing || broken.length ? [`- 조각 보고서 빠짐 ${missing} · 읽지 못함 ${broken.length}`] : []),
    ].join("\n")
    fs.writeFileSync(process.env.E2E_GATE_OUT, body)
  }
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main()

/**
 * 바꾼 파일에 닿는 e2e 영역만 격리 DB 에서 돌린다 (mydocs/plans/2026-10-29-e2e-guard.md).
 *
 *   pnpm run test:e2e:affected            # origin/main 과의 차이 + 커밋 안 한 변경
 *   pnpm run test:e2e:affected -- --dry   # 무엇을 돌릴지만 보여 준다
 *   pnpm run test:e2e:affected -- --base=feat/floating-nav
 *
 * 경로 → 태그 표는 이 파일 한 곳에 둔다. 표에 없는 app/ · components/ · lib/ 경로는 어디에 닿는지
 * 모르므로 전체를 돌린다 — 덜 돌려서 놓치는 쪽보다 3분 더 쓰는 쪽이 싸다.
 */
import fs from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"

const args = process.argv.slice(2).filter((a) => a !== "--")
const dry = args.includes("--dry")
const base = args.find((a) => a.startsWith("--base="))?.slice("--base=".length) ?? "origin/main"
const passthrough = args.filter((a) => a !== "--" && a !== "--dry" && !a.startsWith("--base="))

/** 모든 화면에 닿는다 — 바뀌면 전체를 돌린다 */
const EVERYWHERE = [
  /^app\/(layout\.tsx|globals\.css|page\.tsx|global-error\.tsx)$/,
  /^app\/\(main\)\/(layout\.tsx|error\.tsx)$/,
  /^components\/(layout|ui)\//,
  /^components\/theme-provider\.tsx$/,
  /^lib\/(db|auth|utils|base-path)/,
  /^prisma\//,
  /^(package\.json|pnpm-lock\.yaml|next\.config\.[jt]s|proxy\.ts|middleware\.ts|playwright\.config\.ts|tsconfig\.json)$/,
  /^tests\/feature\/_[^/]+\.ts$/,
  /^scripts\/e2e-(local|affected)\.mjs$/,
]

/** 영역 하나에 닿는다. 순서대로 처음 맞는 것을 쓴다 */
const AREAS = [
  [/^app\/\(main\)\/(tasks|dashboard)\/|^components\/tasks\/|^components\/chat\/task-|^app\/api\/(tasks|projects|products|workspace-layout|gemini-usage)\//, ["@tasks", "@mobile"]],
  [/^app\/\(main\)\/(omnis|crm|nas)\/|^components\/(omnis|crm|company)\/|^app\/api\/(omnis|crm|nas|company|context|categories|bookmarks|ip|files)\//, ["@archive"]],
  [/^app\/\(main\)\/reports\/|^app\/api\/reports\//, ["@reports"]],
  [/^app\/\(main\)\/settings\/|^components\/settings\//, ["@search", "@onboarding", "@mobile"]],
  [/^app\/\(main\)\/(chat|calendar)\/|^components\/chat\/|^app\/api\/(chat|ai|calendar)\//, ["@chat"]],
  [/^app\/\(auth\)\/|^app\/(sso)\/|^app\/api\/(auth|sso|users|account)\//, ["@auth"]],
  [/^components\/onboarding\/|^app\/api\/onboarding\//, ["@onboarding"]],
  [/^app\/api\/search\//, ["@search"]],
]

/** 화면과 무관하다 — e2e 대상이 아니다 */
const IGNORE = [/\.md$/, /^mydocs\//, /^docs\//, /^bench\//, /^\.github\//, /^public\//, /\.test\.ts$/, /^tests\/(scenario|[^/]+\.(ts|csv|md))/]

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8" }).split("\n").filter(Boolean)
}

const files = [
  ...new Set([
    ...git("diff", "--name-only", `${base}...HEAD`),
    ...git("diff", "--name-only", "HEAD"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
]

const tags = new Set()
const specs = new Set()
let everything = null
const unknown = []

for (const file of files) {
  if (IGNORE.some((r) => r.test(file))) continue
  if (EVERYWHERE.some((r) => r.test(file))) {
    everything ??= file
    continue
  }
  const spec = file.match(/^tests\/feature\/([^/]+\.spec\.ts)$/)
  if (spec) {
    specs.add(file)
    continue
  }
  const area = AREAS.find(([r]) => r.test(file))
  if (area) {
    for (const t of area[1]) tags.add(t)
    continue
  }
  if (/^(app|components|lib|hooks)\//.test(file)) unknown.push(file)
}
if (!everything && unknown.length) everything = `${unknown[0]} (영역 표에 없는 경로)`

console.log(`기준: ${base} · 바뀐 파일 ${files.length}개`)
let selection
if (everything) {
  console.log(`전체를 돌린다 — ${everything}`)
  selection = []
} else {
  // 태그를 그 태그를 단 spec 파일로 바꾼다 — 파일 목록 하나로 넘기면 태그와 바뀐 spec 을 한 번에 고를 수 있다
  for (const name of fs.readdirSync("tests/feature")) {
    if (!name.endsWith(".spec.ts")) continue
    const body = fs.readFileSync(`tests/feature/${name}`, "utf8")
    if ([...tags].some((t) => body.includes(`"${t}"`))) specs.add(`tests/feature/${name}`)
  }
  if (specs.size === 0) {
    console.log("e2e 에 닿는 변경이 없다 — 돌리지 않는다")
    process.exit(0)
  }
  console.log(`영역: ${[...tags].join(" ") || "(없음)"}`)
  selection = [...specs].sort()
}
console.log(`돌릴 것: ${selection.length ? selection.join(" ") : "tests/feature 전체"}`)

if (dry) {
  console.log("dry —", ["test:e2e:local", ...selection, ...passthrough].join(" "))
  process.exit(0)
}
const r = spawnSync("node", ["scripts/e2e-local.mjs", ...selection, ...passthrough], { stdio: "inherit" })
process.exit(r.status ?? 1)

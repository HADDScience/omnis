// kpi-export 가 실패를 삼키지 않는지.
//   npx tsx --env-file=.env scripts/verify-kpi-export.ts      (로컬 DB 를 읽기만 한다)
//
// 낡은 Prisma 클라이언트 자체를 재현하는 절차는 mydocs/working/2026-10-22-ops-metrics.md 에 있다 —
// generated/ 를 옛 스키마로 다시 만들어야 해서, 다른 세션과 같이 쓰는 체크아웃에서는 돌리지 않는다.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
export {}

const { assertKpiClient } = await import("../lib/kpi")
const { prisma } = await import("../lib/db")

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) throw new Error("로컬 DB 에서만 돈다")

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}
const thrown = (f: () => void) => {
  try {
    f()
    return null
  } catch (e) {
    return (e as Error).message
  }
}

console.log("── 클라이언트 점검 (assertKpiClient)")
check("지금 클라이언트는 통과", thrown(() => assertKpiClient()), null)
const none = thrown(() => assertKpiClient({}))
check("거부: KPI 표를 모르는 클라이언트 → 둘 다 이름을 대고 generate 를 안내", [none?.includes("kpiDaily · taskEvent"), none?.includes("prisma generate")], [true, true])
const half = thrown(() => assertKpiClient({ kpiDaily: {} }))
check("거부: 하나만 아는 클라이언트 → 빠진 것만", half?.includes("taskEvent") && !half.includes("kpiDaily"), true)

console.log("── 실제 실행 (자식 프로세스)")
const dir = mkdtempSync(join(tmpdir(), "kpi-export-"))
const run = (args: string[]) => {
  try {
    execFileSync("npx", ["tsx", "--env-file=.env", "scripts/kpi-export.ts", ...args], { stdio: "pipe" })
    return 0
  } catch (e) {
    return (e as { status: number }).status
  }
}
const out = join(dir, "kpi.json")
check("--compute 하루 → exit 0", run(["--from", "2026-10-15", "--to", "2026-10-15", "--out", out, "--compute"]), 0)
check("출력이 JSON 배열", Array.isArray(JSON.parse(readFileSync(out, "utf8"))), true)
check("저장값 모드 → exit 0", run(["--from", "2026-10-15", "--to", "2026-10-15", "--out", out]), 0)
check("거부: --out 없이 → exit ≠ 0", run(["--from", "2026-10-15"]) !== 0, true)

await prisma.$disconnect()
console.log(fail ? `\n✗ ${fail}건 실패` : "\n✓ 전부 통과")
process.exit(fail ? 1 : 0)

/**
 * 사용자의 팀(department)·직급(position)을 홈페이지 「팀 : 하드」 와 맞춘다.
 *
 * 값의 출처는 https://haddscience.com/ko/about/team 이고, 임원 세 사람(CEO·CTO / CMO / CAO)은
 * 작업지시자가 2026-09-22 에 직접 확정했다. 표기는 **임원만 영문 약칭, 나머지는 한국어 직급**이다 —
 * 사이트의 "Technical Support & Regulatory Team Leader" 를 그대로 넣으면 화면에서 넘친다.
 *
 * 화면에 이 값을 고치는 자리가 없어 스크립트로 둔다. 이름으로 잇는다 —
 * uuid 는 운영과 로컬이 같지만, 사람이 읽고 검증할 수 있는 쪽이 이름이다(migration-traps 와 같은 이유).
 *
 * 여기 없는 계정(주진호·팀장·부팀장·사원1~3·Omnis)은 건드리지 않는다.
 * StaffProfile 도 건드리지 않는다 — 거기 position 은 **본 소속**에서의 직책이고(김경훈은 EAS 대표),
 * 하드사이언스 겸직 직함은 이미 haddRole 에 CMO·CAO 로 들어 있다. 다른 칸이다.
 *
 *   npx tsx scripts/set-team-positions.ts           # 무엇이 바뀔지만 보여준다
 *   npx tsx scripts/set-team-positions.ts --apply   # 실제로 쓴다
 */
import "dotenv/config"
import { prisma } from "../lib/db"

const TEAM: { name: string; department: string; position: string }[] = [
  { name: "허채정", department: "경영진", position: "CEO · CTO" },
  { name: "김경훈", department: "영업마케팅팀", position: "CMO" },
  { name: "윤훈", department: "영업마케팅팀", position: "CAO" },
  { name: "김아리", department: "연구개발팀", position: "팀장" },
  { name: "노혜린", department: "제품개발팀", position: "팀장" },
  { name: "허찬", department: "연구지원/재무팀", position: "팀장" },
  { name: "정우창", department: "AI개발팀", position: "사원" },
  // 퇴사자. 지난 업무·보고에 이름이 남아 있어 소속을 비워 두면 그 기록이 읽히지 않는다
  { name: "박소정", department: "제품개발팀", position: "연구원" },
  { name: "주용석", department: "AI개발팀", position: "인턴" },
]

const apply = process.argv.includes("--apply")

const target = new URL(process.env.DATABASE_URL!)
console.log(`대상: ${target.hostname}${target.pathname}`)
console.log(apply ? "모드: 적용\n" : "모드: 미리보기 (--apply 를 붙이면 실제로 쓴다)\n")

try {
  const missing: string[] = []
  let changed = 0

  for (const row of TEAM) {
    const user = await prisma.user.findUnique({
      where: { name: row.name },
      select: { id: true, department: true, position: true },
    })
    if (!user) {
      missing.push(row.name)
      continue
    }

    const same = user.department === row.department && user.position === row.position
    if (same) {
      console.log(`  = ${row.name}  ${row.department} · ${row.position}`)
      continue
    }

    changed++
    console.log(
      `  ${apply ? "→" : "·"} ${row.name}  ` +
        `${user.department ?? "(없음)"} · ${user.position ?? "(없음)"}` +
        `  →  ${row.department} · ${row.position}`
    )
    if (apply) {
      await prisma.user.update({
        where: { id: user.id },
        data: { department: row.department, position: row.position },
      })
    }
  }

  // 이름이 안 맞으면 조용히 건너뛰지 않는다 — 한 사람이 빠진 채 "끝났다" 고 하면 알아챌 길이 없다
  if (missing.length) {
    throw new Error(`User 에 없는 이름: ${missing.join(", ")}`)
  }

  console.log(`\n${apply ? "적용" : "변경 예정"} ${changed}건 / 대상 ${TEAM.length}명`)
} finally {
  await prisma.$disconnect()
}

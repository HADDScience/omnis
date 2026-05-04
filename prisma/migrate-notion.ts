import "dotenv/config"
import { PrismaClient } from "../generated/prisma/client"
import * as fs from "fs"
import * as path from "path"

const prisma = new PrismaClient()

const TOOL_RESULTS_DIR = path.join(
  process.env.HOME || "",
  ".claude/projects/-Users-jeong-uchang-HADD-SCIENCE-HADD-Notion-Template/13fdfd57-d1fa-48f8-bfc5-d362259722ed/tool-results"
)

// ─── 사용자 매핑 ──────────────────────────────────────────
const USER_MAP: Record<string, string> = {}

async function ensureUsers() {
  const names = ["김아리", "노혜린", "정우창", "주용석", "박소정", "허채정", "윤훈"]
  for (const name of names) {
    let user = await prisma.user.findUnique({ where: { name } })
    if (!user) {
      user = await prisma.user.create({
        data: { name, passwordHash: "$2a$10$placeholder", role: "MEMBER" },
      })
    }
    USER_MAP[name] = user.id
  }
  console.log(`✓ 사용자 ${Object.keys(USER_MAP).length}명 매핑 완료`)
}

// ─── 상태 매핑 ────────────────────────────────────────────
function mapStatus(notionStatus: string): string {
  // Kanban 4-state (TODO/IN_PROGRESS/REVIEW/DONE). 지연·중단은 상태로 유지하지 않음.
  const map: Record<string, string> = {
    "시작 전": "TODO",
    "할 일": "TODO",
    "진행 중": "IN_PROGRESS",
    "지연 중": "IN_PROGRESS",
    "리뷰": "REVIEW",
    "완료": "DONE",
    "중단": "DONE",
  }
  return map[notionStatus] || "TODO"
}

function mapPriority(notionPriority: string): string {
  const map: Record<string, string> = {
    "★★★": "HIGH",
    "★★☆": "NORMAL",
    "★☆☆": "LOW",
    "☆☆☆": "LOW",
  }
  return map[notionPriority] || "NORMAL"
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50)
}

// ─── 노션 JSON 로드 ──────────────────────────────────────
function loadNotionData(filename: string) {
  const filepath = path.join(TOOL_RESULTS_DIR, filename)
  const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"))
  return JSON.parse(raw[0].text)
}

// ─── 프로젝트 마이그레이션 ────────────────────────────────
async function migrateProjects() {
  const data = loadNotionData("mcp-notion-API-query-data-source-1774503304114.txt")
  let count = 0

  for (const page of data.results) {
    const props = page.properties
    const name = props.Name?.title?.[0]?.plain_text || ""
    if (!name) continue

    const ownerName = props["담당자"]?.select?.name || "정우창"
    const ownerId = USER_MAP[ownerName] || USER_MAP["정우창"]
    const statusName = props["진행상태"]?.status?.name || "시작 전"
    const priorityName = props["우선순위"]?.select?.name || "★★☆"
    const startDate = props["시작일"]?.date?.start || null
    const deadline = props["데드라인"]?.date?.start || null

    const existing = await prisma.project.findFirst({ where: { notionId: page.id } })
    if (existing) continue

    await prisma.project.create({
      data: {
        name,
        status: statusName,
        priority: mapPriority(priorityName) as "LOW" | "NORMAL" | "HIGH",
        startDate: startDate ? new Date(startDate) : null,
        deadline: deadline ? new Date(deadline) : null,
        notionId: page.id,
      },
    })
    count++
  }
  console.log(`✓ 프로젝트 ${count}건 마이그레이션 완료`)
}

// ─── To Do 마이그레이션 ───────────────────────────────────
async function migrateTodos() {
  const data = loadNotionData("mcp-notion-API-query-data-source-1774503311133.txt")
  let count = 0
  const slugSet = new Set<string>()

  for (const page of data.results) {
    const props = page.properties
    const name = props.Name?.title?.[0]?.plain_text || ""
    if (!name) continue

    const existing = await prisma.task.findFirst({ where: { notionId: page.id } })
    if (existing) continue

    const ownerName = props["담당자"]?.select?.name || "정우창"
    const ownerId = USER_MAP[ownerName] || USER_MAP["정우창"]
    const statusName = props["진행상태"]?.status?.name || "시작 전"
    const priorityName = props["우선순위"]?.select?.name || ""

    // 프로젝트 연결
    const projectRels = props["프로젝트 DB"]?.relation || []
    let projectId: string | null = null
    if (projectRels.length > 0) {
      const project = await prisma.project.findFirst({
        where: { notionId: projectRels[0].id },
      })
      if (project) projectId = project.id
    }

    // 고유 slug
    let slug = slugify(name)
    if (slugSet.has(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`
    slugSet.add(slug)

    // slug 중복 체크
    const existingSlug = await prisma.task.findUnique({ where: { slug } })
    if (existingSlug) slug = `${slug}-${Date.now().toString(36)}`

    await prisma.task.create({
      data: {
        name,
        slug,
        ownerId,
        instructorId: USER_MAP["김아리"] || ownerId,
        projectId,
        status: mapStatus(statusName) as "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE",
        priority: mapPriority(priorityName) as "LOW" | "NORMAL" | "HIGH",
        notionId: page.id,
        createdAt: new Date(page.created_time),
      },
    })
    count++
  }
  console.log(`✓ To Do ${count}건 마이그레이션 완료`)
}

// ─── 체크리스트 마이그레이션 ──────────────────────────────
async function migrateChecklists() {
  const data = loadNotionData("mcp-notion-API-query-data-source-1774503314028.txt")
  let count = 0

  for (const page of data.results) {
    const props = page.properties
    const name = props["이름"]?.title?.[0]?.plain_text || ""
    if (!name) continue

    const done = props["완료여부 CL"]?.checkbox || false
    const ownerName = props["담당자"]?.select?.name || ""
    const ownerId = USER_MAP[ownerName] || null

    // To Do 연결
    const todoRels = props["To Do  DB"]?.relation || []
    let taskId: string | null = null
    if (todoRels.length > 0) {
      const task = await prisma.task.findFirst({
        where: { notionId: todoRels[0].id },
      })
      if (task) taskId = task.id
    }

    if (!taskId) continue // 연결된 업무 없으면 건너뜀

    const existing = await prisma.checklist.findFirst({
      where: { taskId, name },
    })
    if (existing) continue

    await prisma.checklist.create({
      data: {
        name,
        taskId,
        ownerId,
        done,
        createdAt: new Date(page.created_time),
      },
    })
    count++
  }
  console.log(`✓ 체크리스트 ${count}건 마이그레이션 완료`)
}

// ─── 주간보고 마이그레이션 ────────────────────────────────
async function migrateWeeklyReports() {
  const reports = [
    { id: "3291b3f9-71a1-8036-ad91-c8b382a5ac1f", title: "2026-W12 주간보고 - 박소정", owner: "박소정", isoWeek: "2026-W12", start: "2026-03-16", end: "2026-03-20", status: "제출 완료" },
    { id: "3291b3f9-71a1-81a0-a21a-c03420c6a14b", title: "2026-W12 주간보고 - 정우창", owner: "정우창", isoWeek: "2026-W12", start: "2026-03-16", end: "2026-03-20", status: "제출 완료" },
    { id: "32d1b3f9-71a1-811d-82dd-c03b25e18c0e", title: "2026-W11 주간보고 - 정우창", owner: "정우창", isoWeek: "2026-W11", start: "2026-03-09", end: "2026-03-13", status: "제출 완료" },
    { id: "67c1b3f9-71a1-82fb-adaf-0195baaf8dea", title: "2026-W10 주간보고 - 정우창", owner: "정우창", isoWeek: "2026-W10", start: "2026-03-02", end: "2026-03-06", status: "제출 완료" },
    { id: "b801b3f9-71a1-83b5-893f-81c2aed37720", title: "2026-W10 주간보고 - 박소정", owner: "박소정", isoWeek: "2026-W10", start: "2026-03-02", end: "2026-03-06", status: "제출 완료" },
  ]

  let count = 0
  for (const r of reports) {
    const ownerId = USER_MAP[r.owner]
    if (!ownerId) continue

    const existing = await prisma.weeklyReport.findFirst({
      where: { title: r.title },
    })
    if (existing) continue

    await prisma.weeklyReport.create({
      data: {
        title: r.title,
        ownerId,
        weekStart: new Date(r.start),
        weekEnd: new Date(r.end),
        isoWeek: r.isoWeek,
        status: r.status,
        content: { completed: [], inProgress: [], planned: [], notes: "", source: "notion" },
      },
    })
    count++
  }
  console.log(`✓ 주간보고 ${count}건 마이그레이션 완료`)
}

// ─── 실행 ────────────────────────────────────────────────
async function main() {
  console.log("=== 노션 → Omnis 마이그레이션 시작 ===\n")

  await ensureUsers()
  await migrateProjects()
  await migrateTodos()
  await migrateChecklists()
  await migrateWeeklyReports()

  // 카운트 출력
  const [projects, tasks, checklists, reports] = await Promise.all([
    prisma.project.count(),
    prisma.task.count(),
    prisma.checklist.count(),
    prisma.weeklyReport.count(),
  ])

  console.log(`\n=== 마이그레이션 완료 ===`)
  console.log(`프로젝트: ${projects}건`)
  console.log(`업무: ${tasks}건`)
  console.log(`체크리스트: ${checklists}건`)
  console.log(`주간보고: ${reports}건`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })

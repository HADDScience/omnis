/**
 * 인증 · 국가과제 결정 · 공고 이식 — 수집기 내보내기(export/v1) → CompanyCertification · GrantDecision(+Owner) · GrantNotice.
 *
 *   npx tsx scripts/import-grants.ts            # 건식: 새로 생길 것 · 바뀔 것 · 그대로인 것 건수만
 *   npx tsx scripts/import-grants.ts --apply    # 실제로 쓴다
 *
 * 입력은 저장소 밖 `~/work/gov-grants-data/export/v1`(GRANTS_EXPORT_DIR 로 바꿀 수 있다) 과
 * 담당자 짧은 이름 대응 `~/work/gov-grants-data/notion_people.yaml`.
 * externalKey 로 upsert 하니 다시 돌려도 행이 늘지 않는다. 담당자는 이식 때마다 원천대로 다시 맞춘다.
 */
import "dotenv/config"
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { prisma } from "@/lib/db"
import {
  noticeRow,
  type NoticeItem,
  certRow,
  decisionRow,
  matchMilestone,
  type CertItem,
  type DecisionItem,
} from "@/lib/grants-import"

const APPLY = process.argv.includes("--apply")
const DIR =
  process.env.GRANTS_EXPORT_DIR ??
  join(homedir(), "work/gov-grants-data/export/v1")

type Export<T> = { generated_at?: string; count?: number; items: T[] }
const read = <T>(f: string) =>
  JSON.parse(readFileSync(join(DIR, f), "utf8")) as Export<T>

function aliases(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const y = readFileSync(join(DIR, "../../notion_people.yaml"), "utf8")
    for (const m of y.matchAll(/^\s+(\S+):\s*(\S+)\s*$/gm)) out[m[1]] = m[2]
  } catch {}
  return out
}

async function main() {
  const certs = read<CertItem>("certifications.json")
  const decisions = read<DecisionItem>("company_decisions.json")
  const researchedAt = certs.generated_at ? new Date(certs.generated_at) : null
  const alias = aliases()

  const users = await prisma.user.findMany({ select: { id: true, name: true } })
  const userByName = new Map(users.map((u) => [u.name, u.id]))
  const milestones = await prisma.companyRecord.findMany({
    where: { kind: "MILESTONE" },
    select: { id: true, title: true },
  })

  const tally = {
    cert: { new: 0, update: 0, linked: 0 },
    decision: { new: 0, update: 0 },
    owners: 0,
    missingOwners: [] as string[],
  }
  const byStatus: Record<string, number> = {}
  const byStage: Record<string, number> = {}

  const existingCerts = new Set(
    (
      await prisma.companyCertification.findMany({
        select: { externalKey: true },
      })
    ).map((c) => c.externalKey)
  )
  for (const item of certs.items) {
    const row = certRow(item, researchedAt)
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    const recordId =
      row.status === "HELD" ? matchMilestone(item.name, milestones) : null
    if (recordId) tally.cert.linked++
    if (existingCerts.has(row.externalKey)) tally.cert.update++
    else tally.cert.new++
    if (APPLY) {
      // 사람이 화면에서 고친 상태 · 날짜 · 메모는 다시 이식해도 덮지 않는다 — 조사 칸만 새로 쓴다
      const { status, note, ...research } = row
      await prisma.companyCertification.upsert({
        where: { externalKey: row.externalKey },
        create: { ...row, recordId },
        update: { ...research, ...(recordId ? { recordId } : {}) },
      })
      void status
      void note
    }
  }

  const existingDecisions = new Set(
    (
      await prisma.grantDecision.findMany({ select: { externalKey: true } })
    ).map((d) => d.externalKey)
  )
  for (const item of decisions.items) {
    const row = decisionRow(item)
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1
    if (existingDecisions.has(row.externalKey)) tally.decision.update++
    else tally.decision.new++
    const ownerIds = (item.owners ?? []).flatMap((o) => {
      const id =
        userByName.get(o.name) ?? userByName.get(alias[o.raw ?? ""] ?? "")
      if (!id) tally.missingOwners.push(o.name)
      return id ? [{ userId: id, role: o.role ?? null }] : []
    })
    tally.owners += ownerIds.length
    if (APPLY) {
      const { stage, stageReason, ...rest } = row
      const d = await prisma.grantDecision.upsert({
        where: { externalKey: row.externalKey },
        create: row,
        // 단계는 사람이 옴니스에서 고치는 칸이라 처음 한 번만 넣는다
        update: rest,
      })
      void stage
      void stageReason
      if (!existingDecisions.has(row.externalKey)) {
        await prisma.grantDecisionOwner.createMany({
          data: ownerIds.map((o) => ({ ...o, decisionId: d.id })),
          skipDuplicates: true,
        })
      }
    }
  }

  // 공고 — 수집기가 정본이라 통째로 맞춘다. 20건씩 나눠 쓴다
  const notices = read<NoticeItem>("notices.json")
  const existingNotices = new Set(
    (await prisma.grantNotice.findMany({ select: { externalKey: true } })).map(
      (n) => n.externalKey
    )
  )
  const noticeTally = {
    new: 0,
    update: 0,
    byVerdictSole: {} as Record<string, number>,
  }
  const rows = notices.items.map(noticeRow)
  for (const r of rows) {
    if (existingNotices.has(r.externalKey)) noticeTally.update++
    else noticeTally.new++
    const v = r.verdictSole ?? "(없음)"
    noticeTally.byVerdictSole[v] = (noticeTally.byVerdictSole[v] ?? 0) + 1
  }
  if (APPLY) {
    for (let i = 0; i < rows.length; i += 20) {
      await Promise.all(
        rows
          .slice(i, i + 20)
          .map((r) =>
            prisma.grantNotice.upsert({
              where: { externalKey: r.externalKey },
              create: r,
              update: r,
            })
          )
      )
    }
  }

  const after = APPLY
    ? {
        certs: await prisma.companyCertification.count(),
        decisions: await prisma.grantDecision.count(),
        owners: await prisma.grantDecisionOwner.count(),
        notices: await prisma.grantNotice.count(),
      }
    : null
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        dir: DIR,
        input: {
          certs: certs.items.length,
          decisions: decisions.items.length,
          notices: notices.items.length,
        },
        byStatus,
        byStage,
        tally,
        notices: noticeTally,
        after,
      },
      null,
      2
    )
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

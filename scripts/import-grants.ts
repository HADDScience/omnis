/**
 * 인증 · 국가과제 결정 · 공고 이식 — 수집기 내보내기(export/v1) → CompanyCertification · GrantDecision(+Owner) · GrantNotice.
 *
 *   npx tsx scripts/import-grants.ts            # 건식: 새로 생길 것 · 바뀔 것 · 그대로인 것 건수만
 *   npx tsx scripts/import-grants.ts --apply    # 실제로 쓴다
 *
 * 입력은 저장소 밖 `~/work/gov-grants-data/export/v1`(GRANTS_EXPORT_DIR 로 바꿀 수 있다) 과
 * 담당자 짧은 이름 대응 `~/work/gov-grants-data/notion_people.yaml`.
 * externalKey 로 upsert 하니 다시 돌려도 행이 늘지 않는다. 담당자는 처음 만들 때만 넣는다.
 * 사람이 옴니스에서 고친 인증 상태 · 결정 단계 · 사유 · 메모(ActivityLog 에 남은 것)는 다시 이식해도 덮지 않는다.
 */
// 쓴 쪽 = source(이식) — prisma 보다 먼저 둔다. 공통 층 트리거가 이식을 사람(screen)으로 세지 않게(lib/import-actor.ts)
import "@/lib/import-actor-env"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { DatabaseSync } from "node:sqlite"
import { homedir } from "os"
import { join } from "path"
import { prisma } from "@/lib/db"
import { assertSourceActor } from "@/lib/import-actor"
import {
  noticeRow,
  type NoticeItem,
  certRow,
  decisionRow,
  matchMilestone,
  type CertItem,
  type DecisionItem,
} from "@/lib/grants-import"
import { confidentFolder, rankFolders } from "@/lib/grants-match"
import { TIPS_RULES_KEY, tipsRulesFrom } from "@/lib/grants-tips"
import type { Prisma } from "@/generated/prisma/client"

const APPLY = process.argv.includes("--apply")
const DIR =
  process.env.GRANTS_EXPORT_DIR ??
  join(homedir(), "work/gov-grants-data/export/v1")

type Export<T> = {
  generated_at?: string
  count?: number
  schema_revision?: number
  tips_rules?: unknown
  items: T[]
}
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

const NAS_ROOT =
  process.env.GRANTS_NAS_ROOT ??
  join(homedir(), "NAS/HADD Science/(2026) 예비 지원과제")
const NAS_PREFIX = "/HADD Science/(2026) 예비 지원과제"

/** 예비 지원과제 폴더 목록(맥 마운트에서 읽는다). 마운트가 없으면 null — 폴더 잇기는 건너뛴다 */
function nasGrantFolders(): { name: string; path: string }[] | null {
  if (!existsSync(NAS_ROOT)) return null
  const list = (dir: string, rel: string) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name.normalize("NFC"),
        path: `${NAS_PREFIX}/${rel}${e.name.normalize("NFC")}`,
      }))
  const top = list(NAS_ROOT, "")
  const drop = top.find((f) => f.name.startsWith("99."))
  const inner = drop ? list(join(NAS_ROOT, drop.name), `${drop.name}/`) : []
  return [...top.filter((f) => f !== drop), ...inner]
}

/** 첨부 크기 — 수집기 DB 의 size_hint, 없으면 받아 둔 파일 크기 */
function attachmentSizes(): Map<string, number> {
  const out = new Map<string, number>()
  const path = join(DIR, "../../gov-grants.sqlite3")
  if (!existsSync(path)) return out
  const db = new DatabaseSync(path, { readOnly: true })
  for (const r of db
    .prepare(
      "select url, size_hint, local_path from attachments where url is not null"
    )
    .all() as {
    url: string
    size_hint: number | null
    local_path: string | null
  }[]) {
    const local =
      r.local_path && existsSync(r.local_path)
        ? statSync(r.local_path).size
        : null
    const size = r.size_hint ?? local
    if (size) out.set(r.url, size)
  }
  db.close()
  return out
}

/** jsonb 는 키 순서를 바꿔 저장하니 키를 정렬해 비교한다 */
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])])
        )
      : v
const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

/** 사람이 옴니스(화면 · 도구)에서 고친 칸 — ActivityLog 의 changed 가 label 로 시작하는 행의 entityId */
async function humanEdited(
  action: string,
  label: string
): Promise<Set<string>> {
  const logs = await prisma.activityLog.findMany({
    where: { action },
    select: { entityId: true, metadata: true },
  })
  const out = new Set<string>()
  for (const l of logs) {
    const changed = (l.metadata as { changed?: unknown } | null)?.changed
    if (
      l.entityId &&
      Array.isArray(changed) &&
      changed.some((c) => typeof c === "string" && c.startsWith(label))
    )
      out.add(l.entityId)
  }
  return out
}

async function main() {
  await assertSourceActor(prisma)
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
    cert: {
      new: 0,
      update: 0,
      linked: 0,
      tipsBonus: 0,
      statusChanged: [] as string[],
      statusKept: [] as string[],
    },
    decision: {
      new: 0,
      update: 0,
      stageChanged: [] as string[],
      stageKept: [] as string[],
    },
    tipsRules: "none" as "none" | "new" | "update" | "same",
    owners: 0,
    missingOwners: [] as string[],
  }
  const byStatus: Record<string, number> = {}
  const byStage: Record<string, number> = {}

  const existingCerts = new Map(
    (
      await prisma.companyCertification.findMany({
        select: { id: true, externalKey: true, status: true },
      })
    ).map((c) => [c.externalKey, c])
  )
  const certStatusByUser = await humanEdited(
    "company.certification.updated",
    "상태"
  )
  for (const item of certs.items) {
    const row = certRow(item, researchedAt)
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    if (item.research && "tips_bonus" in item.research) tally.cert.tipsBonus++
    const recordId =
      row.status === "HELD" ? matchMilestone(item.name, milestones) : null
    if (recordId) tally.cert.linked++
    const before = existingCerts.get(row.externalKey)
    if (before) tally.cert.update++
    else tally.cert.new++
    // 상태는 원천을 따르되, 사람이 옴니스에서 고친 적 있으면 그대로 둔다
    let status: typeof row.status | undefined
    if (before && before.status !== row.status) {
      if (certStatusByUser.has(before.id))
        tally.cert.statusKept.push(
          `${row.name} (${before.status} 유지, 원천 ${row.status})`
        )
      else {
        status = row.status
        tally.cert.statusChanged.push(
          `${row.name} ${before.status}→${row.status}`
        )
      }
    }
    if (APPLY) {
      // 사람이 화면에서 고친 날짜 · 메모는 다시 이식해도 덮지 않는다 — 조사 칸만 새로 쓴다
      const { status: _s, note: _n, ...research } = row
      await prisma.companyCertification.upsert({
        where: { externalKey: row.externalKey },
        create: { ...row, recordId },
        update: {
          ...research,
          ...(status ? { status } : {}),
          ...(recordId ? { recordId } : {}),
        },
      })
      void _s
      void _n
    }
  }

  // TIPS 가점 공통 규칙(상한 · 접수 · 근거 공고) — 인증마다가 아니라 한 벌이라 AppSetting 에 둔다
  const tipsRules = tipsRulesFrom(certs.tips_rules)
  if (tipsRules) {
    const prev = await prisma.appSetting.findUnique({
      where: { key: TIPS_RULES_KEY },
    })
    tally.tipsRules = !prev
      ? "new"
      : sameJson(prev.value, tipsRules)
        ? "same"
        : "update"
    if (APPLY && tally.tipsRules !== "same") {
      const value = tipsRules as unknown as Prisma.InputJsonObject
      await prisma.appSetting.upsert({
        where: { key: TIPS_RULES_KEY },
        create: { key: TIPS_RULES_KEY, value },
        update: { value },
      })
    }
  }

  const existing = new Map(
    (
      await prisma.grantDecision.findMany({
        select: { id: true, externalKey: true, stage: true, stageReason: true },
      })
    ).map((d) => [d.externalKey, d])
  )
  const existingDecisions = new Set(existing.keys())
  const stageByUser = await humanEdited("grant.decision.updated", "단계")
  const reasonByUser = await humanEdited("grant.decision.updated", "사유")
  const noteByUser = await humanEdited("grant.decision.updated", "메모")
  for (const item of decisions.items) {
    const row = decisionRow(item)
    byStage[row.stage] = (byStage[row.stage] ?? 0) + 1
    const before = existing.get(row.externalKey)
    if (before) tally.decision.update++
    else tally.decision.new++
    // 단계 · 사유는 원천(메일로 확인한 제출 · 결과)을 따르되, 사람이 옴니스에서 고친 적 있으면 그대로 둔다
    const stagePatch: {
      stage?: typeof row.stage
      stageReason?: string | null
    } = {}
    if (before && before.stage !== row.stage) {
      if (stageByUser.has(before.id))
        tally.decision.stageKept.push(
          `${row.title} (${before.stage} 유지, 원천 ${row.stage})`
        )
      else {
        stagePatch.stage = row.stage
        tally.decision.stageChanged.push(
          `${row.title} ${before.stage}→${row.stage}`
        )
      }
    }
    if (
      before &&
      (stagePatch.stage || before.stage === row.stage) &&
      before.stageReason !== row.stageReason &&
      !reasonByUser.has(before.id)
    )
      stagePatch.stageReason = row.stageReason
    const ownerIds = (item.owners ?? []).flatMap((o) => {
      const id =
        userByName.get(o.name) ?? userByName.get(alias[o.raw ?? ""] ?? "")
      if (!id) tally.missingOwners.push(o.name)
      return id ? [{ userId: id, role: o.role ?? null }] : []
    })
    tally.owners += ownerIds.length
    if (APPLY) {
      const { stage, stageReason, note, ...rest } = row
      const d = await prisma.grantDecision.upsert({
        where: { externalKey: row.externalKey },
        create: row,
        update: {
          ...rest,
          ...stagePatch,
          ...(before && noteByUser.has(before.id) ? {} : { note }),
        },
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

  // NAS 폴더 — 「(2026) 예비 지원과제」(와 99.불참 또는 탈락 과제) 폴더를 이름 유사도로 잇는다.
  // 확실한 것만(confidentFolder) 넣고, 사람이 고른 적 있는 결정(nasFolderBy=user)과 이미 이은 결정은 건드리지 않는다
  const folders = nasGrantFolders()
  const folderTally = {
    mounted: folders !== null,
    folders: folders?.length ?? 0,
    auto: 0,
    kept: 0,
    unsure: 0,
  }
  if (folders) {
    const rows = await prisma.grantDecision.findMany({
      select: {
        id: true,
        externalKey: true,
        title: true,
        noticeLinks: true,
        nasFolder: true,
        nasFolderBy: true,
      },
    })
    const byKey = new Map(rows.map((r) => [r.externalKey, r]))
    for (const item of decisions.items) {
      const r = byKey.get(item.key)
      if (r && (r.nasFolder || r.nasFolderBy === "user")) {
        folderTally.kept++
        continue
      }
      const pick = confidentFolder(
        rankFolders(
          item.title,
          folders,
          (item.notice_links ?? []).map(
            (l) => (l as { title?: string }).title ?? ""
          )
        )
      )
      if (!pick) {
        folderTally.unsure++
        continue
      }
      folderTally.auto++
      if (APPLY && r)
        await prisma.grantDecision.update({
          where: { id: r.id },
          data: { nasFolder: pick.path, nasFolderBy: "auto" },
        })
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
  const sizes = attachmentSizes()
  const rows = notices.items.map((n) => noticeRow(n, sizes))
  for (const r of rows) {
    if (existingNotices.has(r.externalKey)) noticeTally.update++
    else noticeTally.new++
    const v = r.verdictSole ?? "(없음)"
    noticeTally.byVerdictSole[v] = (noticeTally.byVerdictSole[v] ?? 0) + 1
  }
  if (APPLY) {
    for (let i = 0; i < rows.length; i += 20) {
      await Promise.all(
        rows.slice(i, i + 20).map((r) =>
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
        notices: {
          ...noticeTally,
          withAttachments: rows.filter((r) => r.attachments).length,
          sizesKnown: sizes.size,
        },
        nasFolders: folderTally,
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

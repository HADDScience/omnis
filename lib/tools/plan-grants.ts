// 인증 · 국가과제 도구 실행(defs-grants.ts) — 화면 API 와 같은 서버 함수(lib/grants.ts)를 부른다.
import { prisma } from "@/lib/db"
import { normalizeNasPath } from "@/lib/nas"
import type { Caller } from "@/lib/omnis-mcp"
import {
  createDecisionFromNotice,
  decidedNoticeKeys,
  decisionsForNotices,
  isImportedDecision,
  removeGrantDecision,
  updateCertification,
  updateGrantDecision,
} from "@/lib/grants"
import type { NoticeAttachment } from "@/lib/grants-import"
import {
  CERT_STATUS_LABEL,
  GRANT_STAGE_LABEL,
  REGION_GROUPS,
  seoulYmd,
} from "@/lib/grants-labels"
import {
  NOTICE_ORDER,
  noticeWhere,
  readNoticeFilter,
  readStage,
} from "@/lib/grants-query"
import type { CertStatus, GrantStage } from "@/generated/prisma/client"
import { blocked, clip, has, str, type Planner } from "./planned"
import type { GrantReadName, GrantWriteName } from "./defs-grants"

const DAY = 86_400_000

const kb = (n: number | null) =>
  n === null
    ? null
    : n >= 1_048_576
      ? `${(n / 1_048_576).toFixed(1)}MB`
      : `${Math.max(1, Math.round(n / 1024))}KB`

/** 첨부 한 줄 — 이름 · 형식 · 크기 · 받는 곳(기업마당은 새 토큰이 필요해 공고 페이지) */
function attachmentText(a: NoticeAttachment): string {
  const meta = [a.type, kb(a.size)].filter(Boolean).join(" · ")
  return `${a.name}${meta ? ` (${meta})` : ""} — ${a.page ?? a.url}`
}

function attachmentsOf(
  links: { export_key?: string }[],
  byKey: Map<string, NoticeAttachment[]>
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of links) {
    for (const a of (l.export_key && byKey.get(l.export_key)) || []) {
      if (seen.has(a.name)) continue
      seen.add(a.name)
      out.push(attachmentText(a))
    }
  }
  return out.slice(0, 8)
}

export async function runGrantRead(
  name: GrantReadName,
  args: Record<string, unknown>
): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "list_grant_decisions": {
      const stage = readStage(args.stage)
      const q = str(args.query)
      const owner = str(args.owner)
      const days = Number(args.due_within_days)
      const now = new Date()
      const rows = await prisma.grantDecision.findMany({
        where: {
          ...(stage ? { stage } : {}),
          ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
          ...(owner ? { owners: { some: { user: { name: owner } } } } : {}),
          ...(Number.isInteger(days) && days > 0
            ? {
                deadline: {
                  gte: now,
                  lt: new Date(now.getTime() + days * DAY),
                },
              }
            : {}),
        },
        orderBy: [
          { stage: "asc" },
          { deadline: { sort: "asc", nulls: "last" } },
          { title: "asc" },
        ],
        include: {
          owners: { include: { user: { select: { name: true } } } },
          task: { select: { slug: true, name: true } },
          project: { select: { name: true } },
        },
      })
      if (!rows.length) return { text: "조건에 맞는 과제 결정이 없습니다." }
      // 같은 사업 · 다른 회차로 이어진 공고의 첨부를 결정 아래에 같이 보인다
      const linkKeys = rows.flatMap((r) =>
        (
          (Array.isArray(r.noticeLinks) ? r.noticeLinks : []) as {
            relation?: string
            export_key?: string
          }[]
        )
          .filter((l) => l.relation !== "related" && l.export_key)
          .map((l) => l.export_key!)
      )
      const noticeByKey = new Map(
        (
          await prisma.grantNotice.findMany({
            where: {
              externalKey: {
                in: [
                  ...new Set([...linkKeys, ...rows.map((r) => r.externalKey)]),
                ],
              },
            },
            select: { externalKey: true, attachments: true },
          })
        ).map((n) => [
          n.externalKey,
          (Array.isArray(n.attachments)
            ? n.attachments
            : []) as unknown as NoticeAttachment[],
        ])
      )
      const out = [`국가과제 결정 ${rows.length}건`]
      for (const s of Object.keys(GRANT_STAGE_LABEL) as GrantStage[]) {
        const list = rows.filter((r) => r.stage === s)
        if (!list.length) continue
        out.push("", `# ${GRANT_STAGE_LABEL[s]} ${list.length}`)
        for (const r of list) {
          const links = (Array.isArray(r.noticeLinks) ? r.noticeLinks : []) as {
            relation?: string
            title?: string
            date?: string | null
            export_key?: string
          }[]
          out.push(
            `- ${r.title}` +
              `${r.deadline ? ` · 마감 ${seoulYmd(r.deadline)}` : ""}` +
              `${r.owners.length ? ` · 담당 ${r.owners.map((o) => o.user.name).join("·")}` : ""}` +
              `${r.stageReason ? ` · ${r.stageReason}` : ""}` +
              `${r.task ? ` · 업무 #${r.task.slug}` : ""}${r.project ? ` · 프로젝트 ${r.project.name}` : ""}` +
              ` · id ${r.id}`
          )
          if (r.note) out.push(`  - 메모: ${clip(r.note, 200)}`)
          if (r.nasFolder)
            out.push(`  - NAS 폴더: ${r.nasFolder} (안의 파일은 browse_nas)`)
          for (const a of attachmentsOf(
            [
              { export_key: r.externalKey },
              ...links.filter((l) => l.relation !== "related"),
            ],
            noticeByKey
          ))
            out.push(`  - 공고 첨부: ${a}`)
          for (const l of links.slice(0, 3))
            out.push(
              `  - 공고(${l.relation ?? "연결"}): ${l.title ?? ""}${l.date ? ` · ${l.date}` : ""}`
            )
        }
      }
      return { text: out.join("\n") }
    }
    case "search_grant_notices": {
      const f = readNoticeFilter(args)
      const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100)
      const where = noticeWhere(f)
      const [total, rows] = await Promise.all([
        prisma.grantNotice.count({ where }),
        prisma.grantNotice.findMany({
          where,
          orderBy: NOTICE_ORDER,
          take: limit,
        }),
      ])
      if (!rows.length) return { text: "조건에 맞는 공고가 없습니다." }
      const decided = await decisionsForNotices(rows.map((r) => r.externalKey))
      const verdictOf = (r: (typeof rows)[number]) =>
        f.profile === "corp" ? r.verdictCorp : r.verdictSole
      const reasonsOf = (r: (typeof rows)[number]) =>
        ((f.profile === "corp" ? r.reasonsCorp : r.reasonsSole) ?? []) as {
          claim?: string
        }[]
      const out = [
        `공고 ${total}건 중 ${rows.length}건 — 판정 ${f.verdicts.join("·")}(${f.profile === "corp" ? "법인" : "지금 사업자"} 기준)` +
          `${f.region ? ` · ${REGION_GROUPS[f.region].label}` : ""} · 마감 가까운 순`,
      ]
      for (const r of rows) {
        out.push(
          `- [${verdictOf(r) ?? "불명"}] ${r.title}` +
            `${r.agency || r.ministry ? ` · ${[r.ministry, r.agency].filter(Boolean).join(" / ")}` : ""}` +
            ` · 마감 ${r.deadlineAt ? seoulYmd(r.deadlineAt) : (r.deadlineRaw ?? "미정")}` +
            `${r.regionDetail.length ? ` · ${r.regionDetail.join("·")}` : ""}` +
            `${decided.has(r.externalKey) ? ` · 우리 결정에 있음(${decided.get(r.externalKey)!.title})` : ""}` +
            ` · id ${r.id}`
        )
        const why = reasonsOf(r)[0]?.claim
        if (why) out.push(`  - 판정 근거: ${clip(why, 160)}`)
        if (r.url) out.push(`  - ${r.url}`)
        for (const a of (
          (Array.isArray(r.attachments)
            ? r.attachments
            : []) as unknown as NoticeAttachment[]
        ).slice(0, 6))
          out.push(`  - 첨부: ${attachmentText(a)}`)
        const folder = decided.get(r.externalKey)?.nasFolder
        if (folder) out.push(`  - NAS 폴더: ${folder} (안의 파일은 browse_nas)`)
      }
      return { text: out.join("\n") }
    }
  }
}

// ─── 찾기 도우미 ───

async function findCert(ref: string) {
  if (!ref) return null
  const byId = await prisma.companyCertification.findUnique({
    where: { id: ref },
  })
  if (byId) return byId
  const list = await prisma.companyCertification.findMany({
    where: { name: { contains: ref, mode: "insensitive" } },
    take: 3,
  })
  return list.length === 1
    ? list[0]
    : list.length > 1
      ? ("many" as const)
      : null
}

async function findDecision(ref: string) {
  if (!ref) return null
  const inc = {
    owners: { include: { user: { select: { id: true, name: true } } } },
  } as const
  const byId = await prisma.grantDecision.findUnique({
    where: { id: ref },
    include: inc,
  })
  if (byId) return byId
  const list = await prisma.grantDecision.findMany({
    where: { title: { contains: ref, mode: "insensitive" } },
    include: inc,
    take: 3,
  })
  return list.length === 1
    ? list[0]
    : list.length > 1
      ? ("many" as const)
      : null
}

const ymdArg = (args: Record<string, unknown>, k: string) =>
  has(args, k) ? str(args[k]) : undefined

const planUpdateCert: Planner = async (args, caller: Caller) => {
  const T = "인증 고치기"
  const c = await findCert(str(args.certification))
  if (c === "many")
    return blocked(
      T,
      str(args.certification),
      "이름이 여러 인증에 맞습니다 — list_certifications 의 이름을 그대로 주세요"
    )
  if (!c)
    return blocked(
      T,
      str(args.certification),
      "없는 인증입니다 — list_certifications 로 확인하세요"
    )
  const patch = {
    status: has(args, "status") ? str(args.status) : undefined,
    note: has(args, "note") ? str(args.note) : undefined,
    acquiredOn: ymdArg(args, "acquired_on"),
    validUntil: ymdArg(args, "valid_until"),
  }
  const changes = [
    patch.status !== undefined && patch.status !== c.status
      ? {
          label: "상태",
          before: CERT_STATUS_LABEL[c.status],
          after: CERT_STATUS_LABEL[patch.status as CertStatus] ?? patch.status,
        }
      : null,
    patch.note !== undefined && (patch.note || null) !== c.note
      ? {
          label: "메모",
          before: c.note ?? "(없음)",
          after: patch.note || "(지움)",
        }
      : null,
    patch.acquiredOn !== undefined &&
    (patch.acquiredOn || null) !== seoulYmd(c.acquiredOn)
      ? {
          label: "취득일",
          before: seoulYmd(c.acquiredOn) ?? "(없음)",
          after: patch.acquiredOn || "(지움)",
        }
      : null,
    patch.validUntil !== undefined &&
    (patch.validUntil || null) !== seoulYmd(c.validUntil)
      ? {
          label: "유효기간",
          before: seoulYmd(c.validUntil) ?? "(없음)",
          after: patch.validUntil || "(지움)",
        }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)
  return {
    title: T,
    target: c.name,
    changes,
    risk: "회사 정보 › 인증·가점 화면과 지원서 가점 판단에 쓰입니다. 활동 기록에 남습니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 칸이 없습니다" } : {}),
    run: async () => {
      const r = await updateCertification(caller.userId, c.id, patch)
      return r.ok
        ? { ok: true, text: `고쳤습니다: ${c.name}`, id: c.id }
        : { ok: false, error: r.error }
    },
  }
}

const planUpdateDecision: Planner = async (args, caller: Caller) => {
  const T = "국가과제 결정 고치기"
  const d = await findDecision(str(args.decision))
  if (d === "many")
    return blocked(
      T,
      str(args.decision),
      "과제명이 여러 줄에 맞습니다 — list_grant_decisions 의 id 를 주세요"
    )
  if (!d)
    return blocked(
      T,
      str(args.decision),
      "없는 과제 결정입니다 — list_grant_decisions 로 확인하세요"
    )

  const changes: { label: string; before: string; after: string }[] = []
  const patch: Parameters<typeof updateGrantDecision>[2] = {}
  if (has(args, "stage")) {
    const s = readStage(args.stage)
    if (!s)
      return blocked(
        T,
        d.title,
        "단계는 REVIEW · PREPARING · SUBMITTED · SELECTED · REJECTED · DROPPED 중 하나입니다"
      )
    if (s !== d.stage)
      changes.push({
        label: "단계",
        before: GRANT_STAGE_LABEL[d.stage],
        after: GRANT_STAGE_LABEL[s],
      })
    patch.stage = s
  }
  for (const [arg, key, label] of [
    ["stage_reason", "stageReason", "사유"],
    ["note", "note", "메모"],
  ] as const) {
    if (!has(args, arg)) continue
    const v = str(args[arg])
    if ((v || null) !== d[key])
      changes.push({ label, before: d[key] ?? "(없음)", after: v || "(지움)" })
    patch[key] = v
  }
  if (has(args, "deadline")) {
    const v = str(args.deadline)
    if ((v || null) !== seoulYmd(d.deadline))
      changes.push({
        label: "마감",
        before: seoulYmd(d.deadline) ?? "(없음)",
        after: v || "(지움)",
      })
    patch.deadline = v
  }
  if (has(args, "owners")) {
    const names = Array.isArray(args.owners)
      ? (args.owners as unknown[])
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    const users = await prisma.user.findMany({
      where: { name: { in: names }, isActive: true },
      select: { id: true, name: true },
    })
    const missing = names.filter((n) => !users.some((u) => u.name === n))
    if (missing.length)
      return blocked(
        T,
        d.title,
        `재직 구성원이 아닌 이름: ${missing.join(", ")} — list_members 의 정식 이름을 씁니다`
      )
    changes.push({
      label: "담당",
      before: d.owners.map((o) => o.user.name).join("·") || "(없음)",
      after: names.join("·") || "(없음)",
    })
    patch.ownerIds = users.map((u) => u.id)
  }
  if (has(args, "task")) {
    const ref = str(args.task).replace(/^#/, "")
    const t = ref
      ? await prisma.task.findFirst({
          where: { OR: [{ id: ref }, { slug: ref }] },
          select: { id: true, slug: true },
        })
      : null
    if (ref && !t)
      return blocked(
        T,
        d.title,
        "없는 업무입니다 — list_tasks 의 슬러그를 씁니다"
      )
    changes.push({
      label: "신청 업무",
      before: d.taskId ? "연결됨" : "(없음)",
      after: t ? `#${t.slug}` : "(연결 해제)",
    })
    patch.taskId = t?.id ?? ""
  }
  if (has(args, "nas_folder")) {
    const raw = str(args.nas_folder)
    const folder = raw ? normalizeNasPath(raw) : null
    if (raw && !folder)
      return blocked(
        T,
        d.title,
        "HADD Science 공유폴더 안의 경로만 잇습니다 — browse_nas 로 찾은 경로를 씁니다"
      )
    if (folder !== d.nasFolder)
      changes.push({
        label: "NAS 폴더",
        before: d.nasFolder ?? "(없음)",
        after: folder ?? "(연결 해제)",
      })
    patch.nasFolder = folder ?? ""
  }
  if (has(args, "project")) {
    const ref = str(args.project)
    const p = ref
      ? await prisma.project.findFirst({
          where: { OR: [{ id: ref }, { name: ref }] },
          select: { id: true, name: true },
        })
      : null
    if (ref && !p)
      return blocked(
        T,
        d.title,
        "없는 프로젝트입니다 — list_projects 로 확인하세요"
      )
    changes.push({
      label: "과제 프로젝트",
      before: d.projectId ? "연결됨" : "(없음)",
      after: p ? p.name : "(연결 해제)",
    })
    patch.projectId = p?.id ?? ""
  }
  return {
    title: T,
    target: d.title,
    changes,
    risk: "아카이브 › 국가과제 화면에 바로 보입니다. 활동 기록에 남습니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 칸이 없습니다" } : {}),
    run: async () => {
      const r = await updateGrantDecision(caller.userId, d.id, patch)
      return r.ok
        ? { ok: true, text: `고쳤습니다: ${d.title}`, id: d.id }
        : { ok: false, error: r.error }
    },
  }
}

const planAddDecision: Planner = async (args, caller: Caller) => {
  const T = "국가과제 결정에 올리기"
  const ref = str(args.notice)
  const n = ref
    ? await prisma.grantNotice.findFirst({
        where: { OR: [{ id: ref }, { externalKey: ref }] },
      })
    : null
  if (!n)
    return blocked(
      T,
      ref,
      "없는 공고입니다 — search_grant_notices 의 id 를 씁니다"
    )
  const already = await decidedNoticeKeys([n.externalKey])
  if (already.size)
    return blocked(
      T,
      n.title,
      "이미 「우리 결정」 에 있습니다 — list_grant_decisions 로 확인하세요"
    )
  return {
    title: T,
    target: n.title,
    changes: [
      { label: "단계", before: null, after: "검토" },
      { label: "담당", before: null, after: caller.name },
      {
        label: "마감",
        before: null,
        after: seoulYmd(n.deadlineAt) ?? n.deadlineRaw ?? "미정",
      },
    ],
    risk: "아카이브 › 국가과제 › 우리 결정에 새 줄이 생깁니다. 활동 기록에 남습니다.",
    run: async () => {
      const r = await createDecisionFromNotice(caller.userId, n.id)
      return r.ok
        ? { ok: true, text: `올렸습니다: ${n.title}`, id: r.value.id }
        : { ok: false, error: r.error }
    },
  }
}

const planRemoveDecision: Planner = async (args, caller: Caller) => {
  const T = "국가과제 결정 내리기"
  const d = await findDecision(str(args.decision))
  if (d === "many")
    return blocked(
      T,
      str(args.decision),
      "과제명이 여러 줄에 맞습니다 — list_grant_decisions 의 id 를 주세요"
    )
  if (!d)
    return blocked(
      T,
      str(args.decision),
      "없는 과제 결정입니다 — list_grant_decisions 로 확인하세요"
    )
  if (isImportedDecision(d))
    return blocked(
      T,
      d.title,
      "노션에서 옮겨 온 과제라 내리지 않습니다 — update_grant_decision 으로 stage 를 DROPPED(불참)로 바꿉니다"
    )
  return {
    title: T,
    target: d.title,
    changes: [
      { label: "우리 결정", before: GRANT_STAGE_LABEL[d.stage], after: "내림" },
      {
        label: "담당",
        before: d.owners.map((o) => o.user.name).join("·") || "(없음)",
        after: "(함께 빠짐)",
      },
    ],
    risk: "되돌릴 수 없습니다. 과제 후보에서는 다시 「올리기」 로 보입니다. 활동 기록에 남습니다.",
    run: async () => {
      const r = await removeGrantDecision(caller.userId, d.id)
      return r.ok
        ? { ok: true, text: `내렸습니다: ${d.title}`, id: d.id }
        : { ok: false, error: r.error }
    },
  }
}

export const GRANT_PLANNERS: Record<GrantWriteName, Planner> = {
  update_certification: planUpdateCert,
  update_grant_decision: planUpdateDecision,
  add_grant_decision: planAddDecision,
  remove_grant_decision: planRemoveDecision,
}

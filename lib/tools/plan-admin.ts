// 묶음 4(#248) 실행 — 회사 정보 · 연도별 재무 · 캘린더 공개 범위 · AI 비용 상한 · 기능 요청 · 설문 합계. 정의는 lib/tools/defs-admin.ts.
// 화면이 관리자만 여는 일은 여기서도 관리자만(caller.role) — 화면과 같은 권한. 쓰기는 화면 API 와 같은 서버 함수를 부른다.
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import { writeActivity } from "@/lib/api"
import { createCompanyYear, deleteCompanyYear, saveCompanyProfile, setCalendarAudience, updateCompanyYear, YEAR_FIELD_LABEL } from "@/lib/company-ops"
import { PROFILE_FIELD_LABEL, YEAR_MONEY_FIELDS } from "@/lib/schemas/company"
import { BASIS_LABEL } from "@/lib/company-context"
import { loadBudget, saveBudget } from "@/lib/ai-budget"
import { configuredRecipientIds, saveRecipientIds } from "@/lib/notify-recipients"
import { SaveBudgetSchema } from "@/lib/schemas/ai-budget"
import { FEATURE_STATUS_LABEL, changeFeatureStatus, featureForReply, isFeatureStatus, listFeatureRequests, parseDoneNotice, submitFeatureRequest } from "@/lib/feature-requests"
import { feedbackReply, feedbackRequest } from "@/lib/feedback"
import { canSeeSurveyResults, loadSurveyResults } from "@/lib/ai-survey/results"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { applicationCounts, listApplications } from "@/lib/hr/queries"
import { changeApplicationStage, isPickableStage } from "@/lib/hr/stage"
import { BUNDLE_STAGES, canPack } from "@/lib/hr/stage-label"
import { loadJobs } from "@/lib/hr/jobs"
import { STAGE_LABEL, interestLabel, type Stage } from "@/lib/hr/rules"
import { JOB_SLUG, loadJobMeta, loadJobMetas, updateJobMeta } from "@/lib/hr/job-meta-server"
import { metaLines, modeLabel, parseSlotText, slotLabel } from "@/lib/hr/job-meta"
import type { InterviewSlot } from "@/lib/schemas/hr-job"
import { blocked, clip, has, kstDate, str, type Planner } from "./planned"
import type { AdminReadName, AdminWriteName } from "./defs-admin"

const ADMIN_ONLY = "관리자만 할 수 있습니다 — 화면에서도 관리자에게만 열린 일입니다."
const isAdmin = (c: Caller) => c.role === "ADMIN"
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`

/** snake_case 도구 칸 → 화면 스키마 칸 */
const PROFILE_KEYS: Record<string, string> = {
  name_ko: "nameKo", name_en: "nameEn", biz_reg_no: "bizRegNo", biz_type: "bizType", corp_reg_no: "corpRegNo",
  industry: "industry", industry_code: "industryCode", founded_on: "foundedOn", homepage: "homepage",
  hq_address: "hqAddress", lab_address: "labAddress", partner_address: "partnerAddress", as_of_date: "asOfDate",
}
const YEAR_KEYS: Record<string, string> = {
  revenue_krw: "revenueKrw", revenue_product_krw: "revenueProductKrw", revenue_service_krw: "revenueServiceKrw",
  cost_of_sales_krw: "costOfSalesKrw", net_income_krw: "netIncomeKrw", assets_krw: "assetsKrw", liabilities_krw: "liabilitiesKrw",
  equity_krw: "equityKrw", headcount: "headcount", account_label: "accountLabel", note: "note", as_of_date: "asOfDate",
}

/** DB 값 → 화면 폼 값(글) — 날짜는 YYYY-MM-DD, 돈 · 수는 숫자 글, 없으면 "" */
function formValue(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return kstDate(v)
  return String(v)
}

// ─── 읽기 ───

export async function runAdminRead(name: AdminReadName, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "ai_budget": {
      if (!isAdmin(caller)) return { error: ADMIN_ONLY }
      const [b, recipients] = await Promise.all([loadBudget(), configuredRecipientIds()])
      const ids = [...Object.keys(b.users), ...recipients]
      const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
      return {
        text: [
          `사람마다 하루 ${won(b.userDailyKrw)} · 회사 월 ${won(b.monthlyKrw)}`,
          Object.keys(b.users).length ? `사람별 예외: ${Object.entries(b.users).map(([id, k]) => `${names.get(id) ?? id} ${won(k)}`).join(", ")}` : "사람별 예외 없음",
          `알림 받는 사람: ${recipients.length ? recipients.map((id) => names.get(id) ?? id).join(", ") : "(지정 없음 — 알림 이메일과 같은 계정)"}`,
        ].join("\n"),
      }
    }
    case "list_feature_requests": {
      if (!isAdmin(caller)) return { error: ADMIN_ONLY }
      const st = str(args.status).toUpperCase() || "ALL"
      const rows = (await listFeatureRequests()).filter((r) => st === "ALL" || r.status === st)
      if (rows.length === 0) return { text: "기능 요청이 없습니다." }
      return {
        text: [
          `기능 요청 ${rows.length}건 — 상태는 set_feature_status(request)`,
          ...rows.slice(0, 60).map((r) => `- request=${r.id} · ${FEATURE_STATUS_LABEL[r.status]} · ${r.title} · ${r.count}명 · ${kstDate(r.updatedAt)}${r.entries[0] ? ` · 최근: ${r.entries[0].requester.name} — ${clip(r.entries[0].detail.replace(/\s+/g, " "), 120)}` : ""}`),
        ].join("\n"),
      }
    }
    case "ai_survey_results": {
      if (!canSeeSurveyResults(caller.role)) return { error: ADMIN_ONLY }
      const r = await loadSurveyResults()
      return { text: `AI 활용 설문 합계(이름 · 사람별 원문 없음)\n${JSON.stringify({ summary: r.summary, latency: r.latency, sources: r.sources, cost: r.cost }, null, 1)}` }
    }
    case "list_applications": {
      // 화면과 같은 권한 — 채용 담당만. 연락처 · 동기 · 파일은 싣지 않는다(결정 D8)
      if (!(await isHrReviewer(caller.userId))) return { error: "채용 담당만 볼 수 있습니다 — 관리자 › 운영 › 채용 담당에 든 사람에게만 열린 일입니다." }
      const stageArg = str(args.stage).toUpperCase()
      const stage = stageArg && stageArg !== "RECEIVING" && stageArg in STAGE_LABEL ? (stageArg as Stage) : undefined
      const job = str(args.job) || undefined
      const [counts, rows, jobs] = await Promise.all([applicationCounts(), listApplications({ jobSlug: job, stage, take: 100 }), loadJobs()])
      const closes = new Map(jobs.map((j) => [j.slug, j.closesAt]))
      const metas = await loadJobMetas([...new Set(counts.map((c) => c.jobSlug))])
      if (rows.length === 0 && counts.length === 0) return { text: "접수된 지원서가 없습니다." }
      const byJob = new Map<string, { title: string; parts: string[] }>()
      for (const c of counts) {
        const j = byJob.get(c.jobSlug) ?? { title: c.jobTitle, parts: [] }
        j.parts.push(`${STAGE_LABEL[c.stage]} ${c.count}`)
        byJob.set(c.jobSlug, j)
      }
      return {
        text: [
          "공고별 건수",
          ...[...byJob.entries()].map(([slug, j]) => {
            const m = metaLines(metas.get(slug) ?? null)
            return `- ${j.title} (${slug}${closes.get(slug) ? ` · 마감 ${kstDateTime(closes.get(slug)!)}` : ""}): ${j.parts.join(" · ")}${m.length ? `\n  ${m.map((x) => `${x.label} ${x.value}`).join(" · ")}` : "\n  면접 정보 없음"}`
          }),
          "",
          `지원서 ${rows.length}건${job || stage ? " (좁힌 결과)" : ""}`,
          ...rows.map((r) => `- ${r.code ?? "-"} · ${STAGE_LABEL[r.stage]} · ${r.purgedAt ? "(파기됨)" : `${r.name ?? "-"} · ${r.department ?? "-"} · ${r.grade ?? "-"}학년${r.interests.length ? ` · 관심: ${r.interests.map((v) => interestLabel(v)).join(", ")}` : ""}`} · 접수 ${r.receivedAt ? kstDate(r.receivedAt) : "-"} · ${r.jobTitle}`),
        ].join("\n"),
      }
    }
    case "get_interview_pack": {
      // 화면과 같은 권한 — 채용 담당만. PDF 는 만들지 않고 받을 주소만 준다(누르면 그때 만들어 받는다 · 활동 기록)
      if (!(await isHrReviewer(caller.userId))) return { error: "채용 담당만 받을 수 있습니다 — 관리자 › 운영 › 채용 담당에 든 사람에게만 열린 일입니다." }
      const origin = (process.env.PUBLIC_URL || "https://omnis.haddscience.com").replace(/\/+$/, "")
      const job = str(args.job)
      const ref = str(args.application)
      if (!job && !ref) return { error: "application(접수 번호 · 이름) 또는 job(공고 slug) 중 하나를 주세요" }
      if (ref) {
        const found = await prisma.jobApplication.findMany({
          where: { stage: { not: "RECEIVING" }, purgedAt: null, OR: [{ code: ref.toUpperCase() }, { id: ref }, { name: ref }] },
          select: { id: true, code: true, name: true, stage: true },
          take: 3,
        })
        if (found.length > 1) return { error: "같은 이름의 지원서가 여럿입니다 — 접수 번호로 주세요(list_applications)" }
        const a = found[0]
        if (!a) return { error: "없는 지원서입니다 — list_applications 로 접수 번호를 확인하세요" }
        if (!canPack(a.stage)) return { error: `${a.code} 은 ${STAGE_LABEL[a.stage as Stage]} 단계입니다 — 서류 합격한 지원자만 면접자료를 받습니다` }
        return { text: `${a.code} ${a.name} 면접자료 PDF(지원서 요약 · 이력서 · 포트폴리오): ${origin}/api/hr/applications/${a.id}/interview-pack\n채용 담당이 로그인한 브라우저에서 열립니다.` }
      }
      const n = await prisma.jobApplication.count({ where: { jobSlug: job, stage: { in: [...BUNDLE_STAGES] }, purgedAt: null } })
      if (n === 0) return { error: "그 공고에 서류 합격한 지원자가 없습니다 — list_applications 로 확인하세요" }
      return { text: `서류 합격 ${n}명 면접자료 묶음 PDF(표지 · 지원자별): ${origin}/api/hr/jobs/${job}/interview-pack\n채용 담당이 로그인한 브라우저에서 열립니다.` }
    }
  }
}

// ─── 쓰기 계획 ───

const planProfile: Planner = async (args, caller) => {
  const T = "회사 기본정보 고치기"
  if (!isAdmin(caller)) return blocked(T, "회사 정보", ADMIN_ONLY)
  const now = await prisma.companyProfile.findUnique({ where: { id: "hadd" } })
  const form: Record<string, string> = Object.fromEntries(Object.values(PROFILE_KEYS).map((k) => [k, formValue(now?.[k as keyof typeof now])]))
  const changes = []
  for (const [arg, key] of Object.entries(PROFILE_KEYS)) {
    if (!has(args, arg)) continue
    const v = str(args[arg])
    if (v === form[key]) continue
    changes.push({ label: PROFILE_FIELD_LABEL[key as keyof typeof PROFILE_FIELD_LABEL], before: form[key] || "(없음)", after: v || "(지움)" })
    form[key] = v
  }
  return {
    title: T, target: form.nameKo || "회사 정보", changes,
    risk: "회사 정보는 지원서 · 과제 서식의 근거로 쓰입니다. 바뀐 칸이 활동 기록에 남습니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 칸이 없습니다" } : {}),
    run: async () => {
      const r = await saveCompanyProfile(caller.userId, form)
      return r.ok ? { ok: true, text: `고쳤습니다: ${r.value.changed.map((k) => PROFILE_FIELD_LABEL[k as keyof typeof PROFILE_FIELD_LABEL]).join(", ")}` } : { ok: false, error: r.error }
    },
  }
}

async function yearRow(year: number, basis: string) {
  return prisma.companyYear.findFirst({ where: { year, basis: basis as "CONFIRMED" } })
}

const planSaveYear: Planner = async (args, caller) => {
  const year = Number(args.year)
  const basis = str(args.basis).toUpperCase()
  const T = "연도별 재무"
  if (!isAdmin(caller)) return blocked(T, `${year}`, ADMIN_ONLY)
  if (!Number.isInteger(year) || !["CONFIRMED", "PLANNED"].includes(basis)) return blocked(T, String(args.year ?? ""), "year(정수)와 basis(CONFIRMED · PLANNED)가 필요합니다")
  const row = await yearRow(year, basis)
  const form: Record<string, string> = { year: String(year), basis }
  for (const key of Object.values(YEAR_KEYS)) form[key] = formValue(row?.[key as keyof typeof row])
  const changes = []
  for (const [arg, key] of Object.entries(YEAR_KEYS)) {
    if (!has(args, arg)) continue
    const v = str(args[arg])
    if (v === form[key]) continue
    changes.push({ label: YEAR_FIELD_LABEL[key], before: row ? form[key] || "(없음)" : null, after: v || "(지움)" })
    form[key] = v
  }
  const target = `${year} ${BASIS_LABEL[basis as "CONFIRMED"]}`
  return {
    title: row ? `${T} 고치기` : `${T} 추가`, target, changes,
    risk: "회사 재무는 지원서 · 과제 서식의 근거로 쓰입니다. 확정과 계획을 섞어 적지 않습니다. 활동 기록에 남습니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 칸이 없습니다" } : {}),
    run: async () => {
      const r = row ? await updateCompanyYear(caller.userId, row.id, form) : await createCompanyYear(caller.userId, form)
      return r.ok ? { ok: true, text: `${row ? "고쳤습니다" : "더했습니다"}: ${target}` } : { ok: false, error: r.error }
    },
  }
}

const planDeleteYear: Planner = async (args, caller) => {
  const year = Number(args.year)
  const basis = str(args.basis).toUpperCase()
  const T = "연도별 재무 지우기"
  if (!isAdmin(caller)) return blocked(T, `${year}`, ADMIN_ONLY)
  const row = Number.isInteger(year) && ["CONFIRMED", "PLANNED"].includes(basis) ? await yearRow(year, basis) : null
  if (!row) return blocked(T, `${args.year ?? ""} ${basis}`, "그 연도 · 단계 줄이 없습니다 — company_profile 로 확인하세요")
  const money = YEAR_MONEY_FIELDS.filter(([k]) => row[k] !== null).map(([k, label]) => `${label} ${won(Number(row[k]))}`).join(" · ")
  return {
    title: T, target: `${row.year} ${BASIS_LABEL[row.basis]}`,
    changes: [{ label: "지울 줄", before: money || "(금액 없음)", after: "지움" }],
    risk: "그 연도 · 단계의 재무가 지워집니다. 되돌릴 수 없습니다.",
    confirmLabel: "지우기",
    run: async () => {
      const r = await deleteCompanyYear(caller.userId, row.id)
      return r.ok ? { ok: true, text: `지웠습니다: ${row.year} ${BASIS_LABEL[row.basis]}` } : { ok: false, error: r.error }
    },
  }
}

const planAudience: Planner = async (args, caller) => {
  const T = "웍스 캘린더 공개 범위"
  if (!isAdmin(caller)) return blocked(T, str(args.calendar), ADMIN_ONLY)
  const audience = str(args.audience).toUpperCase()
  if (audience !== "ALL" && audience !== "ADMIN") return blocked(T, str(args.calendar), "audience 는 ALL · ADMIN 중 하나입니다")
  const ref = str(args.calendar)
  const all = await prisma.externalCalendar.findMany({ select: { id: true, displayName: true, audience: true } })
  const hits = all.filter((c) => c.id === ref || c.displayName === ref)
  const loose = hits.length ? hits : all.filter((c) => ref && c.displayName.includes(ref))
  if (loose.length !== 1) {
    return blocked(T, ref || "(캘린더 없음)", [loose.length === 0 ? "캘린더를 찾지 못했습니다." : "여러 캘린더가 걸립니다.", "캘린더:", ...all.map((c) => `- ${c.displayName} · ${c.audience} · id=${c.id}`)].join("\n"))
  }
  const cal = loose[0]
  const LABEL = { ALL: "구성원 전체", ADMIN: "관리자만" } as const
  return {
    title: T, target: cal.displayName,
    changes: [{ label: "보이는 사람", before: LABEL[cal.audience as "ALL"] ?? cal.audience, after: LABEL[audience] }],
    risk: audience === "ALL" ? "구성원 모두의 캘린더 · AI 답에 이 캘린더 일정이 보입니다." : "관리자만 이 캘린더 일정을 봅니다.",
    ...(cal.audience === audience ? { problem: "이미 그 범위입니다" } : {}),
    run: async () => {
      const r = await setCalendarAudience(caller.userId, cal.id, audience)
      return r.ok ? { ok: true, text: `바꿨습니다: ${r.value.displayName} — ${LABEL[audience]}` } : { ok: false, error: r.error }
    },
  }
}

const planBudget: Planner = async (args, caller) => {
  const T = "AI 비용 상한 바꾸기"
  if (!isAdmin(caller)) return blocked(T, "AI 비용 상한", ADMIN_ONLY)
  const [b, recipients] = await Promise.all([loadBudget(), configuredRecipientIds()])
  const next = { ...b, users: { ...b.users } }
  let nextRecipients = recipients
  const changes = []
  if (has(args, "user_daily_krw") && Number(args.user_daily_krw) !== b.userDailyKrw) {
    next.userDailyKrw = Number(args.user_daily_krw)
    changes.push({ label: "사람마다 하루", before: won(b.userDailyKrw), after: won(next.userDailyKrw) })
  }
  if (has(args, "monthly_krw") && Number(args.monthly_krw) !== b.monthlyKrw) {
    next.monthlyKrw = Number(args.monthly_krw)
    changes.push({ label: "회사 월", before: won(b.monthlyKrw), after: won(next.monthlyKrw) })
  }
  const { findUsers } = await import("@/lib/omnis-mcp")
  if (args.users && typeof args.users === "object") {
    for (const [name, krw] of Object.entries(args.users as Record<string, unknown>)) {
      const { ids, missing } = await findUsers([name])
      if (missing.length || !ids[0]) return blocked(T, "AI 비용 상한", `모르는 이름: ${name} — list_members 로 확인하세요`)
      const before = b.users[ids[0]]
      const v = Number(krw)
      if (v > 0) next.users[ids[0]] = v
      else delete next.users[ids[0]]
      changes.push({ label: `${name} 하루`, before: before ? won(before) : "(예외 없음)", after: v > 0 ? won(v) : "(예외 지움)" })
    }
  }
  if (Array.isArray(args.recipients)) {
    const names = args.recipients.map(String)
    const { ids, missing } = await findUsers(names)
    if (missing.length) return blocked(T, "AI 비용 상한", `모르는 이름: ${missing.join(", ")}`)
    const nameOf = new Map((await prisma.user.findMany({ where: { id: { in: [...recipients, ...ids] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    nextRecipients = ids
    changes.push({ label: "알림 받는 사람", before: recipients.map((id) => nameOf.get(id) ?? id).join(", ") || "(지정 없음)", after: ids.map((id) => nameOf.get(id) ?? id).join(", ") || "(지정 없음)" })
  }
  const parsed = SaveBudgetSchema.safeParse({ ...next, recipients: nextRecipients })
  return {
    title: T, target: "AI 비용 상한", changes,
    risk: "저장하는 즉시 모든 사람의 AI 사용에 적용됩니다. 활동 기록에 남습니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 것이 없습니다" } : !parsed.success ? { problem: parsed.error.issues[0]?.message ?? "잘못된 값입니다" } : {}),
    run: async () => {
      if (!parsed.success) return { ok: false, error: "잘못된 값입니다" }
      const { recipients: rs, ...budget } = parsed.data
      await saveBudget(budget, caller.userId)
      await saveRecipientIds(rs, caller.userId)
      await writeActivity({ userId: caller.userId, action: "ai_budget.saved", entity: "AppSetting", entityId: "ai_budget", title: "AI 비용 상한 저장" }).catch(() => {})
      return { ok: true, text: "저장했습니다 — 바로 적용됩니다." }
    },
  }
}

const planFeatureStatus: Planner = async (args, caller) => {
  const T = "기능 요청 상태"
  if (!isAdmin(caller)) return blocked(T, str(args.request), ADMIN_ONLY)
  const status = str(args.status).toUpperCase()
  if (!isFeatureStatus(status)) return blocked(T, str(args.request), "status 는 NEW · REVIEW · DONE 중 하나입니다")
  const row = str(args.request) ? await prisma.featureRequest.findUnique({ where: { id: str(args.request) }, select: { id: true, title: true, status: true, _count: { select: { entries: true } } } }) : null
  if (!row) return blocked(T, str(args.request) || "(요청 없음)", "없는 요청입니다 — list_feature_requests 로 확인하세요")
  let notice = null
  if (str(args.notice_change) || str(args.notice_link)) {
    if (status !== "DONE") return blocked(T, row.title, "알림은 완료로 바꿀 때만 보냅니다")
    const p = parseDoneNotice({ change: str(args.notice_change), link: str(args.notice_link) })
    if ("problem" in p) return blocked(T, row.title, p.problem)
    notice = p
  }
  return {
    title: T, target: row.title,
    changes: [
      { label: "상태", before: FEATURE_STATUS_LABEL[row.status as "NEW"] ?? row.status, after: FEATURE_STATUS_LABEL[status] },
      ...(notice ? [{ label: "완료 알림", before: null, after: `${notice.change} · ${notice.link}` }] : []),
    ],
    risk: notice ? `요청한 사람(최대 ${row._count.entries}명)에게 완료 알림이 갑니다.` : "관리 화면의 상태만 바뀝니다.",
    run: async () => {
      const r = await changeFeatureStatus(row.id, status, caller.userId, notice)
      if (!r.found) return { ok: false, error: "없는 요청입니다" }
      await writeActivity({
        userId: caller.userId, action: "feature_request.status", entity: "admin", entityId: row.id,
        title: `기능 요청 「${r.title}」 → ${FEATURE_STATUS_LABEL[status]}${notice ? ` · 요청한 사람 ${r.notified}명에게 알림` : ""}`,
      })
      return { ok: true, text: `바꿨습니다: ${FEATURE_STATUS_LABEL[status]}${notice ? ` · ${r.notified}명에게 알림` : ""}` }
    },
  }
}

const planFeedback: Planner = async (args, caller) => {
  const T = "문의 · 의견 보내기"
  let parsed: { title: string; detail: string } | { problem: string }
  let via = "앱 정보 — 문의·의견 보내기"
  if (str(args.reply_to)) {
    const feature = await featureForReply(str(args.reply_to), caller.userId)
    if (!feature) return blocked(T, str(args.reply_to), "답장할 요청이 없습니다 — 내가 남긴 요청의 완료 알림에만 답장합니다")
    parsed = feedbackReply(feature.title, args.text)
    via = "기능 완료 알림 — 답장"
  } else {
    parsed = feedbackRequest(str(args.kind) || "idea", args.text)
  }
  if ("problem" in parsed) return blocked(T, "", parsed.problem)
  const p = parsed
  return {
    title: T, target: p.title,
    changes: [{ label: "보낼 글", before: null, after: clip(p.detail, 600) }],
    risk: "개발 담당자에게 알림 · 메일이 갑니다. 같은 제목의 요청이 있으면 그 줄에 묶입니다.",
    run: async () => {
      const r = await submitFeatureRequest({ title: p.title, detail: p.detail, attempted: "" }, { userId: caller.userId, userName: caller.name, base: process.env.PUBLIC_URL ?? "", via })
      return { ok: true, id: r.id, text: r.merged ? `보냈습니다 — 같은 요청에 묶였습니다(${r.count}명).` : "보냈습니다." }
    },
  }
}

const kstDateTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

const planApplicationStage: Planner = async (args, caller) => {
  const T = "지원서 단계 바꾸기"
  const ref = str(args.application)
  if (!(await isHrReviewer(caller.userId))) return blocked(T, ref || "(지원서)", "채용 담당만 바꿀 수 있습니다 — 관리자 › 운영 › 채용 담당에 든 사람에게만 열린 일입니다.")
  const stage = str(args.stage).toUpperCase()
  if (!isPickableStage(stage)) return blocked(T, ref || "(지원서)", "stage 는 RECEIVED · SCREENING · INTERVIEW · OFFERED · HIRED · REJECTED · WITHDRAWN 중 하나입니다")
  const found = ref
    ? await prisma.jobApplication.findMany({
        where: { stage: { not: "RECEIVING" }, OR: [{ code: ref.toUpperCase() }, { id: ref }, { name: ref }] },
        select: { id: true, code: true, name: true, stage: true, jobTitle: true },
        take: 3,
      })
    : []
  if (found.length > 1) return blocked(T, ref, "같은 이름의 지원서가 여럿입니다 — 접수 번호로 주세요(list_applications)")
  const a = found[0]
  if (!a) return blocked(T, ref || "(지원서)", "없는 지원서입니다 — list_applications 로 접수 번호를 확인하세요")
  const target = `${a.code ?? a.id} ${a.name ?? "(파기됨)"}`
  if (a.stage === stage) return blocked(T, target, `이미 ${STAGE_LABEL[stage]} 단계입니다`)
  const note = str(args.note)
  return {
    title: T,
    target,
    changes: [
      { label: "단계", before: STAGE_LABEL[a.stage as Stage], after: STAGE_LABEL[stage] },
      ...(note ? [{ label: "메모", before: null, after: clip(note, 200) }] : []),
    ],
    risk: "지원서함과 지원서 기록에 남습니다. 지원자에게 메일은 가지 않습니다.",
    run: async () => {
      const r = await changeApplicationStage(caller.userId, a.id, stage, { note })
      return r.ok ? { ok: true, text: `바꿨습니다: ${target} → ${STAGE_LABEL[stage]}`, id: a.id } : { ok: false, error: r.error }
    },
  }
}

const planJobPosting: Planner = async (args, caller) => {
  const T = "공고 면접 정보 고치기"
  const slug = str(args.job)
  if (!(await isHrReviewer(caller.userId))) return blocked(T, slug || "(공고)", "채용 담당만 고칠 수 있습니다 — 관리자 › 운영 › 채용 담당에 든 사람에게만 열린 일입니다.")
  if (!JOB_SLUG.test(slug)) return blocked(T, slug || "(공고)", "job 은 공고 slug 입니다 — list_applications 의 괄호 안")
  const [jobs, known] = await Promise.all([loadJobs(), prisma.jobApplication.count({ where: { jobSlug: slug } })])
  const title = jobs.find((j) => j.slug === slug)?.title
  if (!title && known === 0) return blocked(T, slug, "모르는 공고입니다 — list_applications 로 slug 를 확인하세요")
  const patch: Record<string, unknown> = {}
  if (has(args, "slots")) {
    if (!Array.isArray(args.slots)) return blocked(T, slug, 'slots 는 "2026-12-01 11:00" 같은 글의 목록입니다')
    const out: InterviewSlot[] = []
    for (const t of args.slots) {
      const r = parseSlotText(String(t))
      if ("error" in r) return blocked(T, slug, r.error)
      out.push(r.slot)
    }
    patch.slots = out
  }
  if (has(args, "place")) patch.place = str(args.place)
  if (has(args, "mode")) {
    const m = str(args.mode).toUpperCase()
    if (m && m !== "NONE" && m !== "IN_PERSON" && m !== "VIDEO") return blocked(T, slug, "mode 는 IN_PERSON(대면) · VIDEO(화상) · NONE(지움)")
    patch.mode = m === "NONE" ? "" : m
  }
  if (has(args, "video_url")) patch.videoUrl = str(args.video_url)
  if (has(args, "memo")) patch.memo = str(args.memo)
  if (Object.keys(patch).length === 0) return blocked(T, slug, "고칠 칸(slots · place · mode · video_url · memo)을 하나 이상 주세요")
  const now = await loadJobMeta(slug)
  const show = (v: string | null | undefined) => (v ? v : null)
  const slotsText = (s: InterviewSlot[]) => (s.length ? s.map(slotLabel).join(", ") : null)
  const changes = [
    ...(patch.slots ? [{ label: "면접 일시", before: slotsText(now.slots), after: slotsText(patch.slots as InterviewSlot[]) ?? "(지움)" }] : []),
    ...(patch.place !== undefined ? [{ label: "면접 장소", before: show(now.place), after: show(patch.place as string) ?? "(지움)" }] : []),
    ...(patch.mode !== undefined ? [{ label: "면접 방식", before: modeLabel(now.mode), after: (patch.mode ? modeLabel(patch.mode as "IN_PERSON" | "VIDEO") : null) ?? "(지움)" }] : []),
    ...(patch.videoUrl !== undefined ? [{ label: "화상 링크", before: show(now.videoUrl), after: show(patch.videoUrl as string) ?? "(지움)" }] : []),
    ...(patch.memo !== undefined ? [{ label: "메모", before: show(now.memo), after: show(clip(patch.memo as string, 300)) ?? "(지움)" }] : []),
  ]
  const target = `${title ?? slug} (${slug})`
  return {
    title: T,
    target,
    changes,
    risk: "지원서함 공고 보드 머리와 서류 합격 묶음 면접자료 PDF 표지에 바로 보입니다. 지원자에게 알림 · 메일은 가지 않습니다.",
    run: async () => {
      const r = await updateJobMeta(caller.userId, slug, patch)
      if (!r.ok) return { ok: false, error: r.error }
      return { ok: true, id: slug, text: r.changed.length ? `고쳤습니다: ${target}` : "바뀐 칸이 없습니다 — 지금 값과 같습니다." }
    },
  }
}

export const ADMIN_PLANNERS: Record<AdminWriteName, Planner> = {
  update_company_profile: planProfile,
  save_company_year: planSaveYear,
  delete_company_year: planDeleteYear,
  set_calendar_audience: planAudience,
  set_ai_budget: planBudget,
  set_feature_status: planFeatureStatus,
  send_feedback: planFeedback,
  change_application_stage: planApplicationStage,
  update_job_posting: planJobPosting,
}

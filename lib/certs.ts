// 인증 탭(아카이브 › 인증)의 순수 함수 — 단계 옮기기 · 체크리스트 · 근거 · 「이 인증을 따면 어느 공고에서 몇 점」.
// prisma 를 들이지 않는다(화면 · API · 도구 · 시험이 같이 쓴다). 시험: lib/certs.test.ts
//
// 이 화면은 공통 층과 별개의 맞춤 화면이다. 다만 나중에 공통 층에 유형(cert)으로 등록할 때(P9) 그대로 쓸 수 있게
// 칸 키를 CERT_FIELDS 로 고정해 둔다 — 화면 · 도구 · API 는 이 키(snake_case)와 칼럼(camelCase)을 같이 본다.
import {
  certKeysOf,
  keyOfCert,
  pointsLabel,
  readBonusItems,
  readableQuote,
  unitOf,
  type BonusUnit,
} from "@/lib/grant-bonus"
import { CERT_STAGE_LABEL, type CertStage } from "@/lib/grants-labels"

/**
 * 칸 키(공통 층 유형 등록 때 그대로 쓴다 — 바꾸지 않는다) → 칼럼 · 이름표.
 * stage 칸은 옛 이름 그대로 status 칼럼에 있다(enum → text 로 바꾸며 칼럼 이름은 두었다).
 */
export const CERT_FIELDS = {
  name: { column: "name", label: "인증명" },
  official_name: { column: "officialName", label: "공식 이름" },
  issuer: { column: "issuer", label: "발급 기관" },
  stage: { column: "status", label: "단계" },
  stage_reason: { column: "stageReason", label: "사유" },
  deadline: { column: "deadline", label: "접수 마감" },
  owner: { column: "ownerId", label: "담당" },
  acquired_on: { column: "acquiredOn", label: "취득일" },
  valid_until: { column: "validUntil", label: "유효기간" },
  cert_no: { column: "certNo", label: "인증 번호" },
  checklist: { column: "checklist", label: "준비물" },
  evidence: { column: "evidence", label: "근거" },
  note: { column: "note", label: "메모" },
} as const
export type CertFieldKey = keyof typeof CERT_FIELDS

// ─── 옛 상태 → 새 단계 ───

/** 옛 enum CertStatus → 새 단계. 마이그레이션 20261128100000_cert_stages 와 같다(시험이 대조한다) */
export const LEGACY_STAGE: Record<string, { stage: CertStage; reason: string | null }> = {
  HELD: { stage: "HELD", reason: null },
  RENEWAL_DUE: { stage: "RENEWAL_DUE", reason: null },
  EXPIRED: { stage: "EXPIRED", reason: null },
  CANDIDATE: { stage: "CANDIDATE", reason: null },
  NOT_ELIGIBLE: { stage: "STOPPED", reason: "자격 안 됨" },
}

/** 진행 중(마감 · 준비물을 챙길) 단계 */
export const ACTIVE_STAGES: readonly CertStage[] = ["CANDIDATE", "PREPARING", "APPLIED", "REVIEWING"]
/** 가지고 있는(가점이 인정될 수 있는) 단계 */
export const OWNED_STAGES: readonly CertStage[] = ["HELD", "RENEWAL_DUE", "EXPIRED"]

// ─── 체크리스트 ───

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}
export const CHECKLIST_MAX = 40
export const CHECK_TEXT_MAX = 200

/** 저장된 JSON → 준비물(모양이 다른 줄은 버린다) */
export function readChecklist(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => x && typeof x === "object" && typeof x.text === "string" && x.text.trim())
    .map((x, i) => ({
      id: typeof x.id === "string" && x.id ? x.id : `c${i}`,
      text: String(x.text).trim().slice(0, CHECK_TEXT_MAX),
      done: x.done === true,
    }))
}

/** 받은 준비물 → 저장 모양. 빈 줄은 버리고 id 가 겹치면 새로 붙인다. 너무 많거나 모양이 틀리면 오류 글 */
export function normalizeChecklist(v: unknown): ChecklistItem[] | string {
  if (!Array.isArray(v)) return "준비물은 목록이어야 합니다"
  if (v.length > CHECKLIST_MAX) return `준비물은 ${CHECKLIST_MAX}개까지입니다`
  const seen = new Set<string>()
  const out: ChecklistItem[] = []
  for (const [i, x] of v.entries()) {
    const text = typeof x === "string" ? x : x && typeof x === "object" ? (x as { text?: unknown }).text : undefined
    if (typeof text !== "string") return "준비물마다 글이 있어야 합니다"
    const t = text.trim()
    if (!t) continue
    if (t.length > CHECK_TEXT_MAX) return `준비물 한 줄은 ${CHECK_TEXT_MAX}자까지입니다`
    let id = x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? (x as { id: string }).id : ""
    if (!/^[\w-]{1,40}$/.test(id) || seen.has(id)) id = `c${Date.now().toString(36)}${i}`
    seen.add(id)
    out.push({ id, text: t, done: x && typeof x === "object" ? (x as { done?: unknown }).done === true : false })
  }
  return out
}

export const checklistProgress = (items: ChecklistItem[]) => ({
  done: items.filter((x) => x.done).length,
  total: items.length,
})

// ─── 근거 ───

/** 근거 한 줄 — 채팅 글 · 옴니스 파일 · 링크. 화면에는 label 만 보이고, 글 본문은 복사하지 않는다(방 권한을 따르게) */
export type EvidenceRef =
  | { kind: "message"; ref: string; roomId: string; label: string; at: string | null }
  | { kind: "file"; ref: string; label: string; at: string | null }
  | { kind: "url"; ref: string; label: string; at: string | null }
export const EVIDENCE_MAX = 20

const LABEL_MAX = 120
const idLike = (s: unknown): s is string => typeof s === "string" && /^[\w-]{6,64}$/.test(s)

function oneEvidence(x: unknown): EvidenceRef | string {
  if (!x || typeof x !== "object") return "근거 모양이 틀렸습니다"
  const o = x as Record<string, unknown>
  const label = typeof o.label === "string" ? o.label.trim().slice(0, LABEL_MAX) : ""
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : null
  switch (o.kind) {
    case "message":
      if (!idLike(o.ref) || !idLike(o.roomId)) return "채팅 글 근거는 글 id 와 방 id 가 있어야 합니다"
      return { kind: "message", ref: o.ref, roomId: o.roomId, label: label || "채팅 글", at }
    case "file":
      if (!idLike(o.ref)) return "파일 근거는 파일 id 가 있어야 합니다"
      return { kind: "file", ref: o.ref, label: label || "파일", at }
    case "url": {
      const u = typeof o.ref === "string" ? o.ref.trim() : ""
      if (!/^https?:\/\/\S+$/i.test(u) || u.length > 1000) return "링크는 http · https 주소여야 합니다"
      return { kind: "url", ref: u, label: label || u.replace(/^https?:\/\//, "").slice(0, LABEL_MAX), at }
    }
    default:
      return "근거 종류는 message · file · url 입니다"
  }
}

/** 저장된 JSON → 근거(모양이 다른 줄은 버린다) */
export function readEvidence(v: unknown): EvidenceRef[] {
  if (!Array.isArray(v)) return []
  return v.map(oneEvidence).filter((x): x is EvidenceRef => typeof x !== "string")
}

/** 받은 근거 → 저장 모양. 같은 것(종류 + ref)은 한 번만. 틀리면 오류 글 */
export function normalizeEvidence(v: unknown): EvidenceRef[] | string {
  if (!Array.isArray(v)) return "근거는 목록이어야 합니다"
  if (v.length > EVIDENCE_MAX) return `근거는 ${EVIDENCE_MAX}개까지입니다`
  const out: EvidenceRef[] = []
  const seen = new Set<string>()
  for (const x of v) {
    const e = oneEvidence(x)
    if (typeof e === "string") return e
    const k = `${e.kind}:${e.ref}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

/** 근거로 가는 주소(옴니스 안 경로는 앞에 base path 를 붙여 쓴다) */
export function evidenceHref(e: EvidenceRef): { href: string; external: boolean } {
  switch (e.kind) {
    case "message":
      return { href: `/chat/${e.roomId}`, external: false }
    case "file":
      return { href: `/api/files/${e.ref}`, external: false }
    case "url":
      return { href: e.ref, external: true }
  }
}

// ─── 「이 인증을 따면 어느 공고에서 몇 점」 ───

export interface NoticeForBonus {
  id: string
  title: string
  deadlineAt: Date | string | null
  bonusStatus: string | null
  bonusItems: unknown
}

export interface CertBonusRow {
  noticeId: string
  title: string
  deadline: string | null
  /** 이 인증에 걸린 가점 항목(한 공고에 둘 이상일 수 있다) */
  items: { label: string; pointsLabel: string; points: number | null; unit: BonusUnit; quote: string }[]
  /** 점 단위 합(같은 공고 안) — 정렬용. 점이 아닌 항목만 있으면 0 */
  points: number
}

/**
 * 공고 가점(GrantNotice.bonusItems, PR 287 · 291)을 거꾸로 묶는다 — 이 인증과 같은 인증 키로 잡힌 항목이 있는 공고.
 * 인증 키(lib/grant-bonus CERT_KEYS)가 없는 인증은 이름이 항목 이름에 통째로 들어 있을 때만 잇는다(matchBonus 와 같은 규칙).
 * 지난 공고(마감 < 기준일)는 뺀다. 점이 큰 공고 · 마감이 이른 공고 순.
 */
export function bonusForCert(
  cert: { name: string; officialName: string | null },
  notices: NoticeForBonus[],
  ref: Date = new Date()
): CertBonusRow[] {
  const key = keyOfCert(cert)
  const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const name = compact(cert.name)
  const today = ref.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)
  const out: CertBonusRow[] = []
  for (const n of notices) {
    if (n.bonusStatus !== "ok") continue
    const deadline = n.deadlineAt ? new Date(n.deadlineAt).toISOString() : null
    if (deadline && new Date(deadline).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10) < today) continue
    const hits = readBonusItems(n.bonusItems).filter((it) => {
      const keys = certKeysOf(`${it.label} ${it.condition ?? ""}`)
      if (key) return keys.includes(key)
      return !keys.length && name.length >= 4 && compact(it.label).includes(name)
    })
    if (!hits.length) continue
    const items = hits.map((it) => {
      const unit = unitOf(it.pointsText) ?? "점"
      return { label: it.label, pointsLabel: pointsLabel({ ...it, unit }), points: it.points, unit, quote: readableQuote(it.quote) }
    })
    out.push({
      noticeId: n.id,
      title: n.title,
      deadline,
      items,
      points: items.filter((i) => i.unit === "점").reduce((a, i) => a + (i.points ?? 0), 0),
    })
  }
  return out.sort(
    (a, b) =>
      b.points - a.points ||
      (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") ||
      a.title.localeCompare(b.title, "ko")
  )
}

/** 단계 이름표(도구 · 글 표) */
export const stageText = (s: CertStage) => CERT_STAGE_LABEL[s]

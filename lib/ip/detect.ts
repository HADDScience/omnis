/**
 * 정합성 자동 감지.
 *
 * 사람이 등록하지 않는다. 지식재산권 목록을 읽을 때마다 매번 계산한다.
 * 저장하는 것은 "이건 해결했음 / 해당 없음" 표시뿐이므로 등록 UI 가 필요 없다.
 *
 * 여럿이 입력하는 것을 전제로 한다 — 같은 건을 다르게 적거나, 두 번 만들거나,
 * 단계와 값이 서로 안 맞는 경우를 잡는 것이 목적이다.
 */

import { daysBetween } from "@/lib/ip/date"
import type { Patent, Trademark } from "@/lib/ip/types"

export type IssueLevel = "error" | "warn"

export interface Issue {
  /** 같은 문제를 매번 같은 키로 만든다 — 해결 표시를 붙일 수 있도록 */
  key: string
  level: IssueLevel
  kind: "trademark" | "patent"
  /** 관련된 건 (둘 이상이면 중복·충돌) */
  ids: string[]
  title: string
  detail: string
  /** 고치면 되는 필드 — 수정창이 어디를 열지 결정한다 */
  field?:
    | "appNo"
    | "regNo"
    | "filedOn"
    | "registeredOn"
    | "status"
    | "name"
    | "holder"
  /** 「오래 멈춤」에만 있는 경과일. 목록에서 숫자로 보여준다. */
  days?: number
}

/** 출원번호 앞 두 자리가 권리 종류다: 10 특허 · 20 실용신안 · 30 디자인 · 40 상표 */
const NUM_PREFIX = /^(\d{2})-/
const APP_NO = /^\d{2}-\d{4}-\d{7}$/
const REG_NO = /^\d{2}-\d{7}$/

const norm = (v: string | null | undefined) =>
  (v ?? "").replace(/\s+/g, "").toLowerCase()

/** 표기 흔들림 비교용 — 공백·괄호·구두점을 지운다 */
const loose = (v: string | null | undefined) =>
  (v ?? "").replace(/[\s()·・,.]/g, "").toLowerCase()

interface Row {
  kind: "trademark" | "patent"
  id: string
  label: string
  appNo: string | null
  regNo: string | null
  filedOn: string | null
  registeredOn: string | null
  refDate: string | null
  status: string
  holder: string | null
}

function rows(trademarks: Trademark[], patents: Patent[]): Row[] {
  return [
    ...trademarks.map((t) => ({
      kind: "trademark" as const,
      id: t.id,
      label: t.name,
      appNo: t.appNo,
      regNo: t.regNo,
      filedOn: t.filedOn,
      registeredOn: t.registeredOn,
      refDate: t.date,
      status: t.status,
      holder: t.holder,
    })),
    ...patents.map((p) => ({
      kind: "patent" as const,
      id: p.id,
      label: p.title,
      appNo: p.appNo,
      regNo: p.regNo,
      filedOn: p.filedOn,
      registeredOn: p.registeredOn,
      refDate: p.date,
      status: p.status,
      holder: p.applicant,
    })),
  ]
}

/**
 * 출원번호가 있어야 하는 단계.
 *
 * 등록·거절확정은 뺀다. 상표 목록은 「등록/출원번호」가 한 칸이라 등록된 건에는
 * 등록번호만 남아 있고 출원번호가 애초에 없다. 그것까지 잡으면 등록된 상표
 * 전부가 매번 경고로 뜬다.
 */
const FILED_STAGES = new Set([
  "출원",
  "출원공고",
  "의견제출통지",
  "보정서제출",
  "심사중",
])

/**
 * 정체 판정 대상 단계.
 *
 * 출원·출원공고·심사중은 뺀다. 관청 심사는 원래 1~2년 걸리므로
 * "932일째 진행 없음"은 문제가 아니라 정상이다. 우리 차례여서
 * 실제로 멈춰 있는 단계만 본다.
 */
const STALE_STAGES = new Set([
  "아이디어",
  "검토요청",
  "검토의견",
  "출원준비",
  "의견제출통지",
  "보정서제출",
])

export function detect(
  trademarks: Trademark[],
  patents: Patent[],
  today: string
): Issue[] {
  const all = rows(trademarks, patents)
  const out: Issue[] = []

  // --- 같은 것이 둘 -------------------------------------------------------

  const byAppNo = new Map<string, Row[]>()
  const byRegNo = new Map<string, Row[]>()
  const byName = new Map<string, Row[]>()

  for (const r of all) {
    if (r.appNo) {
      const k = norm(r.appNo)
      byAppNo.set(k, [...(byAppNo.get(k) ?? []), r])
    }
    if (r.regNo) {
      const k = norm(r.regNo)
      byRegNo.set(k, [...(byRegNo.get(k) ?? []), r])
    }
    const n = loose(r.label)
    if (n) byName.set(n, [...(byName.get(n) ?? []), r])
  }

  for (const [num, group] of byAppNo) {
    if (group.length < 2) continue
    out.push({
      key: `dup-app:${num}`,
      level: "error",
      kind: group[0].kind,
      ids: group.map((g) => g.id),
      title: "같은 출원번호가 두 건에 있습니다",
      detail: `${group[0].appNo} — ${group.map((g) => `${g.id} ${g.label.slice(0, 24)}`).join(" / ")}`,
      field: "appNo",
    })
  }

  for (const [num, group] of byRegNo) {
    if (group.length < 2) continue
    out.push({
      key: `dup-reg:${num}`,
      level: "error",
      kind: group[0].kind,
      ids: group.map((g) => g.id),
      title: "같은 등록번호가 두 건에 있습니다",
      detail: `${group[0].regNo} — ${group.map((g) => `${g.id} ${g.label.slice(0, 24)}`).join(" / ")}`,
      field: "regNo",
    })
  }

  for (const [, group] of byName) {
    if (group.length < 2) continue
    const nums = new Set(group.map((g) => norm(g.appNo) || norm(g.regNo)))
    if (nums.size < 2) continue
    out.push({
      key: `same-name:${group.map((g) => g.id).join(",")}`,
      level: "warn",
      kind: group[0].kind,
      ids: group.map((g) => g.id),
      title: "이름은 같은데 번호가 다릅니다",
      detail: group
        .map((g) => `${g.id} ${g.appNo ?? g.regNo ?? "번호 없음"}`)
        .join(" / "),
      field: "name",
    })
  }

  // --- 안 맞는 것 ---------------------------------------------------------

  for (const r of all) {
    const want = r.kind === "trademark" ? "40" : "10"
    const label = r.kind === "trademark" ? "상표" : "특허"

    for (const [field, value] of [
      ["appNo", r.appNo],
      ["regNo", r.regNo],
    ] as const) {
      if (!value) continue
      // 대리인 사건번호(영문 접두어 + 숫자)는 관청 번호가 아니므로 검사 대상이 아니다.
      if (!NUM_PREFIX.test(value)) continue
      const prefix = NUM_PREFIX.exec(value)![1]
      if (prefix !== want) {
        out.push({
          key: `prefix:${r.id}:${field}`,
          level: "error",
          kind: r.kind,
          ids: [r.id],
          title: "번호 체계가 종류와 안 맞습니다",
          detail: `${label}인데 ${value} 로 시작합니다 (${label}은 ${want}- 로 시작).`,
          field,
        })
      }
    }

    if (r.appNo && NUM_PREFIX.test(r.appNo) && !APP_NO.test(r.appNo)) {
      out.push({
        key: `shape-app:${r.id}`,
        level: "warn",
        kind: r.kind,
        ids: [r.id],
        title: "출원번호 형식이 다릅니다",
        detail: `${r.appNo} — NN-YYYY-NNNNNNN 형태여야 합니다.`,
        field: "appNo",
      })
    }

    /**
     * 등록번호 칸에 출원번호가 들어 있는 경우.
     *
     * 지식재산권 목록의 「등록/출원번호」는 **한 칸**이다. 등록 전에는 출원번호를, 등록
     * 뒤에는 등록번호를 적는 자리라서, 아직 등록되지 않은 건에 출원번호가
     * 들어 있는 것은 잘못이 아니라 정상이다. 그것까지 잡으면 출원·심사 중인
     * 건이 전부 빨간 경고로 뜬다.
     *
     * 잘못이라고 말할 수 있는 것은 **단계가 「등록」인데도** 그 칸이 여전히
     * 출원번호 형태일 때뿐이다. 그때는 등록번호를 못 받아 적은 것이다.
     */
    if (r.regNo && APP_NO.test(r.regNo) && r.status === "등록") {
      out.push({
        key: `wrong-col:${r.id}`,
        level: "error",
        kind: r.kind,
        ids: [r.id],
        title: "등록인데 번호가 아직 출원번호입니다",
        detail: `${r.regNo} 는 출원번호 형태입니다 (등록번호는 NN-NNNNNNN).`,
        field: "regNo",
      })
    } else if (
      r.regNo &&
      !APP_NO.test(r.regNo) &&
      NUM_PREFIX.test(r.regNo) &&
      !REG_NO.test(r.regNo)
    ) {
      out.push({
        key: `shape-reg:${r.id}`,
        level: "warn",
        kind: r.kind,
        ids: [r.id],
        title: "등록번호 형식이 다릅니다",
        detail: `${r.regNo} — NN-NNNNNNN 형태여야 합니다.`,
        field: "regNo",
      })
    }

    if (r.status === "등록" && !r.regNo) {
      out.push({
        key: `reg-missing:${r.id}`,
        level: "error",
        kind: r.kind,
        ids: [r.id],
        title: "등록인데 등록번호가 없습니다",
        detail: `${r.id} ${r.label.slice(0, 30)}`,
        field: "regNo",
      })
    }

    // 등록번호 칸에 출원번호가 들어 있는 경우는 위에서 이미 잡았으므로 중복해서 세지 않는다.
    if (r.regNo && !APP_NO.test(r.regNo) && r.status !== "등록") {
      out.push({
        key: `reg-stage:${r.id}`,
        level: "warn",
        kind: r.kind,
        ids: [r.id],
        title: "등록번호가 있는데 단계가 등록이 아닙니다",
        detail: `${r.regNo} · 현재 단계 「${r.status}」`,
        field: "status",
      })
    }

    if (FILED_STAGES.has(r.status) && !r.appNo) {
      out.push({
        key: `app-missing:${r.id}`,
        level: "warn",
        kind: r.kind,
        ids: [r.id],
        title: "출원 이후 단계인데 출원번호가 없습니다",
        detail: `현재 단계 「${r.status}」`,
        field: "appNo",
      })
    }

    if (r.filedOn && r.registeredOn && r.filedOn > r.registeredOn) {
      out.push({
        key: `date-order:${r.id}`,
        level: "error",
        kind: r.kind,
        ids: [r.id],
        title: "출원일이 등록일보다 늦습니다",
        detail: `출원 ${r.filedOn} · 등록 ${r.registeredOn}`,
        field: "filedOn",
      })
    }

    for (const [field, value, name] of [
      ["filedOn", r.filedOn, "출원일"],
      ["registeredOn", r.registeredOn, "등록일"],
    ] as const) {
      if (value && value > today) {
        out.push({
          key: `future:${r.id}:${field}`,
          level: "error",
          kind: r.kind,
          ids: [r.id],
          title: `${name}이 미래입니다`,
          detail: value,
          field,
        })
      }
    }
  }

  // --- 표기 흔들림 --------------------------------------------------------

  const holders = new Map<string, Set<string>>()
  for (const r of all) {
    if (!r.holder) continue
    const k = loose(r.holder)
    holders.set(k, new Set([...(holders.get(k) ?? []), r.holder]))
  }
  for (const [, variants] of holders) {
    if (variants.size < 2) continue
    out.push({
      key: `holder:${[...variants].join("|")}`,
      level: "warn",
      kind: "trademark",
      ids: all.filter((r) => variants.has(r.holder ?? "")).map((r) => r.id),
      title: "출원인·보유자 표기가 흔들립니다",
      detail: [...variants].join(" / "),
      field: "holder",
    })
  }

  // --- 오래 멈춘 것 -------------------------------------------------------

  for (const r of all) {
    if (!r.refDate) continue
    const days = daysBetween(r.refDate, today)
    if (days !== null && days >= 90 && STALE_STAGES.has(r.status)) {
      out.push({
        key: `stale:${r.id}`,
        level: "warn",
        kind: r.kind,
        ids: [r.id],
        title: `${days}일째 진행이 없습니다`,
        detail: `마지막 진행 ${r.refDate} · 단계 「${r.status}」`,
        days,
      })
    }
  }

  const rank: Record<IssueLevel, number> = { error: 0, warn: 1 }
  return out.sort(
    (a, b) => rank[a.level] - rank[b.level] || a.key.localeCompare(b.key)
  )
}

/** 건별로 묶어 지식재산권 목록에 배지로 띄운다 */
export function issuesById(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>()
  for (const i of issues) {
    for (const id of i.ids) map.set(id, [...(map.get(id) ?? []), i])
  }
  return map
}

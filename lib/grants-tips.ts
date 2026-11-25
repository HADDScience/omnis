// TIPS 가점 — 수집기 certifications.json 리비전 5 의 research.tips_bonus(인증마다) 와 tips_rules(최상위).
// 순수 함수만 — 화면(회사 정보 › 인증·가점) · list_certifications · 이식 스크립트가 같이 쓴다.

/** tips_rules 를 두는 AppSetting 키 */
export const TIPS_RULES_KEY = "grants.tips_rules"

export interface TipsTrack {
  applies: boolean
  points: string | null
}
export interface TipsBonus {
  general: TipsTrack
  deeptech: TipsTrack
  /** 개인사업자(지금) 기준 우리 판정 */
  sole: string | null
  /** 법인 전환 뒤 기준 우리 판정 */
  corp: string | null
}
export interface TipsRules {
  generalCap: string | null
  deeptechCap: string | null
  deeptechNote: string | null
  window: string | null
  basisTitle: string | null
  basisUrl: string | null
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null

function track(v: unknown): TipsTrack {
  const o = (v ?? {}) as Record<string, unknown>
  return { applies: o.applies === true, points: str(o.points) }
}

/** research.tips_bonus → 화면·도구용. 칸이 없으면 null */
export function readTipsBonus(research: unknown): TipsBonus | null {
  const t = (research as Record<string, unknown> | null)?.tips_bonus
  if (!t || typeof t !== "object") return null
  const o = t as Record<string, unknown>
  const sole = str(o.our_sole)
  const corp = str(o.our_corp)
  return {
    general: track(o.general),
    deeptech: track(o.deeptech),
    sole,
    // 「같음」 은 개인 판정을 그대로 쓴다는 뜻
    corp: corp === "같음" ? sole : corp,
  }
}

/** TIPS 가점표(일반 · 딥테크 어느 쪽이든)에 있는 항목인가 */
export const isTipsItem = (t: TipsBonus | null) =>
  !!t && (t.general.applies || t.deeptech.applies)

/** 한 줄 요약 — 「일반 1점 · 딥테크 최대 1점」. 가점표에 없으면 null */
export function tipsShort(t: TipsBonus | null): string | null {
  if (!isTipsItem(t)) return null
  const cut = (p: string | null) => {
    const m = p?.match(/(?:최대|본사(?: 또는 공장)?|본사 최대)?\s*[\d.]+\s*점/)
    return m ? m[0].replace(/\s+/g, " ").trim() : p
  }
  return [
    t!.general.applies && `일반 ${cut(t!.general.points) ?? "가점"}`,
    t!.deeptech.applies && `딥테크 ${cut(t!.deeptech.points) ?? "가점"}`,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** 이식 파일의 tips_rules → 저장 모양 */
export function tipsRulesFrom(v: unknown): TipsRules | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const basis = (o.basis ?? {}) as Record<string, unknown>
  return {
    generalCap: str(o.general_cap),
    deeptechCap: str(o.deeptech_cap),
    deeptechNote: str(o.deeptech_note),
    window: str(o.window_2026),
    basisTitle: str(basis.title),
    basisUrl: str(basis.url),
  }
}

/** AppSetting 에서 읽은 값 → TipsRules (모양이 다르면 null) */
export function asTipsRules(v: unknown): TipsRules | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  return "generalCap" in o ? (o as unknown as TipsRules) : null
}

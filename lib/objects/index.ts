// 공통 층 유형 레지스트리 — 등록한 유형과 선택지 묶음. 데이터만 둔다.
// P1(2026-11-27): 아직 아무 데서도 import 하지 않는다. P5 의 일반 읽기 도구(describe_type · list_objects · get_object)가 처음 쓴다.
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md
import type { OptionSetDef, TypeDef } from "./define"
import { OPTION_SETS } from "./options"
import { grantDecisionType } from "./types/grant-decision"
import { orgType } from "./types/org"
import { recordType } from "./types/record"

export const OBJECT_TYPES: readonly TypeDef[] = [recordType, grantDecisionType, orgType]

/**
 * 등록 예정 유형(계획 §4 의 2순위 · 장부) — ref · 연결이 미리 가리킬 수 있게 키와 기대는 테이블만 둔다.
 * 등록하면 여기서 빼고 OBJECT_TYPES 에 넣는다(시험이 겹침을 막는다).
 */
export const PLANNED_TYPES: Readonly<Record<string, string>> = {
  task: "public.Task",
  project: "public.Project",
  card: "public.OmnisCard",
  contact: "public.CrmContact",
  product: "public.CrmProduct",
  quote: "public.CrmQuote",
  sample: "public.CrmSampleRequest",
  shipment: "public.CrmShipment",
  certification: "public.CompanyCertification",
  grant_notice: "public.GrantNotice",
  member: "public.User",
  trademark: "ip.trademarks",
  patent: "ip.patents",
}

export const OPTION_SET_MAP: ReadonlyMap<string, OptionSetDef> = new Map(OPTION_SETS.map((s) => [s.key, s]))

export const getObjectType = (key: string) => OBJECT_TYPES.find((t) => t.key === key)

/** 유형 키 → 기대는 테이블(등록 + 등록 예정) */
export function backingOf(typeKey: string): string | null {
  return getObjectType(typeKey)?.backing ?? PLANNED_TYPES[typeKey] ?? null
}

/** 공통 층 선택지 키 → 기존 값(기존 도구에 넘길 때) */
export function toLegacyOption(setKey: string, key: string): string | undefined {
  return OPTION_SET_MAP.get(setKey)?.options.find((o) => o.key === key)?.legacyValue
}

/** 기존 값 → 공통 층 선택지 키 */
export function fromLegacyOption(setKey: string, legacy: string): string | undefined {
  return OPTION_SET_MAP.get(setKey)?.options.find((o) => o.legacyValue === legacy)?.key
}

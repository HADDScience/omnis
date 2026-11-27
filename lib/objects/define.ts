// 공통 층 유형 정의의 모양과 검사 — 데이터만 둔다(prisma · 서버 모듈을 들이지 않는다).
// 1단계 정의의 정본은 코드다(lib/objects/types/*.ts). P2 의 objects:sync 가 이것을 DB 정의 표로 옮긴다.
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §2-1 · §3
//
// 아직 아무 데서도 import 하지 않는다(P1 — 동작 변화 없음). 시험: lib/objects/objects.test.ts
import type { TOOL_POLICY } from "../tools/registry"

/** 유형 · 칸 · 선택지 · Action 키. 바뀌지 않는다 */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/
/** 회사가 만든 유형(2단계)의 접두어. 제품 기본 유형은 이것으로 시작할 수 없다 */
export const COMPANY_TYPE_PREFIX = "c_"

export const isValidKey = (k: string) => KEY_PATTERN.test(k)

/** 칸 타입 — 일상어 이름표를 함께 둔다(나중에 AI 대화 · 폼이 같은 정의를 만들 수 있게) */
export const DATA_TYPE_LABEL = {
  text: "짧은 글",
  longtext: "긴 글",
  number: "숫자",
  money_krw: "금액(원)",
  date: "날짜",
  datetime: "날짜와 시각",
  bool: "예/아니오",
  option: "고르기",
  multi_option: "여러 개 고르기",
  ref: "다른 항목",
  person: "사람",
  file: "파일",
  url: "링크",
} as const
export type DataType = keyof typeof DATA_TYPE_LABEL
export const DATA_TYPES = Object.keys(DATA_TYPE_LABEL) as DataType[]

/** 공통 틀 칸 — 유형마다 하나씩만 */
export const FRAMES = ["title", "startsOn", "endsOn", "owner", "org", "visibility"] as const
export type Frame = (typeof FRAMES)[number]

export const STORAGES = ["table", "ledger", "generic"] as const
export type Storage = (typeof STORAGES)[number]

export const VISIBILITY_POLICIES = ["fixed", "inherit", "column"] as const
export type VisibilityPolicy = (typeof VISIBILITY_POLICIES)[number]

/** upsert — 기존 도구 하나가 「id 있으면 고치고 없으면 만든다」 일 때(save_company_record) */
export const ACTION_KINDS = ["create", "update", "upsert", "delete", "transition", "custom"] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export const ACTION_RISKS = ["read", "write", "ledger", "destructive"] as const
export type ActionRisk = (typeof ACTION_RISKS)[number]

/** 기존 runTool 이름 — 레지스트리에 없는 이름은 tsc 가 막는다(타입만 가져온다) */
export type ToolName = keyof typeof TOOL_POLICY

/** file 칸 — 칸마다 여러 개 허용 여부와 받을 종류 */
export interface FileRule {
  multiple: boolean
  /** MIME 패턴. "image/*" · "application/pdf" */
  accept: readonly string[]
}

export interface FieldDef {
  key: string
  label: string
  dataType: DataType
  /** option · multi_option */
  optionSetKey?: string
  /** ref */
  refTypeKey?: string
  /** file */
  fileRule?: FileRule
  frame?: Frame
  /** table · ledger: 기대는 칼럼(Prisma 필드 이름) */
  column?: string
  readOnly?: boolean
  required?: boolean
  filterable?: boolean
  sortable?: boolean
  /** 2단계 분류(칸 채우기)에서 뽑는 칸 */
  aiExtract?: boolean
  llmDescription?: string
  maxLength?: number
}

export interface LinkDef {
  key: string
  label: string
  toType: string
  /** "column:projectId" · "table:GrantDecisionOwner" */
  via: string
}

export interface ActionDef {
  key: string
  label: string
  kind: ActionKind
  /** 감싼 기존 도구. 1단계는 기존 도구가 없는 동작을 Action 으로 만들지 않는다 */
  tool: ToolName
  risk: ActionRisk
}

export interface AutoApplyRule {
  groupBy: readonly string[]
  minDecided: number
  minRate: number
  streak: number
}

export interface TypeDef {
  key: string
  label: string
  labelPlural?: string
  /** product(제품 기본) | company(회사가 만듦, 2단계) */
  origin: "product" | "company"
  storage: Storage
  /** table · ledger: "public.CompanyRecord" · "ip.trademarks" */
  backing?: string
  llmDescription: string
  examples: readonly { text: string; note?: string }[]
  visibilityPolicy: VisibilityPolicy
  visibilityFixed?: readonly string[]
  aiPropose?: boolean
  autoApply?: AutoApplyRule
  fields: readonly FieldDef[]
  links?: readonly LinkDef[]
  actions: readonly ActionDef[]
}

/** 정의 하나. origin 을 빼면 제품 기본 유형이다 */
export function defineType(def: Omit<TypeDef, "origin"> & { origin?: TypeDef["origin"] }): TypeDef {
  return { origin: "product", ...def }
}

export interface OptionDef {
  key: string
  label: string
  /** 기존 enum · text 값 — 공통 층 입출력은 key, 기존 도구에 넘길 때만 이 값 */
  legacyValue?: string
}

export interface OptionSetDef {
  key: string
  label: string
  options: readonly OptionDef[]
}

export const defineOptionSet = (def: OptionSetDef): OptionSetDef => def

/** 선택지 묶음 검사 — 어긋난 것을 문장으로 돌려준다(빈 배열이면 통과) */
export function checkOptionSet(set: OptionSetDef): string[] {
  const errs: string[] = []
  if (!isValidKey(set.key)) errs.push(`선택지 묶음 키 형식: ${set.key}`)
  if (!set.options.length) errs.push(`${set.key}: 선택지가 없다`)
  const keys = new Set<string>()
  const legacy = new Set<string>()
  for (const o of set.options) {
    if (!isValidKey(o.key)) errs.push(`${set.key}.${o.key}: 선택지 키 형식`)
    if (keys.has(o.key)) errs.push(`${set.key}.${o.key}: 선택지 키 중복`)
    keys.add(o.key)
    if (!o.label.trim()) errs.push(`${set.key}.${o.key}: 이름표가 비었다`)
    if (o.legacyValue !== undefined) {
      if (legacy.has(o.legacyValue)) errs.push(`${set.key}.${o.key}: 기존 값 중복 ${o.legacyValue}`)
      legacy.add(o.legacyValue)
    }
  }
  return errs
}

const MIME_PATTERN = /^[a-z]+\/(\*|[a-z0-9.+-]+)$/

/**
 * 유형 정의 검사(DB · Prisma 없이) — 키 형식 · 중복 · 필수 칸 · 칸 타입별 규칙.
 * optionSets 는 쓸 수 있는 선택지 묶음, typeKeys 는 ref 가 가리킬 수 있는 유형 키(등록 + 등록 예정).
 */
export function checkTypeDef(
  def: TypeDef,
  ctx: { optionSets: ReadonlyMap<string, OptionSetDef>; typeKeys: ReadonlySet<string> }
): string[] {
  const errs: string[] = []
  const at = def.key
  if (!isValidKey(def.key)) errs.push(`${at}: 유형 키 형식(${KEY_PATTERN})`)
  if (def.origin === "product" && def.key.startsWith(COMPANY_TYPE_PREFIX))
    errs.push(`${at}: 제품 기본 유형은 ${COMPANY_TYPE_PREFIX} 로 시작할 수 없다`)
  if (def.origin === "company" && !def.key.startsWith(COMPANY_TYPE_PREFIX))
    errs.push(`${at}: 회사가 만든 유형은 ${COMPANY_TYPE_PREFIX} 로 시작한다`)
  if (!def.label.trim()) errs.push(`${at}: 이름표가 비었다`)
  if (!def.llmDescription.trim()) errs.push(`${at}: llmDescription 이 비었다`)
  if (!def.examples.length) errs.push(`${at}: 예시가 하나도 없다`)

  if (def.storage === "generic") {
    if (def.backing) errs.push(`${at}: generic 유형은 기대는 테이블이 없다`)
    for (const f of def.fields)
      if (f.dataType === "money_krw") errs.push(`${at}.${f.key}: 금액 칸은 generic 에 둘 수 없다 — 장부는 전용 테이블`)
  } else if (!def.backing || !/^[a-z_]+\.[A-Za-z_][A-Za-z0-9_]*$/.test(def.backing)) {
    errs.push(`${at}: ${def.storage} 유형은 backing("스키마.테이블")이 있어야 한다`)
  }
  if (def.visibilityPolicy === "column" && !def.fields.some((f) => f.frame === "visibility"))
    errs.push(`${at}: visibilityPolicy column 인데 visibility 틀 칸이 없다`)
  if (def.visibilityPolicy !== "fixed" && def.visibilityFixed?.length)
    errs.push(`${at}: visibilityFixed 는 fixed 에서만 쓴다`)

  const fieldKeys = new Set<string>()
  const columns = new Set<string>()
  const frames = new Set<string>()
  for (const f of def.fields) {
    const fa = `${at}.${f.key}`
    if (!isValidKey(f.key)) errs.push(`${fa}: 칸 키 형식`)
    if (fieldKeys.has(f.key)) errs.push(`${fa}: 칸 키 중복`)
    fieldKeys.add(f.key)
    if (!f.label.trim()) errs.push(`${fa}: 이름표가 비었다`)
    if (!(DATA_TYPES as string[]).includes(f.dataType)) errs.push(`${fa}: 모르는 칸 타입 ${f.dataType}`)
    if (f.frame) {
      if (frames.has(f.frame)) errs.push(`${fa}: 틀 칸 ${f.frame} 이 둘이다`)
      frames.add(f.frame)
    }
    const isOption = f.dataType === "option" || f.dataType === "multi_option"
    if (isOption) {
      if (!f.optionSetKey) errs.push(`${fa}: 고르기 칸에 optionSetKey 가 없다`)
      else if (!ctx.optionSets.has(f.optionSetKey)) errs.push(`${fa}: 없는 선택지 묶음 ${f.optionSetKey}`)
    } else if (f.optionSetKey) errs.push(`${fa}: 고르기 칸이 아닌데 optionSetKey 가 있다`)
    if (f.dataType === "ref") {
      if (!f.refTypeKey) errs.push(`${fa}: ref 칸에 refTypeKey 가 없다`)
      else if (!ctx.typeKeys.has(f.refTypeKey)) errs.push(`${fa}: 모르는 유형을 가리킨다 ${f.refTypeKey}`)
    } else if (f.refTypeKey) errs.push(`${fa}: ref 칸이 아닌데 refTypeKey 가 있다`)
    if (f.dataType === "file") {
      if (!f.fileRule) errs.push(`${fa}: file 칸에 fileRule(multiple · accept)이 없다`)
      else {
        if (!f.fileRule.accept.length) errs.push(`${fa}: fileRule.accept 가 비었다`)
        for (const a of f.fileRule.accept) if (!MIME_PATTERN.test(a)) errs.push(`${fa}: 받을 종류 형식 ${a}`)
      }
    } else if (f.fileRule) errs.push(`${fa}: file 칸이 아닌데 fileRule 이 있다`)
    if (def.storage !== "generic") {
      if (!f.column) errs.push(`${fa}: ${def.storage} 유형 칸에 column 이 없다`)
      else {
        if (columns.has(f.column)) errs.push(`${fa}: 칼럼 ${f.column} 을 두 칸이 쓴다`)
        columns.add(f.column)
      }
    } else if (f.column) errs.push(`${fa}: generic 유형 칸에는 column 이 없다`)
    if (f.maxLength !== undefined && !(Number.isInteger(f.maxLength) && f.maxLength > 0))
      errs.push(`${fa}: maxLength 는 양의 정수`)
  }
  if (!frames.has("title")) errs.push(`${at}: title 틀 칸이 없다`)
  if (def.autoApply) for (const g of def.autoApply.groupBy) if (!fieldKeys.has(g)) errs.push(`${at}: autoApply.groupBy 에 없는 칸 ${g}`)

  const linkKeys = new Set<string>()
  for (const l of def.links ?? []) {
    if (!isValidKey(l.key)) errs.push(`${at}.${l.key}: 연결 키 형식`)
    if (linkKeys.has(l.key) || fieldKeys.has(l.key)) errs.push(`${at}.${l.key}: 연결 키가 칸 · 연결과 겹친다`)
    linkKeys.add(l.key)
    if (!ctx.typeKeys.has(l.toType)) errs.push(`${at}.${l.key}: 모르는 유형으로 잇는다 ${l.toType}`)
    if (!/^(column|table):[A-Za-z_][A-Za-z0-9_]*$/.test(l.via)) errs.push(`${at}.${l.key}: via 형식 ${l.via}`)
  }

  const actionKeys = new Set<string>()
  for (const a of def.actions) {
    if (!isValidKey(a.key)) errs.push(`${at}.${a.key}: Action 키 형식`)
    if (actionKeys.has(a.key)) errs.push(`${at}.${a.key}: Action 키 중복`)
    actionKeys.add(a.key)
    if (!(ACTION_KINDS as readonly string[]).includes(a.kind)) errs.push(`${at}.${a.key}: 모르는 kind ${a.kind}`)
    if (!(ACTION_RISKS as readonly string[]).includes(a.risk)) errs.push(`${at}.${a.key}: 모르는 risk ${a.risk}`)
    if (a.kind === "delete" && a.risk !== "destructive") errs.push(`${at}.${a.key}: 지우기 Action 은 destructive`)
    if (def.storage === "ledger" && a.risk === "write") errs.push(`${at}.${a.key}: 장부 쓰기는 ledger 또는 destructive`)
  }
  return errs
}

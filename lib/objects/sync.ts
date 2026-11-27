// objects:sync 의 계획 — 코드 정의(정본)와 DB 정의 표의 지금 모습을 받아 「바꿀 것」 목록을 돌려준다.
// DB 를 읽고 쓰는 일은 scripts/objects-sync.ts 가 한다. 이 파일은 prisma 를 들이지 않는다(시험이 DB 없이 돈다).
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §2-2 · P2
//
// 규칙
// - 멱등: DB 가 코드와 같으면 바꿀 것이 0 이다. 비교는 칸 값 그대로(Json 은 키 순서를 맞춰) 한다.
// - 지우지 않는다: 코드에서 빠진 유형 · 칸 · 선택지 · Action 은 hiddenAt 을 찍어 숨긴다. 코드에 돌아오면 다시 보인다.
// - 바뀌지 않는 것(§2-1): 유형 origin · storage · backing, 칸 dataType · optionSetKey · refTypeKey, 선택지 legacyValue.
//   이것이 다르면 계획을 세우지 않고 오류를 돌려준다 — 새 칸을 만들고 이관하는 것이 맞는 길이다.
// - 버전: 정규화한 정의의 해시(defHash)가 바뀌면 version 을 1 올리고 ObjectTypeVersion 에 정의 전체를 남긴다.
import { createHash } from "node:crypto"
import type { ActionDef, FieldDef, OptionSetDef, TypeDef } from "./define"

// ─── DB 행 모양(scripts/objects-sync.ts 가 Prisma 로 읽어 넘긴다) ───

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export interface TypeRow {
  key: string
  label: string
  labelPlural: string | null
  origin: string
  storage: string
  backing: string | null
  version: number
  defHash: string
  llmDescription: string
  examples: Json
  visibilityPolicy: string
  visibilityFixed: string[]
  aiPropose: boolean
  autoApply: Json
  links: Json
  hiddenAt: Date | null
}
export interface FieldRow {
  typeKey: string
  key: string
  label: string
  dataType: string
  optionSetKey: string | null
  refTypeKey: string | null
  fileRule: Json
  frame: string | null
  column: string | null
  readOnly: boolean
  required: boolean
  filterable: boolean
  sortable: boolean
  aiExtract: boolean
  llmDescription: string | null
  maxLength: number | null
  sinceVersion: number
  hiddenAt: Date | null
}
export interface OptionRow {
  setKey: string
  setLabel: string
  key: string
  label: string
  sortOrder: number
  legacyValue: string | null
  hiddenAt: Date | null
}
export interface ActionRow {
  typeKey: string
  key: string
  label: string
  kind: string
  tool: string | null
  risk: string
  confirm: string | null
  sinceVersion: number
  hiddenAt: Date | null
}
export interface VersionRow {
  typeKey: string
  version: number
  defHash: string
  definition: Json
}

export interface DbState {
  types: TypeRow[]
  fields: FieldRow[]
  options: OptionRow[]
  actions: ActionRow[]
  /** 유형마다 가장 높은 버전 한 줄 */
  latestVersions: VersionRow[]
}

// ─── 바꿀 것 ───

type Cols<T> = Partial<Omit<T, "hiddenAt">> & { hiddenAt?: Date | null }

export type SyncOp =
  | { table: "ObjectType"; op: "create"; key: string; data: Omit<TypeRow, "hiddenAt"> }
  | { table: "ObjectType"; op: "update"; key: string; data: Cols<TypeRow> }
  | { table: "ObjectTypeVersion"; op: "create"; data: VersionRow & { breaking: boolean; summary: string } }
  | { table: "ObjectField"; op: "create"; typeKey: string; key: string; data: Omit<FieldRow, "hiddenAt"> }
  | { table: "ObjectField"; op: "update"; typeKey: string; key: string; data: Cols<FieldRow> }
  | { table: "OptionValue"; op: "create"; setKey: string; key: string; data: Omit<OptionRow, "hiddenAt"> }
  | { table: "OptionValue"; op: "update"; setKey: string; key: string; data: Cols<OptionRow> }
  | { table: "ActionType"; op: "create"; typeKey: string; key: string; data: Omit<ActionRow, "hiddenAt"> }
  | { table: "ActionType"; op: "update"; typeKey: string; key: string; data: Cols<ActionRow> }

export interface SyncPlan {
  ops: SyncOp[]
  errors: string[]
}

// ─── 정규화 · 해시 ───

/** 키 순서를 맞춘 JSON — 같은 값이면 같은 글자 */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "null"
  if (v === null || typeof v !== "object") return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`
}

const toJson = (v: unknown): Json => (v === undefined ? null : (JSON.parse(stableStringify(v)) as Json))

/** 유형 정의 전체(칸이 쓰는 선택지 묶음 포함) — ObjectTypeVersion.definition 과 defHash 의 원천 */
export function definitionOf(def: TypeDef, optionSets: ReadonlyMap<string, OptionSetDef>): Json {
  const used = [...new Set(def.fields.map((f) => f.optionSetKey).filter((k): k is string => !!k))].sort()
  return toJson({ ...def, optionSets: used.map((k) => optionSets.get(k) ?? null) })
}

export const defHashOf = (definition: Json) => createHash("sha256").update(stableStringify(definition)).digest("hex")

// ─── 코드 → 바라는 행 ───

const typeRow = (def: TypeDef, version: number, defHash: string): Omit<TypeRow, "hiddenAt"> => ({
  key: def.key,
  label: def.label,
  labelPlural: def.labelPlural ?? null,
  origin: def.origin,
  storage: def.storage,
  backing: def.backing ?? null,
  version,
  defHash,
  llmDescription: def.llmDescription,
  examples: toJson(def.examples),
  visibilityPolicy: def.visibilityPolicy,
  visibilityFixed: [...(def.visibilityFixed ?? [])],
  aiPropose: !!def.aiPropose,
  autoApply: toJson(def.autoApply ?? null),
  links: toJson(def.links ?? []),
})

const fieldRow = (typeKey: string, f: FieldDef, sinceVersion: number): Omit<FieldRow, "hiddenAt"> => ({
  typeKey,
  key: f.key,
  label: f.label,
  dataType: f.dataType,
  optionSetKey: f.optionSetKey ?? null,
  refTypeKey: f.refTypeKey ?? null,
  fileRule: toJson(f.fileRule ?? null),
  frame: f.frame ?? null,
  column: f.column ?? null,
  readOnly: !!f.readOnly,
  required: !!f.required,
  filterable: !!f.filterable,
  sortable: !!f.sortable,
  aiExtract: !!f.aiExtract,
  llmDescription: f.llmDescription ?? null,
  maxLength: f.maxLength ?? null,
  sinceVersion,
})

const actionRow = (typeKey: string, a: ActionDef, confirm: string | null, sinceVersion: number): Omit<ActionRow, "hiddenAt"> => ({
  typeKey,
  key: a.key,
  label: a.label,
  kind: a.kind,
  tool: a.tool,
  risk: a.risk,
  confirm,
  sinceVersion,
})

/** 바라는 행과 지금 행의 다른 칸만. ignore 칸은 비교하지 않는다(sinceVersion 처럼 처음 값을 지키는 칸) */
function changedCols<T extends object>(want: T, have: T, ignore: readonly (keyof T)[] = []): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(want) as (keyof T)[]) {
    if (ignore.includes(k)) continue
    if (stableStringify(want[k]) !== stableStringify(have[k])) out[k] = want[k]
  }
  return out
}

const nonEmpty = (o: object) => Object.keys(o).length > 0

/** hiddenAt 은 따로 본다(숨김 · 다시 보이기) — 비교할 칸에서 뺀다 */
function withoutHidden<T extends { hiddenAt: Date | null }>(row: T): Omit<T, "hiddenAt"> {
  const out: Partial<T> = { ...row }
  delete out.hiddenAt
  return out as Omit<T, "hiddenAt">
}

// ─── 깨지는 변경 ───

interface DefShape {
  fields?: { key: string; required?: boolean; maxLength?: number }[]
  optionSets?: ({ key: string; options: { key: string }[] } | null)[]
}

/** 옛 정의 → 새 정의의 바뀐 점과 깨지는지(§2-2: 칸 · 선택지 숨김, 필수로 바꿈, maxLength 줄임) */
export function compareDefinitions(prev: Json, next: Json): { breaking: boolean; summary: string } {
  const a = (prev ?? {}) as unknown as DefShape
  const b = (next ?? {}) as unknown as DefShape
  const notes: string[] = []
  let breaking = false
  const fa = new Map((a.fields ?? []).map((f) => [f.key, f]))
  const fb = new Map((b.fields ?? []).map((f) => [f.key, f]))
  for (const k of fa.keys()) if (!fb.has(k)) { notes.push(`칸 숨김 ${k}`); breaking = true }
  for (const k of fb.keys()) if (!fa.has(k)) notes.push(`칸 추가 ${k}`)
  for (const [k, f] of fb) {
    const o = fa.get(k)
    if (!o) continue
    if (!o.required && f.required) { notes.push(`필수로 ${k}`); breaking = true }
    if (o.maxLength !== undefined && (f.maxLength === undefined ? false : f.maxLength < o.maxLength)) {
      notes.push(`maxLength 줄임 ${k}`)
      breaking = true
    }
  }
  const opts = (d: DefShape) =>
    new Set((d.optionSets ?? []).flatMap((s) => (s ? s.options.map((o) => `${s.key}.${o.key}`) : [])))
  const oa = opts(a)
  const ob = opts(b)
  for (const k of oa) if (!ob.has(k)) { notes.push(`선택지 숨김 ${k}`); breaking = true }
  for (const k of ob) if (!oa.has(k)) notes.push(`선택지 추가 ${k}`)
  if (!notes.length) notes.push("이름표 · 설명 · 설정 바뀜")
  return { breaking, summary: notes.join(" · ") }
}

// ─── 계획 ───

export interface PlanInput {
  types: readonly TypeDef[]
  optionSets: readonly OptionSetDef[]
  db: DbState
  /** Action 의 기존 도구 → 확인 방법(lib/tools/registry.ts TOOL_POLICY[tool].confirm) */
  confirmOf: (tool: string) => string | null
  now: Date
}

export function planSync(input: PlanInput): SyncPlan {
  const { types, optionSets, db, confirmOf, now } = input
  const ops: SyncOp[] = []
  const errors: string[] = []
  const setMap = new Map(optionSets.map((s) => [s.key, s]))

  // 선택지 — 묶음 전체를 맞춘다(여러 유형이 같은 묶음을 쓴다)
  for (const set of optionSets)
    set.options.forEach((o, i) => {
      const want: Omit<OptionRow, "hiddenAt"> = {
        setKey: set.key,
        setLabel: set.label,
        key: o.key,
        label: o.label,
        sortOrder: i,
        legacyValue: o.legacyValue ?? null,
      }
      const have = db.options.find((r) => r.setKey === set.key && r.key === o.key)
      if (!have) return void ops.push({ table: "OptionValue", op: "create", setKey: set.key, key: o.key, data: want })
      if (have.legacyValue !== want.legacyValue) {
        errors.push(`선택지 ${set.key}.${o.key}: 기존 값은 바꿀 수 없다 (${have.legacyValue} → ${want.legacyValue})`)
        return
      }
      const haveCols = withoutHidden(have)
      const data: Cols<OptionRow> = changedCols(want, haveCols)
      if (have.hiddenAt) data.hiddenAt = null
      if (nonEmpty(data)) ops.push({ table: "OptionValue", op: "update", setKey: set.key, key: o.key, data })
    })
  for (const r of db.options)
    if (!r.hiddenAt && !setMap.get(r.setKey)?.options.some((o) => o.key === r.key))
      ops.push({ table: "OptionValue", op: "update", setKey: r.setKey, key: r.key, data: { hiddenAt: now } })

  for (const def of types) {
    const definition = definitionOf(def, setMap)
    const hash = defHashOf(definition)
    const have = db.types.find((t) => t.key === def.key)
    const latest = db.latestVersions.find((v) => v.typeKey === def.key)

    if (have) {
      for (const col of ["origin", "storage", "backing"] as const) {
        const want = col === "backing" ? (def.backing ?? null) : def[col]
        if (have[col] !== want) errors.push(`유형 ${def.key}: ${col} 은 바꿀 수 없다 (${have[col]} → ${want})`)
      }
      for (const f of def.fields) {
        const hf = db.fields.find((r) => r.typeKey === def.key && r.key === f.key)
        if (!hf) continue
        for (const col of ["dataType", "optionSetKey", "refTypeKey"] as const) {
          const want = f[col] ?? null
          if (hf[col] !== want) errors.push(`칸 ${def.key}.${f.key}: ${col} 은 바꿀 수 없다 (${hf[col]} → ${want}) — 새 칸을 만들고 이관한다`)
        }
      }
    }

    const bumped = !have || have.defHash !== hash
    const version = !have ? 1 : bumped ? have.version + 1 : have.version
    const wantType = typeRow(def, version, hash)
    if (!have) ops.push({ table: "ObjectType", op: "create", key: def.key, data: wantType })
    else {
      const haveCols = withoutHidden(have)
      const data: Cols<TypeRow> = changedCols(wantType, haveCols)
      if (have.hiddenAt) data.hiddenAt = null
      if (nonEmpty(data)) ops.push({ table: "ObjectType", op: "update", key: def.key, data })
    }
    if (bumped) {
      const cmp = latest ? compareDefinitions(latest.definition, definition) : { breaking: false, summary: "처음 등록" }
      ops.push({ table: "ObjectTypeVersion", op: "create", data: { typeKey: def.key, version, defHash: hash, definition, ...cmp } })
    }

    for (const f of def.fields) {
      const hf = db.fields.find((r) => r.typeKey === def.key && r.key === f.key)
      const want = fieldRow(def.key, f, hf?.sinceVersion ?? version)
      if (!hf) ops.push({ table: "ObjectField", op: "create", typeKey: def.key, key: f.key, data: want })
      else {
        const haveCols = withoutHidden(hf)
        const data: Cols<FieldRow> = changedCols(want, haveCols, ["sinceVersion"])
        if (hf.hiddenAt) data.hiddenAt = null
        if (nonEmpty(data)) ops.push({ table: "ObjectField", op: "update", typeKey: def.key, key: f.key, data })
      }
    }
    for (const r of db.fields)
      if (r.typeKey === def.key && !r.hiddenAt && !def.fields.some((f) => f.key === r.key))
        ops.push({ table: "ObjectField", op: "update", typeKey: def.key, key: r.key, data: { hiddenAt: now } })

    for (const a of def.actions) {
      const ha = db.actions.find((r) => r.typeKey === def.key && r.key === a.key)
      const want = actionRow(def.key, a, confirmOf(a.tool), ha?.sinceVersion ?? version)
      if (!ha) ops.push({ table: "ActionType", op: "create", typeKey: def.key, key: a.key, data: want })
      else {
        const haveCols = withoutHidden(ha)
        const data: Cols<ActionRow> = changedCols(want, haveCols, ["sinceVersion"])
        if (ha.hiddenAt) data.hiddenAt = null
        if (nonEmpty(data)) ops.push({ table: "ActionType", op: "update", typeKey: def.key, key: a.key, data })
      }
    }
    for (const r of db.actions)
      if (r.typeKey === def.key && !r.hiddenAt && !def.actions.some((a) => a.key === r.key))
        ops.push({ table: "ActionType", op: "update", typeKey: def.key, key: r.key, data: { hiddenAt: now } })
  }

  // 코드에서 빠진 유형은 숨긴다(칸 · Action 은 유형과 함께 보이지 않는다)
  for (const t of db.types)
    if (!t.hiddenAt && !types.some((d) => d.key === t.key))
      ops.push({ table: "ObjectType", op: "update", key: t.key, data: { hiddenAt: now } })

  return errors.length ? { ops: [], errors } : { ops, errors }
}

/** 한 줄 요약 — 「ObjectType create 3 · ObjectField create 47 …」 */
export function summarizeOps(ops: readonly SyncOp[]): string {
  const c = new Map<string, number>()
  for (const o of ops) c.set(`${o.table} ${o.op}`, (c.get(`${o.table} ${o.op}`) ?? 0) + 1)
  return c.size ? [...c].map(([k, n]) => `${k} ${n}`).join(" · ") : "바꿀 것 없음"
}

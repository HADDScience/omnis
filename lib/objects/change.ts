// 변경 이벤트(ObjectChange)를 공통 층 말로 바꾸는 순수 함수 — 색인 글 · 공개 범위 · 값 이력. prisma 를 들이지 않는다.
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §2-3 · §2-4 · §6. 시험: lib/objects/change.test.ts
import type { FieldDef, OptionSetDef, TypeDef } from "./define"
import type { AuthorKind } from "./records"

/** 트리거가 남긴 변경 한 줄(필요한 칸만) */
export interface ChangeRow {
  id: bigint
  op: "I" | "U" | "D"
  changedCols: string[]
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
  actorKind: AuthorKind
}

export interface RevisionDraft {
  typeKey: string
  objectId: string
  fieldKey: string | null
  op: "create" | "update" | "delete"
  value: unknown
  prevValue: unknown
  schemaVersion: number
  authorKind: AuthorKind
  changeId: bigint
}

/** 색인 글에 넣지 않는 칸 — 사람이 찾지 않는 기술 값 · 다른 행 ID */
const NOT_INDEXED = new Set(["dedupe_key", "external_key"])
const INDEX_MAX = 4000

const ymd = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
const won = (v: unknown) => `${Number(v).toLocaleString("ko-KR")}원`

/** 칼럼 값 → 공통 층 값. 고르기 칸은 기존 값(GRANT)을 선택지 키(grant)로 바꾼다. 모르는 기존 값은 그대로 둔다 */
export function toFieldValue(f: FieldDef, raw: unknown, sets: ReadonlyMap<string, OptionSetDef>): unknown {
  if (raw === null || raw === undefined) return null
  if (f.dataType === "option" && f.optionSetKey) {
    const o = sets.get(f.optionSetKey)?.options.find((x) => x.legacyValue === raw)
    return o ? o.key : raw
  }
  if (f.dataType === "money_krw") return typeof raw === "bigint" ? raw.toString() : raw
  return raw instanceof Date ? raw.toISOString() : raw
}

/** 값 하나를 사람이 읽는 글로 — 색인용 */
function displayValue(f: FieldDef, raw: unknown, sets: ReadonlyMap<string, OptionSetDef>): string | null {
  if (raw === null || raw === undefined || raw === "") return null
  switch (f.dataType) {
    case "option": {
      const o = f.optionSetKey ? sets.get(f.optionSetKey)?.options.find((x) => x.legacyValue === raw) : undefined
      return o ? o.label : String(raw)
    }
    case "date":
      return ymd(raw)
    case "datetime":
      return raw instanceof Date ? raw.toISOString() : String(raw)
    case "money_krw":
      return won(raw)
    case "bool":
      return raw ? "예" : "아니오"
    case "ref":
    case "person":
    case "file":
      return null
    default:
      return String(raw)
  }
}

/** 한 행의 색인 글 — 「유형: 제목」 다음 줄마다 「칸 이름: 값」. 빈 칸 · ID 칸은 뺀다 */
export function indexTextOf(def: TypeDef, row: Record<string, unknown>, sets: ReadonlyMap<string, OptionSetDef>): { title: string; content: string } {
  const titleField = def.fields.find((f) => f.frame === "title")
  const title = String((titleField?.column && row[titleField.column]) ?? "")
  const lines: string[] = []
  for (const f of def.fields) {
    if (f === titleField || NOT_INDEXED.has(f.key) || !f.column) continue
    const v = displayValue(f, row[f.column], sets)
    if (v !== null) lines.push(`${f.label}: ${v}`)
  }
  const content = [`${def.label}: ${title}`, ...lines].join("\n").slice(0, INDEX_MAX)
  return { title: `${def.label} · ${title}`.slice(0, 300), content }
}

/** 한 행의 공개 범위 토큰(§2-4) — column 이면 visibility 칸(INTERNAL → internal), 그 밖은 유형의 고정 범위 */
export function visibilityOf(def: TypeDef, row: Record<string, unknown>): string[] {
  if (def.visibilityPolicy === "column") {
    const f = def.fields.find((x) => x.frame === "visibility")
    return f?.column && row[f.column] === "INTERNAL" ? ["internal"] : []
  }
  return [...(def.visibilityFixed ?? [])].sort()
}

/** 칼럼 → 칸 키로 바꾼 행 조각(등록된 칸만) */
function mapRow(def: TypeDef, values: Record<string, unknown> | null, sets: ReadonlyMap<string, OptionSetDef>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!values) return out
  for (const f of def.fields) if (f.column && f.column in values) out[f.key] = toFieldValue(f, values[f.column], sets)
  return out
}

/**
 * 변경 한 줄 → 값 이력 초안. U 는 바뀐 칼럼 중 등록된 칸마다 한 줄, I · D 는 대상 전체 한 줄(fieldKey null).
 * 등록되지 않은 칼럼만 바뀐 U 는 이력을 남기지 않는다(색인만 다시 본다).
 */
export function revisionsOf(
  def: TypeDef,
  rowId: string,
  ch: ChangeRow,
  schemaVersion: number,
  sets: ReadonlyMap<string, OptionSetDef>
): RevisionDraft[] {
  const base = { typeKey: def.key, objectId: rowId, schemaVersion, authorKind: ch.actorKind, changeId: ch.id }
  if (ch.op === "I") return [{ ...base, fieldKey: null, op: "create", value: mapRow(def, ch.newValues, sets), prevValue: null }]
  if (ch.op === "D") return [{ ...base, fieldKey: null, op: "delete", value: null, prevValue: mapRow(def, ch.oldValues, sets) }]
  const out: RevisionDraft[] = []
  for (const col of ch.changedCols) {
    const f = def.fields.find((x) => x.column === col)
    if (!f) continue
    out.push({
      ...base,
      fieldKey: f.key,
      op: "update",
      value: toFieldValue(f, ch.newValues?.[col], sets),
      prevValue: toFieldValue(f, ch.oldValues?.[col], sets),
    })
  }
  return out
}

/** 등록 유형의 OBJECT 조각 sourceId */
export const objectSourceId = (typeKey: string, id: string) => `${typeKey}:${id}`

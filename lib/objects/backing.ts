// 「테이블에 기대는 유형」 의 칼럼 매핑을 Prisma 데이터 모델(DMMF)과 대조한다.
// DMMF 를 인자로 받는다 — 이 파일은 prisma 를 들이지 않는다. 시험이 생성된 클라이언트의 Prisma.dmmf 를 넘긴다.
// 매핑한 칼럼을 지우거나 타입을 바꾸는 마이그레이션은 이 검사에서 걸린다(계획 §2-2).
import type { DataType, FieldDef, OptionSetDef, TypeDef } from "./define"

/** Prisma DMMF 에서 쓰는 부분만 */
export interface DmmfField {
  readonly name: string
  readonly kind: string // scalar | enum | object | unsupported
  readonly type: string
  readonly isRequired: boolean
  readonly isList: boolean
  readonly hasDefaultValue: boolean
  readonly relationFromFields?: readonly string[]
}
export interface DmmfModel {
  readonly name: string
  readonly fields: readonly DmmfField[]
}
export interface DmmfEnum {
  readonly name: string
  readonly values: readonly { readonly name: string }[]
}
export interface Datamodel {
  readonly models: readonly DmmfModel[]
  readonly enums: readonly DmmfEnum[]
}

/** 칸 타입마다 받을 수 있는 Prisma 스칼라 타입(option 은 enum 도 받는다) */
const SCALARS: Record<DataType, readonly string[]> = {
  text: ["String"],
  longtext: ["String"],
  url: ["String"],
  number: ["Int", "Float", "Decimal"],
  money_krw: ["BigInt"],
  date: ["DateTime"],
  datetime: ["DateTime"],
  bool: ["Boolean"],
  option: ["String"],
  multi_option: ["String"],
  ref: ["String"],
  person: ["String"],
  file: ["String"],
}

/** "public.CompanyRecord" → 모델 이름. ip 스키마는 Prisma 밖이라 null */
export function backingModel(backing: string): string | null {
  const [schema, table] = backing.split(".")
  return schema === "public" ? table : null
}

function checkField(
  at: string,
  f: FieldDef,
  model: DmmfModel,
  dm: Datamodel,
  optionSets: ReadonlyMap<string, OptionSetDef>,
  modelOf: (typeKey: string) => string | null
): string[] {
  const errs: string[] = []
  const col = model.fields.find((x) => x.name === f.column)
  if (!col) return [`${at}: ${model.name} 에 칼럼 ${f.column} 이 없다`]
  if (col.kind === "object" || col.kind === "unsupported") return [`${at}: ${f.column} 은 값 칼럼이 아니다(${col.kind})`]

  const wantList = f.dataType === "multi_option" || (f.dataType === "file" && !!f.fileRule?.multiple)
  if (col.isList !== wantList) errs.push(`${at}: ${f.column} 목록 여부가 다르다(칼럼 ${col.isList ? "목록" : "하나"})`)

  if (col.kind === "enum") {
    if (f.dataType !== "option" && f.dataType !== "multi_option")
      errs.push(`${at}: ${f.column} 은 enum ${col.type} 인데 칸 타입이 ${f.dataType}`)
    else {
      const en = dm.enums.find((e) => e.name === col.type)
      const set = f.optionSetKey ? optionSets.get(f.optionSetKey) : undefined
      if (en && set) {
        const a = [...en.values.map((v) => v.name)].sort()
        const b = set.options.map((o) => o.legacyValue ?? "").sort()
        if (a.join() !== b.join()) errs.push(`${at}: 선택지 ${set.key} 의 기존 값이 enum ${en.name} 과 다르다 (${b.join(",")} ≠ ${a.join(",")})`)
      }
    }
  } else {
    if (!SCALARS[f.dataType].includes(col.type))
      errs.push(`${at}: ${f.column} 은 ${col.type} 인데 칸 타입 ${f.dataType} 은 ${SCALARS[f.dataType].join("/")} 을 받는다`)
    if (f.dataType === "option" || f.dataType === "multi_option") {
      const set = f.optionSetKey ? optionSets.get(f.optionSetKey) : undefined
      if (set?.options.some((o) => o.legacyValue === undefined))
        errs.push(`${at}: text 칼럼에 기대는 선택지 ${set.key} 는 모든 선택지에 legacyValue 가 있어야 한다`)
    }
  }

  if (f.required && !col.isRequired) errs.push(`${at}: 필수 칸인데 ${f.column} 은 비어 있을 수 있다`)
  if (col.isRequired && !col.hasDefaultValue && !f.required && !f.readOnly)
    errs.push(`${at}: ${f.column} 은 비울 수 없는데 칸이 필수도 읽기 전용도 아니다`)

  if (f.dataType === "ref" || f.dataType === "person") {
    const rel = model.fields.find((x) => x.kind === "object" && x.relationFromFields?.includes(f.column!))
    if (!rel) errs.push(`${at}: ${f.column} 은 외래키가 아니다`)
    else {
      const target = f.dataType === "person" ? "User" : f.refTypeKey ? modelOf(f.refTypeKey) : null
      if (target && rel.type !== target) errs.push(`${at}: ${f.column} 은 ${rel.type} 를 가리키는데 칸은 ${target}`)
    }
  }
  return errs
}

/**
 * table · ledger 유형의 매핑 검사. ip 스키마 유형은 Prisma 밖이라 여기서 보지 않는다(빈 배열).
 * modelOf: 유형 키 → 기대는 Prisma 모델(등록 예정 유형도). 모르면 null — 그때는 외래키 여부만 본다.
 */
export function checkBacking(
  def: TypeDef,
  dm: Datamodel,
  optionSets: ReadonlyMap<string, OptionSetDef>,
  modelOf: (typeKey: string) => string | null
): string[] {
  if (def.storage === "generic" || !def.backing) return []
  const name = backingModel(def.backing)
  if (!name) return []
  const model = dm.models.find((m) => m.name === name)
  if (!model) return [`${def.key}: Prisma 모델 ${name} 이 없다`]
  const errs: string[] = []
  for (const f of def.fields) if (f.column) errs.push(...checkField(`${def.key}.${f.key}`, f, model, dm, optionSets, modelOf))
  for (const l of def.links ?? []) {
    const [how, what] = l.via.split(":")
    if (how === "column") {
      const rel = model.fields.find((x) => x.kind === "object" && x.relationFromFields?.includes(what))
      if (!rel) errs.push(`${def.key}.${l.key}: ${what} 은 외래키가 아니다`)
    } else if (!dm.models.some((m) => m.name === what)) errs.push(`${def.key}.${l.key}: 연결 표 ${what} 이 없다`)
  }
  return errs
}

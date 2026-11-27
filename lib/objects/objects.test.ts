/**
 * 공통 층 유형 레지스트리 — 키 형식 · 정의 규칙 · Prisma 스키마(DMMF) 대조 · 선택지 · Action 도구 이름.
 * 통과 사례만 두지 않는다: 규칙마다 거부되어야 하는 정의를 함께 넣는다.
 * 계획: mydocs/plans/2026-11-27-ontology-phase1.md. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@/generated/prisma/client"
import { TOOL_POLICY } from "../tools/registry"
import { GRANT_STAGE_LABEL, GRANT_STAGES } from "../grants-labels"
import { RECORD_KIND_LABEL, RECORD_VISIBILITY_LABEL } from "../schemas/company"
import { ORG_TYPE_LABEL } from "../crm"
import {
  checkOptionSet,
  checkTypeDef,
  defineType,
  isValidKey,
  type FieldDef,
  type TypeDef,
} from "./define"
import { backingModel, checkBacking, type Datamodel } from "./backing"
import { OPTION_SETS } from "./options"
import {
  OBJECT_TYPES,
  OPTION_SET_MAP,
  PLANNED_TYPES,
  backingOf,
  fromLegacyOption,
  toLegacyOption,
} from "./index"

const DM = Prisma.dmmf.datamodel as unknown as Datamodel
const TYPE_KEYS = new Set([...OBJECT_TYPES.map((t) => t.key), ...Object.keys(PLANNED_TYPES)])
const CTX = { optionSets: OPTION_SET_MAP, typeKeys: TYPE_KEYS }
const modelOf = (k: string) => {
  const b = backingOf(k)
  return b ? backingModel(b) : null
}
const backingErrs = (def: TypeDef) => checkBacking(def, DM, OPTION_SET_MAP, modelOf)

/** 시험용 최소 정의 — 한 곳만 바꿔 거부를 본다 */
const base = (over: Partial<TypeDef> = {}, fields?: FieldDef[]): TypeDef =>
  defineType({
    key: "sample_type",
    label: "시험",
    storage: "table",
    backing: "public.CompanyRecord",
    llmDescription: "시험용",
    examples: [{ text: "예시" }],
    visibilityPolicy: "inherit",
    fields: fields ?? [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title", required: true },
      { key: "kind", label: "종류", dataType: "option", optionSetKey: "record_kind", column: "kind", required: true },
      { key: "dedupe_key", label: "키", dataType: "text", column: "dedupeKey", readOnly: true },
      { key: "source", label: "출처", dataType: "text", column: "source", readOnly: true },
    ],
    actions: [],
    ...over,
  })

// ─── 키 형식 ───

test("키 형식 — 통과와 거부", () => {
  for (const ok of ["record", "grant_decision", "c_agreement", "a1", "x_" + "y".repeat(37)]) assert.ok(isValidKey(ok), ok)
  for (const bad of ["", "r", "Record", "1record", "_record", "grant-decision", "레코드", "a b", "x".repeat(41)])
    assert.ok(!isValidKey(bad), bad)
})

test("등록 유형 · 칸 · 선택지 · Action 키가 형식에 맞고 겹치지 않는다", () => {
  const typeKeys = OBJECT_TYPES.map((t) => t.key)
  assert.equal(new Set(typeKeys).size, typeKeys.length)
  for (const k of typeKeys) assert.ok(!(k in PLANNED_TYPES), `${k}: 등록했으면 PLANNED_TYPES 에서 뺀다`)
  for (const k of Object.keys(PLANNED_TYPES)) assert.ok(isValidKey(k), k)
  const setKeys = OPTION_SETS.map((s) => s.key)
  assert.equal(new Set(setKeys).size, setKeys.length)
})

test("c_ 접두어 — 제품 기본 유형은 못 쓰고, 회사가 만든 유형은 반드시 쓴다", () => {
  assert.match(checkTypeDef(base({ key: "c_agreement" }), CTX).join("\n"), /제품 기본 유형은 c_/)
  assert.match(checkTypeDef(base({ key: "agreement", origin: "company" }), CTX).join("\n"), /회사가 만든 유형은 c_/)
  assert.deepEqual(checkTypeDef(base({ key: "c_agreement", origin: "company" }), CTX), [])
  for (const t of OBJECT_TYPES) assert.equal(t.origin, "product")
})

// ─── 등록 유형 정의 ───

test("등록 유형 세 개가 정의 규칙을 지난다", () => {
  assert.deepEqual(OBJECT_TYPES.map((t) => t.key), ["record", "grant_decision", "org"])
  for (const t of OBJECT_TYPES) assert.deepEqual(checkTypeDef(t, CTX), [], t.key)
})

test("선택지 묶음이 규칙을 지난다", () => {
  for (const s of OPTION_SETS) assert.deepEqual(checkOptionSet(s), [], s.key)
  assert.match(checkOptionSet({ key: "x_set", label: "x", options: [{ key: "a1", label: "a" }, { key: "a1", label: "b" }] }).join(), /중복/)
  assert.match(checkOptionSet({ key: "x_set", label: "x", options: [{ key: "A", label: "a" }] }).join(), /형식/)
  assert.match(
    checkOptionSet({ key: "x_set", label: "x", options: [{ key: "a1", label: "a", legacyValue: "A" }, { key: "b1", label: "b", legacyValue: "A" }] }).join(),
    /기존 값 중복/
  )
})

test("정의 규칙 — 거부되어야 하는 정의", () => {
  const cases: [string, TypeDef, RegExp][] = [
    ["설명 없음", base({ llmDescription: " " }), /llmDescription/],
    ["예시 없음", base({ examples: [] }), /예시/],
    ["table 인데 backing 없음", base({ backing: undefined }), /backing/],
    ["title 틀 칸 없음", base({}, [{ key: "kind", label: "종류", dataType: "option", optionSetKey: "record_kind", column: "kind" }]), /title 틀 칸/],
    ["칸 키 중복", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title" },
      { key: "title", label: "또", dataType: "text", column: "note" },
    ]), /칸 키 중복/],
    ["칼럼 두 번", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title" },
      { key: "title2", label: "또", dataType: "text", column: "title" },
    ]), /두 칸이 쓴다/],
    ["없는 선택지 묶음", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title" },
      { key: "kind", label: "종류", dataType: "option", optionSetKey: "nope", column: "kind" },
    ]), /없는 선택지 묶음/],
    ["모르는 유형 ref", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title" },
      { key: "p", label: "p", dataType: "ref", refTypeKey: "spaceship", column: "projectId" },
    ]), /모르는 유형/],
    ["file 칸에 fileRule 없음", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title" },
      { key: "doc", label: "문서", dataType: "file", column: "note" },
    ]), /fileRule/],
    ["file 받을 종류 형식", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title" },
      { key: "doc", label: "문서", dataType: "file", fileRule: { multiple: false, accept: ["pdf"] }, column: "note" },
    ]), /받을 종류 형식/],
    ["file 아닌 칸에 fileRule", base({}, [
      { key: "title", label: "제목", dataType: "text", frame: "title", column: "title", fileRule: { multiple: false, accept: ["image/*"] } },
    ]), /file 칸이 아닌데/],
    ["generic 에 금액 칸", base({ storage: "generic", backing: undefined }, [
      { key: "title", label: "제목", dataType: "text", frame: "title" },
      { key: "price", label: "금액", dataType: "money_krw" },
    ]), /금액 칸은 generic/],
    ["column 정책인데 visibility 칸 없음", base({ visibilityPolicy: "column" }), /visibility 틀 칸/],
    ["지우기인데 destructive 아님", base({ actions: [{ key: "del", label: "지우기", kind: "delete", tool: "delete_company_record", risk: "write" }] }), /destructive/],
    ["장부 쓰기 risk write", base({ storage: "ledger", actions: [{ key: "save", label: "저장", kind: "create", tool: "record_stock", risk: "write" }] }), /장부 쓰기/],
  ]
  for (const [name, def, re] of cases) assert.match(checkTypeDef(def, CTX).join("\n"), re, name)
})

test("file · url 칸 — 받을 수 있는 정의", () => {
  const def = base({ storage: "generic", backing: undefined, key: "c_agreement", origin: "company" }, [
    { key: "title", label: "이름", dataType: "text", frame: "title" },
    { key: "contract", label: "계약서", dataType: "file", fileRule: { multiple: true, accept: ["application/pdf", "image/*"] } },
    { key: "homepage", label: "링크", dataType: "url" },
  ])
  assert.deepEqual(checkTypeDef(def, CTX), [])
})

// ─── Prisma 스키마(DMMF) 대조 ───

test("DMMF — 등록 유형의 칼럼 매핑이 Prisma 스키마와 맞는다", () => {
  for (const t of OBJECT_TYPES) assert.deepEqual(backingErrs(t), [], t.key)
})

test("DMMF — 등록 예정 유형의 기대는 Prisma 모델이 있다", () => {
  for (const [k, b] of Object.entries(PLANNED_TYPES)) {
    const m = backingModel(b)
    if (m) assert.ok(DM.models.some((x) => x.name === m), `${k}: ${m}`)
  }
})

test("DMMF — 거부되어야 하는 매핑", () => {
  const withField = (f: FieldDef) => base({}, [...base().fields, f])
  const cases: [string, TypeDef, RegExp][] = [
    ["없는 칼럼", withField({ key: "x1", label: "x", dataType: "text", column: "noSuchColumn" }), /칼럼 noSuchColumn 이 없다/],
    ["관계 필드를 칼럼으로", withField({ key: "x1", label: "x", dataType: "text", column: "project" }), /값 칼럼이 아니다/],
    ["금액을 String 칼럼에", withField({ key: "x1", label: "x", dataType: "money_krw", column: "note" }), /BigInt/],
    ["날짜를 String 칼럼에", withField({ key: "x1", label: "x", dataType: "date", column: "note" }), /DateTime/],
    ["text 를 BigInt 칼럼에", withField({ key: "x1", label: "x", dataType: "text", column: "fundingKrw" }), /String/],
    ["enum 칼럼을 text 칸으로", withField({ key: "x1", label: "x", dataType: "text", column: "visibility" }), /enum RecordVisibility/],
    ["enum 값과 다른 선택지", withField({ key: "x1", label: "x", dataType: "option", optionSetKey: "grant_stage", column: "visibility" }), /enum RecordVisibility 과 다르다/],
    ["필수인데 nullable", withField({ key: "x1", label: "x", dataType: "text", column: "organizer", required: true }), /비어 있을 수 있다/],
    ["ref 칼럼이 외래키 아님", withField({ key: "x1", label: "x", dataType: "ref", refTypeKey: "project", column: "organizer" }), /외래키가 아니다/],
    ["ref 대상 모델이 다름", withField({ key: "x1", label: "x", dataType: "ref", refTypeKey: "task", column: "projectId" }), /Project 를 가리키는데 칸은 Task/],
    ["file 여러 개인데 칼럼 하나", withField({ key: "x1", label: "x", dataType: "file", fileRule: { multiple: true, accept: ["image/*"] }, column: "note" }), /목록 여부/],
    ["url 을 DateTime 칼럼에", withField({ key: "x1", label: "x", dataType: "url", column: "startsOn" }), /String/],
    ["없는 연결 표", base({ links: [{ key: "owners", label: "담당", toType: "member", via: "table:NoSuchTable" }] }), /연결 표 NoSuchTable/],
  ]
  for (const [name, def, re] of cases) assert.match(backingErrs(def).join("\n"), re, name)

  // 비울 수 없는 칼럼(kind · title · dedupeKey · source)을 칸이 「필수도 읽기 전용도 아님」 으로 두면 거부
  const loose = base({}, base().fields.map((f) => (f.key === "source" ? { ...f, readOnly: false } : f)))
  assert.match(backingErrs(loose).join("\n"), /source 은 비울 수 없는데/)
  assert.match(backingErrs(base({ backing: "public.NoSuchModel" })).join(), /Prisma 모델 NoSuchModel 이 없다/)
})

test("DMMF — 비울 수 없는 칼럼은 빠짐없이 칸이 있거나 기본값이 있다", () => {
  for (const t of OBJECT_TYPES) {
    const model = DM.models.find((m) => m.name === backingModel(t.backing!))!
    const mapped = new Set(t.fields.map((f) => f.column))
    const missing = model.fields
      .filter((f) => f.kind !== "object" && f.isRequired && !f.hasDefaultValue && !f.isList && !mapped.has(f.name))
      .filter((f) => f.name !== "id" && f.name !== "updatedAt")
      .map((f) => f.name)
    assert.deepEqual(missing, [], t.key)
  }
})

// ─── 선택지 매핑 ───

test("선택지 — 화면 이름표 · 기존 값 목록과 같다", () => {
  const same = (setKey: string, labels: Record<string, string>) => {
    const set = OPTION_SET_MAP.get(setKey)!
    assert.deepEqual(Object.fromEntries(set.options.map((o) => [o.legacyValue, o.label])), labels, setKey)
  }
  same("record_kind", RECORD_KIND_LABEL)
  same("record_visibility", RECORD_VISIBILITY_LABEL)
  same("grant_stage", GRANT_STAGE_LABEL)
  same("org_type", ORG_TYPE_LABEL)
  // 국가과제 상태는 text + CHECK — 순서까지 화면과 같다
  assert.deepEqual(OPTION_SET_MAP.get("grant_stage")!.options.map((o) => o.legacyValue), GRANT_STAGES)
  // 선택지 키는 기존 값의 소문자
  for (const s of OPTION_SETS) for (const o of s.options) assert.equal(o.key, o.legacyValue!.toLowerCase(), `${s.key}.${o.key}`)
})

test("선택지 — 키 ↔ 기존 값 바꾸기", () => {
  assert.equal(toLegacyOption("record_kind", "grant"), "GRANT")
  assert.equal(fromLegacyOption("grant_stage", "IN_PROGRESS"), "in_progress")
  assert.equal(toLegacyOption("record_kind", "nope"), undefined)
  assert.equal(fromLegacyOption("nope", "GRANT"), undefined)
})

// ─── Action ───

test("Action — 기존 도구 이름만 쓰고, 그 도구는 쓰기 도구다", () => {
  for (const t of OBJECT_TYPES)
    for (const a of t.actions) {
      const p = TOOL_POLICY[a.tool]
      assert.ok(p, `${t.key}.${a.key}: ${a.tool} 가 레지스트리에 없다`)
      assert.equal(p.agent, "write", `${t.key}.${a.key}: ${a.tool} 는 쓰기 도구가 아니다`)
      assert.ok(p.confirm, `${t.key}.${a.key}: ${a.tool} 에 확인 절차가 없다`)
    }
  assert.deepEqual(
    Object.fromEntries(OBJECT_TYPES.map((t) => [t.key, t.actions.map((a) => a.tool)])),
    {
      record: ["save_company_record", "delete_company_record"],
      grant_decision: ["add_grant_decision", "update_grant_decision", "remove_grant_decision"],
      org: ["create_org", "update_org"],
    }
  )
})

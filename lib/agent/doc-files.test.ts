/** 파일 만들기 · 다시 열어 검증 · 실패면 지우기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import JSZip from "jszip"

import {
  FileSpecSchema, LIMITS, buildFile, expectOf, markdownBlocks, safeFileName, sheetNames, specProblem, specShape, storeVerified, verifyOfficeFile,
  type StoreOps,
} from "./doc-files"

const DOCX = FileSpecSchema.parse({
  format: "docx", file_name: "10월 보고서", title: "10월 업무 보고",
  body: "# 요약\n- 완료 **3건**\n- 진행 2건\n\n| 업무 | 상태 |\n|---|---|\n| 견적 | 완료 |\n\n특수문자 & < > 도 그대로",
})
const XLSX_SPEC = FileSpecSchema.parse({
  format: "xlsx", file_name: "재고", sheets: [{ name: "재고", rows: [["품목", "수량"], ["애드젤", 12], ["라이브젤", 3]] }, { name: "요약/합계", rows: [["합계", 15]] }],
})
const PPTX = FileSpecSchema.parse({
  format: "pptx", file_name: "발표", title: "옴니스 소개", subtitle: "사내 지식 에이전트",
  slides: [{ title: "왜", bullets: ["대화가 지식이 된다"] }, { title: "어떻게" }],
})

test("docx · xlsx · pptx 를 만들고 다시 열면 통과한다", async () => {
  const d = await verifyOfficeFile(await buildFile(DOCX), expectOf(DOCX))
  assert.ok(d.xmlParts >= 5)
  const x = await verifyOfficeFile(await buildFile(XLSX_SPEC), expectOf(XLSX_SPEC))
  assert.deepEqual(x.sheets, ["재고", "요약 합계"])
  const p = await verifyOfficeFile(await buildFile(PPTX), expectOf(PPTX))
  assert.equal(p.slides, 3) // 표지 + 2
})

test("zip 이 아니거나 잘린 파일은 거부한다 (거부되어야 하는 경우)", async () => {
  const buf = await buildFile(DOCX)
  await assert.rejects(verifyOfficeFile(Buffer.from("not a zip at all, plain text"), expectOf(DOCX)), /zip 파일이 아닙니다/)
  await assert.rejects(verifyOfficeFile(buf.subarray(0, Math.floor(buf.length / 2)), expectOf(DOCX)), /zip/)
})

test("안의 XML 이 깨졌으면 거부한다 (거부되어야 하는 경우)", async () => {
  const zip = await JSZip.loadAsync(await buildFile(DOCX))
  zip.file("word/document.xml", "<w:document><w:body><w:p></w:body>")
  const broken = await zip.generateAsync({ type: "nodebuffer" })
  await assert.rejects(verifyOfficeFile(broken, expectOf(DOCX)), /XML 이 깨졌습니다: word\/document\.xml/)
})

test("필수 부품이 없으면 거부한다 — 형식이 다른 파일 (거부되어야 하는 경우)", async () => {
  // xlsx 를 docx 로 검증
  await assert.rejects(verifyOfficeFile(await buildFile(XLSX_SPEC), expectOf(DOCX)), /필수 부품 word\/document\.xml/)
})

test("시트 · 슬라이드 수 · 제목이 요청과 다르면 거부한다 (거부되어야 하는 경우)", async () => {
  await assert.rejects(verifyOfficeFile(await buildFile(XLSX_SPEC), { format: "xlsx", sheets: ["재고"] }), /시트가 요청과 다릅니다/)
  await assert.rejects(verifyOfficeFile(await buildFile(PPTX), { format: "pptx", slides: 5 }), /슬라이드가 요청과 다릅니다/)
  await assert.rejects(verifyOfficeFile(await buildFile(DOCX), { format: "docx", text: "없는 제목" }), /제목을 찾지 못했습니다/)
})

/** 메모리 저장소 — 실패를 끼워 넣을 수 있다 */
function memoryStore(opts: { corrupt?: (b: Buffer) => Buffer; failPut?: boolean } = {}) {
  const files = new Map<string, Buffer>()
  const deleted: string[] = []
  const ops: StoreOps = {
    put: async (k, b) => {
      if (opts.failPut) throw new Error("NAS 업로드 실패")
      files.set(k, opts.corrupt ? opts.corrupt(b) : b)
    },
    get: async (k) => {
      const b = files.get(k)
      if (!b) throw new Error("없음")
      return b
    },
    del: async (k) => {
      deleted.push(k)
      files.delete(k)
    },
  }
  return { ops, files, deleted }
}

test("저장 → 다시 읽어 같으면 남기고 지우지 않는다", async () => {
  const m = memoryStore()
  const buf = await buildFile(XLSX_SPEC)
  const v = await storeVerified(m.ops, "a.xlsx", buf, "x", expectOf(XLSX_SPEC))
  assert.equal(v.bytes, buf.length)
  assert.equal(m.files.size, 1)
  assert.deepEqual(m.deleted, [])
})

test("저장하다 끝에 0 바이트가 붙으면(NAS 에서 실제로 있었던 일) 지우고 실패한다 (거부되어야 하는 경우)", async () => {
  const m = memoryStore({ corrupt: (b) => Buffer.concat([b, Buffer.alloc(512)]) })
  await assert.rejects(storeVerified(m.ops, "b.docx", await buildFile(DOCX), "x", expectOf(DOCX)), /원본과 다릅니다/)
  assert.deepEqual(m.deleted, ["b.docx"])
  assert.equal(m.files.size, 0)
})

test("저장하다 잘리면 지우고 실패한다 (거부되어야 하는 경우)", async () => {
  const m = memoryStore({ corrupt: (b) => b.subarray(0, b.length - 100) })
  await assert.rejects(storeVerified(m.ops, "c.pptx", await buildFile(PPTX), "x", expectOf(PPTX)))
  assert.deepEqual(m.deleted, ["c.pptx"])
})

test("만든 직후 검증에 실패하면 저장하지 않는다 — 저장소를 건드리지 않는다", async () => {
  const m = memoryStore()
  await assert.rejects(storeVerified(m.ops, "d.docx", Buffer.from("garbage"), "x", expectOf(DOCX)))
  assert.equal(m.files.size, 0)
})

test("업로드가 실패해도 반쪽을 남기지 않게 지우기를 시도한다", async () => {
  const m = memoryStore({ failPut: true })
  await assert.rejects(storeVerified(m.ops, "e.docx", await buildFile(DOCX), "x", expectOf(DOCX)), /NAS 업로드 실패/)
  assert.deepEqual(m.deleted, ["e.docx"])
})

test("파일 이름 — 경로 · 금지 문자를 걷고 확장자를 형식에 맞춘다", () => {
  assert.equal(safeFileName("../../etc/passwd", "docx"), "etc passwd.docx")
  assert.equal(safeFileName("보고서.xlsx", "docx"), "보고서.docx")
  assert.equal(safeFileName('a:b*c?"d<e>f|g', "pptx"), "a b c d e f g.pptx")
  assert.equal(safeFileName("   ", "xlsx"), "옴니스 문서.xlsx")
  assert.ok(safeFileName("가".repeat(300), "docx").length <= 85)
})

test("시트 이름 — 31자 · 금지 문자 · 겹침", () => {
  assert.deepEqual(sheetNames(["a/b", "A/B", "x".repeat(40), ""]), ["a b", "A B(2)", "x".repeat(31), "시트4"])
})

test("마크다운 — 제목 · 목록 · 번호 · 표 · 문단", () => {
  const b = markdownBlocks("# 큰 제목\n문단 한 줄\n둘째 줄\n\n- 가\n1. 첫째\n| a | b |\n|---|---|\n| 1 | 2 |\n#### 깊은 제목")
  assert.deepEqual(b.map((x) => x.type), ["heading", "paragraph", "bullet", "numbered", "table", "heading"])
  assert.deepEqual((b[4] as { rows: string[][] }).rows, [["a", "b"], ["1", "2"]])
  assert.equal((b[5] as { level: number }).level, 3)
})

test("크기 한도를 넘는 요청은 카드에서 막는다 (거부되어야 하는 경우)", () => {
  const rows = Array.from({ length: LIMITS.rows + 1 }, (_, i) => [i])
  assert.match(specProblem({ format: "xlsx", file_name: "t", sheets: [{ name: "s", rows }] }) ?? "", /형식에 맞지 않습니다/)
  assert.match(specProblem({ format: "pptx", file_name: "t", title: "t", slides: [] }) ?? "", /slides/)
  assert.match(specProblem({ format: "hwp", file_name: "t" }) ?? "", /형식에 맞지 않습니다/)
  assert.equal(specProblem(XLSX_SPEC), null)
  assert.equal(specShape(XLSX_SPEC), "시트 2개(재고 3행 · 요약 합계 1행)")
})

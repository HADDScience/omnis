/** 면접자료 PDF — 가짜 지원서 · 가짜 PDF 로 쪽수와 책갈피를 본다. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib"
import { buildApplicantPack, buildBundle, canPack, readOutline, wrap, type PackApplicant, type PackFonts } from "./interview-pack"

const dir = join(process.cwd(), "assets/fonts")
const fonts: PackFonts = {
  regular: readFileSync(join(dir, "NanumSquare_acR.ttf")),
  bold: readFileSync(join(dir, "NanumSquare_acB.ttf")),
  extraBold: readFileSync(join(dir, "NanumSquare_acEB.ttf")),
}

async function fakePdf(pages: number) {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText(`fake page ${i + 1}`, { x: 50, y: 780, size: 20, font: f })
  return d.save()
}

const who = (n: number, over: Partial<PackApplicant> = {}): PackApplicant => ({
  id: `a${n}`, code: `APP990101-00${n}`, name: ["김시험", "이예시"][n - 1] ?? "박가상", department: "생명과학과", studentId: "20230001",
  grade: "3", graduation: "2028년 2월", phone: "010-0000-0000", email: `fake${n}@example.invalid`, portfolioUrl: null,
  interests: ["ai-bio", "grants"], motivation: "시험용 지원 동기입니다. ".repeat(20), receivedAt: new Date("2026-11-25T05:03:00Z"), ...over,
})

test("단계 — 서류 합격(면접) · 합격 통보 · 최종 합격만", () => {
  assert.deepEqual(["RECEIVED", "SCREENING", "INTERVIEW", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN"].map(canPack), [false, false, true, true, true, false, false])
})

test("지원자 한 명 — 요약 1쪽 + 이력서 + 포트폴리오, 책갈피 셋", async () => {
  const r = await buildApplicantPack(
    { applicant: who(1), files: [
      { label: "이력서", fileName: "resume.pdf", size: 120_000, bytes: await fakePdf(2) },
      { label: "포트폴리오", fileName: "portfolio.pdf", size: 600_000, bytes: await fakePdf(3) },
    ] },
    "[시험용] 바이오 연구 인턴", fonts,
  )
  assert.equal(r.pages, 6)
  const doc = await PDFDocument.load(r.bytes)
  assert.equal(doc.getPageCount(), 6)
  assert.deepEqual(readOutline(doc), [
    { title: "지원서 요약", page: 0 },
    { title: "이력서", page: 1 },
    { title: "포트폴리오", page: 3 },
  ])
  assert.equal(doc.getTitle(), "면접 자료 — 김시험 (APP990101-001)")
})

test("못 넣는 것 — 깨진 PDF · 못 읽은 파일 · 링크는 요약 장에만, 쪽은 늘지 않는다. 긴 지원 동기도 한 쪽", async () => {
  const r = await buildApplicantPack(
    { applicant: who(2, { portfolioUrl: "https://github.com/example/repo", motivation: "길게 쓴 지원 동기 ".repeat(200), interests: ["ai-bio", "dev", "grants", "unknown-track"] }), files: [
      { label: "이력서", fileName: "broken.pdf", size: 10, bytes: new TextEncoder().encode("not a pdf") },
      { label: "포트폴리오", fileName: "lost.pdf", size: 10, bytes: null, reason: "저장소(NAS)에서 파일을 읽지 못함" },
    ] },
    "[시험용] 바이오 연구 인턴", fonts,
  )
  assert.equal(r.pages, 1)
  assert.deepEqual(readOutline(await PDFDocument.load(r.bytes)), [{ title: "지원서 요약", page: 0 }])
})

test("묶음 — 표지 + 지원자별, 책갈피는 표지 · 지원자(아래에 문서)", async () => {
  const r = await buildBundle(
    [
      { applicant: who(1), files: [{ label: "이력서", fileName: "a.pdf", size: 1, bytes: await fakePdf(1) }, { label: "포트폴리오", fileName: "b.pdf", size: 1, bytes: await fakePdf(1) }] },
      { applicant: who(2), files: [{ label: "이력서", fileName: "c.pdf", size: 1, bytes: await fakePdf(5) }, { label: "포트폴리오", fileName: "d.pdf", size: 1, bytes: await fakePdf(2) }] },
    ],
    "[시험용] 바이오 연구 인턴", fonts, new Date("2026-11-26T03:00:00Z"),
  )
  assert.equal(r.pages, 1 + 3 + 8)
  assert.deepEqual(readOutline(await PDFDocument.load(r.bytes)), [
    { title: "표지", page: 0 },
    { title: "김시험 (APP990101-001)", page: 1, children: [{ title: "지원서 요약", page: 1 }, { title: "이력서", page: 2 }, { title: "포트폴리오", page: 3 }] },
    { title: "이예시 (APP990101-002)", page: 4, children: [{ title: "지원서 요약", page: 4 }, { title: "이력서", page: 5 }, { title: "포트폴리오", page: 10 }] },
  ])
})

test("줄 나누기 — 띄어쓰기에서 넘기고, 긴 낱말은 자른다", async () => {
  const d = await PDFDocument.create()
  d.registerFontkit((await import("@pdf-lib/fontkit")).default)
  const f = await d.embedFont(fonts.regular, { subset: true })
  const lines = wrap(f, 10, "가나다 라마바 사아자 차카타 파하", 40)
  assert.ok(lines.length > 1)
  assert.ok(lines.every((l) => f.widthOfTextAtSize(l, 10) <= 40))
  assert.ok(wrap(f, 10, "https://example.com/" + "x".repeat(80), 60).every((l) => f.widthOfTextAtSize(l, 10) <= 60))
  assert.deepEqual(wrap(f, 10, "이모지😀빼기", 500), ["이모지빼기"])
})

test("묶음 표지 — 적어 둔 면접 정보가 있으면 표지에 줄이 붙고, 없으면 지금과 같다(쪽수 · 책갈피는 그대로)", async () => {
  const inputs = [{ applicant: who(1), files: [] }]
  const at = new Date("2026-11-26T03:00:00Z")
  const plain = await buildBundle(inputs, "[시험용] 인턴", fonts, at)
  const none = await buildBundle(inputs, "[시험용] 인턴", fonts, at, [])
  const withMeta = await buildBundle(inputs, "[시험용] 인턴", fonts, at, [
    { label: "면접 일시", value: "2099-01-05(월) 11:00 · 10분씩" },
    { label: "면접 장소", value: "가상시 가상구 시험로 1 시험센터 9층" },
  ])
  assert.equal(withMeta.pages, plain.pages)
  assert.deepEqual(withMeta.outline, plain.outline)
  // 표지 쪽의 그리기 명령 길이 — 글자는 글꼴 번호로 들어가 글로 찾을 수 없어서, 줄이 붙었는지만 본다
  const coverBytes = async (b: Uint8Array) => {
    const d = await PDFDocument.load(b)
    const c = d.context.lookup(d.getPage(0).node.get(PDFName.of("Contents")))
    const streams = c instanceof PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c]
    return streams.reduce((n, st) => n + ((st as PDFRawStream).contents?.length ?? 0), 0)
  }
  assert.equal(await coverBytes(none.bytes), await coverBytes(plain.bytes))
  assert.ok((await coverBytes(withMeta.bytes)) > (await coverBytes(plain.bytes)))
})

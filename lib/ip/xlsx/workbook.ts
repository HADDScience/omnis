"use client"

import { STYLES_XML, THEME_XML } from "@/lib/ip/xlsx/parts"
import { zip, type ZipEntry } from "@/lib/ip/xlsx/zip"

/**
 * 기준 워크북과 같은 서식의 xlsx 를 만든다.
 *
 * 값이 아니라 **서식**을 맞추는 것이 목적이다. 그래서 글꼴·정렬·표 스타일이 든
 * styles.xml / theme1.xml 은 기준 워크북에서 그대로 가져다 쓰고(`parts.ts`),
 * 여기서는 값이 든 파트(worksheet·table)만 만든다. cellXfs 인덱스(`style`)와
 * dxf 인덱스도 그 styles.xml 을 가리키는 값이므로 함께 바꾸지 않는다.
 *
 * 기준 워크북은 손으로 편집돼 온 파일이라 같은 열인데도 행마다 서식이 조금씩
 * 다르다. 그대로 흉내 내면 오히려 지저분해지므로 **열 단위로 하나씩 정한다**.
 */

export type CellValue = string | number | null

export interface ColumnSpec {
  header: string
  /** 열 너비 (기준 워크북 값). null 이면 기본 너비를 쓴다. */
  width: number | null
  /** 데이터 셀에 쓸 cellXfs 인덱스 */
  style: number
  /** 표(ListObject) 열의 dataDxfId */
  dxf: number
}

/** 표 밖에 따로 적어 두는 셀. 상표권 시트의 범례가 이것이다. */
export interface AsideCell {
  column: string
  /** 1부터 세는 행 번호 */
  row: number
  value: string
}

export interface SheetSpec {
  name: string
  /** 표 이름. 워크북 안에서 겹치면 안 된다. */
  tableName: string
  columns: ColumnSpec[]
  rows: CellValue[][]
  headerDxf: number
  dataDxf: number
  aside?: AsideCell[]
  /** 표 밖 열의 너비. 범례 열이 여기 해당한다. */
  asideWidths?: { column: string; width: number }[]
  /** 범례까지 포함한 시트의 마지막 열. 없으면 표의 마지막 열. */
  lastColumn?: string
}

const HEADER_STYLE = 1

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // 엑셀이 거부하는 제어문자를 걷어낸다(줄바꿈·탭은 남긴다).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
}

/** A → 0, Z → 25, AA → 26 */
function columnIndex(letter: string): number {
  let n = 0
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let n = index
  let out = ""
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

function cell(ref: string, style: number | null, value: CellValue): string {
  const s = style === null ? "" : ` s="${style}"`
  if (value === null || value === "") return `<c r="${ref}"${s}/>`
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`
  // 공유 문자열 대신 인라인 문자열을 쓴다. sharedStrings.xml 을 만들지 않아도 되고
  // 표에서 값이 중복될 일도 드물어 크기 손해가 거의 없다.
  return (
    `<c r="${ref}"${s} t="inlineStr">` +
    `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  )
}

function sheetXml(spec: SheetSpec): string {
  const lastTableColumn = columnLetter(spec.columns.length - 1)
  const lastColumn = spec.lastColumn ?? lastTableColumn
  const lastRow = spec.rows.length + 1

  // 기준 워크북에서 너비를 지정하지 않은 열은 여기서도 지정하지 않는다.
  const widths = [
    ...spec.columns.map((c, i) => ({ index: i + 1, width: c.width })),
    ...(spec.asideWidths ?? []).map((a) => ({
      index: columnIndex(a.column) + 1,
      width: a.width as number | null,
    })),
  ]
  const cols = widths
    .filter((w) => w.width !== null)
    .map((w) => `<col min="${w.index}" max="${w.index}" width="${w.width}" customWidth="1"/>`)
    .join("")

  const asideByRow = new Map<number, AsideCell[]>()
  for (const a of spec.aside ?? []) {
    const list = asideByRow.get(a.row) ?? []
    list.push(a)
    asideByRow.set(a.row, list)
  }

  const header =
    `<row r="1" spans="1:${spec.columns.length}">` +
    spec.columns
      .map((c, i) => cell(`${columnLetter(i)}1`, HEADER_STYLE, c.header))
      .join("") +
    `</row>`

  const body = spec.rows
    .map((row, r) => {
      const rowNumber = r + 2
      const cells = spec.columns
        .map((c, i) =>
          cell(`${columnLetter(i)}${rowNumber}`, c.style, row[i] ?? null)
        )
        .join("")
      const extras = (asideByRow.get(rowNumber) ?? [])
        .map((a) => cell(`${a.column}${rowNumber}`, null, a.value))
        .join("")
      return (
        `<row r="${rowNumber}" spans="1:${spec.columns.length}">` +
        cells +
        extras +
        `</row>`
      )
    })
    .join("")

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="16.9"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` +
    `</worksheet>`
  )
}

function tableXml(spec: SheetSpec, id: number): string {
  const ref = `A1:${columnLetter(spec.columns.length - 1)}${spec.rows.length + 1}`
  const columns = spec.columns
    .map(
      (c, i) =>
        `<tableColumn id="${i + 1}" name="${escapeXml(c.header)}" dataDxfId="${c.dxf}"/>`
    )
    .join("")

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` id="${id}" name="${escapeXml(spec.tableName)}" displayName="${escapeXml(spec.tableName)}"` +
    ` ref="${ref}" totalsRowShown="0"` +
    ` headerRowDxfId="${spec.headerDxf}" dataDxfId="${spec.dataDxf}">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${spec.columns.length}">${columns}</tableColumns>` +
    `<tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0"` +
    ` showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`
  )
}

/** 시트 명세들을 xlsx 바이트로 조립한다. */
export function buildWorkbook(sheets: SheetSpec[]): Uint8Array {
  const entries: ZipEntry[] = []

  const sheetOverrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml"` +
        ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/tables/table${i + 1}.xml"` +
        ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`
    )
    .join("")

  entries.push({
    path: "[Content_Types].xml",
    text:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml"` +
      ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheetOverrides +
      `<Override PartName="/xl/theme/theme1.xml"` +
      ` ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      `<Override PartName="/xl/styles.xml"` +
      ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
  })

  entries.push({
    path: "_rels/.rels",
    text:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1"` +
      ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"` +
      ` Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  })

  entries.push({
    path: "xl/workbook.xml",
    text:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
      ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<workbookPr defaultThemeVersion="202300"/>` +
      `<bookViews><workbookView activeTab="0"/></bookViews>` +
      `<sheets>` +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
        )
        .join("") +
      `</sheets><calcPr calcId="0"/></workbook>`,
  })

  const workbookRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}"` +
        ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"` +
        ` Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("")

  entries.push({
    path: "xl/_rels/workbook.xml.rels",
    text:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      workbookRels +
      `<Relationship Id="rId${sheets.length + 1}"` +
      ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"` +
      ` Target="theme/theme1.xml"/>` +
      `<Relationship Id="rId${sheets.length + 2}"` +
      ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"` +
      ` Target="styles.xml"/>` +
      `</Relationships>`,
  })

  entries.push({ path: "xl/styles.xml", text: STYLES_XML })
  entries.push({ path: "xl/theme/theme1.xml", text: THEME_XML })

  sheets.forEach((spec, i) => {
    const n = i + 1
    entries.push({ path: `xl/worksheets/sheet${n}.xml`, text: sheetXml(spec) })
    entries.push({
      path: `xl/worksheets/_rels/sheet${n}.xml.rels`,
      text:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1"` +
        ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table"` +
        ` Target="../tables/table${n}.xml"/>` +
        `</Relationships>`,
    })
    entries.push({ path: `xl/tables/table${n}.xml`, text: tableXml(spec, n) })
  })

  return zip(entries)
}

/** 만든 워크북을 내려받게 한다. */
export function downloadWorkbook(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

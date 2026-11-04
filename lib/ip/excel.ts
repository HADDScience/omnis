"use client"

import type { Patent, Trademark } from "@/lib/ip/types"
import {
  buildWorkbook,
  downloadWorkbook,
  type CellValue,
  type SheetSpec,
} from "@/lib/ip/xlsx/workbook"

/**
 * 내보내기 — NAS 의 「특허 및 상표권」 워크북과 **같은 양식**으로 만든다.
 *
 * 이 파일이 정하는 것은 "무엇을 어느 칸에 넣는가"이고, 글꼴·정렬·표 스타일 같은
 * 서식은 `lib/xlsx/` 가 기준 워크북에서 그대로 가져온다.
 *
 * 기준 워크북은 시트가 둘(「특허」·「상표권」)이고, 진행 기록·미결 액션 시트는
 * 없다. 받는 사람이 늘 보던 파일과 눈으로 대조할 수 있어야 하므로 시트를 더
 * 늘리지 않는다. 진행 기록은 화면에서 본다.
 */

// ---------------------------------------------------------------------------
// 단계 → 구분
// ---------------------------------------------------------------------------

/**
 * 파이프라인 단계(ip.status_options)를 기준 워크북의 「구분」으로 옮긴다.
 *
 * 단계는 12개로 잘게 나뉘어 있지만 기준 워크북의 구분은 훨씬 굵다. 받는 쪽이
 * 세어 보는 단위가 "출원했는가 / 등록됐는가 / 아직 준비인가" 이기 때문이다.
 * 새 단계가 늘어도 여기 없으면 준비 쪽으로 떨어지게 둔다.
 */
const PATENT_GROUP: Record<string, string> = {
  등록: "특허 등록",
  출원: "특허 출원",
  출원공고: "특허 출원",
  의견제출통지: "특허 출원",
  보정서제출: "특허 출원",
  심사중: "특허 출원",
  아이디어: "특허 출원 준비",
  검토요청: "특허 출원 준비",
  검토의견: "특허 출원 준비",
  출원준비: "특허 출원 준비",
  거절확정: "특허 거절",
  "포기·중단": "특허 중단",
}

const TRADEMARK_GROUP: Record<string, string> = {
  등록: "상표 등록",
  출원: "상표 출원",
  출원공고: "상표 출원",
  의견제출통지: "상표 출원",
  보정서제출: "상표 출원",
  심사중: "상표 출원",
  검토요청: "상표 검토",
  검토의견: "상표 검토",
  아이디어: "상표 준비",
  출원준비: "상표 준비",
  거절확정: "상표 거절",
  "포기·중단": "상표 중단",
}

/** 시트 안에서 구분을 묶어 보여 줄 순서. 기준 워크북도 구분끼리 모여 있다. */
const PATENT_ORDER = [
  "특허 등록",
  "특허 출원",
  "특허 출원 준비",
  "특허 거절",
  "특허 중단",
]

const TRADEMARK_ORDER = [
  "상표 등록",
  "상표 출원",
  "상표 검토",
  "상표 준비",
  "상표 거절",
  "상표 중단",
]

function group(
  table: Record<string, string>,
  fallback: string,
  status: string
): string {
  return table[status] ?? fallback
}

/** 구분 순서 → 그 안에서는 기존 목록 순서(id) 를 유지한다. */
function byGroup<T>(rows: T[], order: string[], of: (row: T) => string): T[] {
  const rank = (row: T) => {
    const i = order.indexOf(of(row))
    return i === -1 ? order.length : i
  }
  return [...rows]
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i)
    .map((x) => x.row)
}

// ---------------------------------------------------------------------------
// 값 표기
// ---------------------------------------------------------------------------

/**
 * `2026-07-24` → `2026.07.24.`
 *
 * 기준 워크북은 점으로 끊고 끝에도 점을 찍는다(최근 입력 기준. 오래된 행은
 * 끝점이 없는 것도 섞여 있는데, 그건 양식이 아니라 손입력 흔들림이라 맞추지
 * 않는다).
 */
function dotted(date: string | null): string | null {
  if (!date) return null
  const [y, m, d] = date.split("-")
  if (!y || !m || !d) return date
  return `${y}.${m}.${d}.`
}

/** 상표권 시트는 날짜를 괄호로 감싼다. */
function bracketed(date: string | null): string | null {
  const value = dotted(date)
  return value === null ? null : `(${value})`
}

/**
 * 상표 이름 칸은 이름과 류·지정상품을 한 칸에 적는다.
 * 예) `ADDGEL(제01류 과학 및 연구용 세포배양시약 등 10건)`
 *
 * 기준 워크북은 류마다 지정상품을 따로 적은 행도 있지만(`제 03류 화장품 등 /
 * 제 05류 건강기능식품 등`), 지식재산권 목록은 류 목록과 지정상품을 각각 하나씩만 들고
 * 있어 그 짝을 복원할 수 없다. 가진 만큼만 붙인다.
 */
function trademarkLabel(t: Trademark): string {
  const inside = [t.classes.join(", "), t.goods ?? ""]
    .filter((s) => s.length > 0)
    .join(" ")
  return inside ? `${t.name}(${inside})` : t.name
}

// ---------------------------------------------------------------------------
// 시트
// ---------------------------------------------------------------------------

/**
 * 열 명세. `style` 은 styles.xml 의 cellXfs 인덱스, `dxf` 는 표 열의 dataDxfId 로
 * 둘 다 기준 워크북의 값이다. 뜻이 아니라 위치를 가리키는 번호라 임의로 바꾸면
 * 서식이 어긋난다.
 */
const PATENT_COLUMNS = [
  { header: "순번", width: null, style: 7, dxf: 8 },
  { header: "구분", width: 14, style: 7, dxf: 7 },
  { header: "연구개발 내용", width: 76.25, style: 8, dxf: 6 },
  { header: "출원번호", width: 25.875, style: 8, dxf: 5 },
  { header: "출원날짜", width: 25.875, style: 5, dxf: 4 },
  { header: "등록번호", width: 26.8125, style: 8, dxf: 3 },
  { header: "등록날짜", width: 27.0625, style: 5, dxf: 2 },
  { header: "출원인", width: 13.9375, style: 7, dxf: 1 },
  { header: "기타", width: 24, style: 10, dxf: 0 },
]

const TRADEMARK_COLUMNS = [
  { header: "순번", width: null, style: 3, dxf: 16 },
  { header: "구분", width: 14.25, style: 3, dxf: 15 },
  { header: "이름", width: 66.5, style: 2, dxf: 14 },
  { header: "등록/출원번호", width: 14.3125, style: 2, dxf: 13 },
  { header: "날짜", width: 10.6875, style: 2, dxf: 12 },
  { header: "보유자", width: null, style: 2, dxf: 11 },
]

/**
 * 상표권 시트 오른쪽(H열)의 범례. 기준 워크북에 손으로 적혀 있는 것을 그대로
 * 옮긴다 — 어느 구분이 우리 손에 있고 어느 구분이 특허법인 손에 있는지 알려 준다.
 */
const TRADEMARK_LEGEND = [
  "(내부)아이디어",
  "(내부)준비",
  "(특허법인)검토",
  "거절",
  "등록",
]

function patentSheet(patents: Patent[]): SheetSpec {
  const ordered = byGroup(patents, PATENT_ORDER, (p) =>
    group(PATENT_GROUP, "특허 출원 준비", p.status)
  )

  const rows: CellValue[][] = ordered.map((p, i) => [
    i + 1,
    group(PATENT_GROUP, "특허 출원 준비", p.status),
    p.title,
    p.appNo,
    dotted(p.filedOn),
    p.regNo,
    dotted(p.registeredOn),
    p.applicant,
    p.note || null,
  ])

  return {
    name: "특허",
    tableName: "표2",
    columns: PATENT_COLUMNS,
    rows,
    headerDxf: 10,
    dataDxf: 9,
  }
}

function trademarkSheet(trademarks: Trademark[]): SheetSpec {
  const ordered = byGroup(trademarks, TRADEMARK_ORDER, (t) =>
    group(TRADEMARK_GROUP, "상표 준비", t.status)
  )

  const rows: CellValue[][] = ordered.map((t, i) => [
    i + 1,
    group(TRADEMARK_GROUP, "상표 준비", t.status),
    trademarkLabel(t),
    // 등록된 건은 등록번호를, 아니면 출원번호를 적는다. 둘 다 없으면 「-」.
    t.regNo ?? t.appNo ?? "-",
    bracketed(t.registeredOn ?? t.filedOn ?? t.date),
    t.holder,
  ])

  return {
    name: "상표권",
    tableName: "표1",
    columns: TRADEMARK_COLUMNS,
    rows,
    headerDxf: 18,
    dataDxf: 17,
    // 범례는 표 밖(H열)에 2행부터 놓는다. 행이 모자라면 놓을 수 있는 만큼만.
    aside: TRADEMARK_LEGEND.slice(0, rows.length).map((value, i) => ({
      column: "H",
      row: i + 2,
      value,
    })),
    asideWidths: [{ column: "H", width: 13.1875 }],
    lastColumn: "H",
  }
}

// ---------------------------------------------------------------------------
// 내보내기
// ---------------------------------------------------------------------------

/** 「특허 및 상표권_260728_정우창.xlsx」 형태의 파일명 */
export function fileName(today: string, owner: string): string {
  const stamp = today.replace(/-/g, "").slice(2)
  return `특허 및 상표권_${stamp}_${owner}.xlsx`
}

/** 파일명 끝에 붙일 이름. 표시 이름이 없으면 이메일 앞부분을 쓴다. */
export function exporterName(member: {
  displayName: string | null
  email: string
}): string {
  return member.displayName?.trim() || member.email.split("@")[0]
}

/**
 * 기준 워크북과 같은 「특허」·「상표권」 두 시트짜리 xlsx 바이트.
 * 내려받기와 분리해 둔 것은 브라우저 없이도 결과를 확인할 수 있게 하기 위함이다.
 */
export function buildReport(data: {
  trademarks: Trademark[]
  patents: Patent[]
}): Uint8Array {
  return buildWorkbook([
    patentSheet(data.patents),
    trademarkSheet(data.trademarks),
  ])
}

/** 전체 내보내기 */
export async function exportAll(
  data: { trademarks: Trademark[]; patents: Patent[] },
  today: string,
  owner: string
): Promise<void> {
  downloadWorkbook(buildReport(data), fileName(today, owner))
}

/**
 * 내보내기 창구는 이 하나뿐이다. 화면별로 걸러 내보내는 버튼을 따로 두지 않는데,
 * 기준 워크북이 「특허」·「상표권」 전체를 담은 한 장이고 받는 쪽도 그렇게 보기
 * 때문이다. 걸러 보는 일은 엑셀의 자동 필터가 한다(표에 이미 걸려 있다).
 */

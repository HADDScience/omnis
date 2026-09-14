import { z } from "zod"

// 회사 정보 · 연도별 재무 편집 — 화면 폼과 API 가 같은 규칙을 쓴다(브라우저에서도 불러온다, prisma 없음).
// 설계: mydocs/plans/2026-09-14-company-context.md

const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v)

const optText = (max: number, label: string) =>
  z.preprocess(emptyToNull, z.string().trim().max(max, `${label}은(는) ${max}자 이내로`).nullable())

const optDate = (label: string) =>
  z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}은(는) YYYY-MM-DD 형식으로`).nullable())

/** "307,481,423" · "₩307481423" · "-1,200" → 정수 문자열. 비우면 null. 순손실이 있어 음수를 받는다 */
const optMoney = (label: string) =>
  z.preprocess(
    (v) => {
      const e = emptyToNull(v)
      return e === null ? null : String(e).replace(/[,\s원₩]/g, "")
    },
    z.string().regex(/^-?\d{1,15}$/, `${label}은(는) 숫자로 입력하세요 (쉼표 가능)`).nullable()
  )

export const CompanyProfileSchema = z.object({
  nameKo: z.string().trim().min(1, "상호를 입력하세요").max(100),
  nameEn: optText(100, "영문 상호"),
  bizRegNo: z.string().trim().regex(/^\d{3}-\d{2}-\d{5}$/, "사업자등록번호는 000-00-00000 형식으로"),
  bizType: optText(40, "사업자 형태"),
  corpRegNo: z.preprocess(emptyToNull, z.string().trim().regex(/^\d{6}-\d{7}$/, "법인등록번호는 000000-0000000 형식으로").nullable()),
  industry: optText(100, "업종"),
  industryCode: optText(20, "업종코드"),
  foundedOn: optDate("설립일"),
  homepage: optText(200, "홈페이지"),
  hqAddress: optText(300, "본사 주소"),
  labAddress: optText(300, "연구소 주소"),
  partnerAddress: optText(300, "연구협력기관 주소"),
  asOfDate: optDate("기준일"),
})
export type CompanyProfileInput = z.infer<typeof CompanyProfileSchema>

export const YEAR_MONEY_FIELDS = [
  ["revenueKrw", "매출 (공급가액)"],
  ["revenueProductKrw", "제품 매출"],
  ["revenueServiceKrw", "용역 매출"],
  ["costOfSalesKrw", "매출원가"],
  ["netIncomeKrw", "당기순이익"],
  ["assetsKrw", "자산"],
  ["liabilitiesKrw", "부채"],
  ["equityKrw", "자본"],
] as const
export type YearMoneyKey = (typeof YEAR_MONEY_FIELDS)[number][0]

export const CompanyYearSchema = z.object({
  year: z.coerce.number().int("연도는 정수로").min(2000, "연도는 2000 이후로").max(2100, "연도는 2100 이전으로"),
  basis: z.enum(["CONFIRMED", "PLANNED"], { message: "단계는 확정 또는 계획" }),
  revenueKrw: optMoney("매출"),
  revenueProductKrw: optMoney("제품 매출"),
  revenueServiceKrw: optMoney("용역 매출"),
  costOfSalesKrw: optMoney("매출원가"),
  netIncomeKrw: optMoney("당기순이익"),
  assetsKrw: optMoney("자산"),
  liabilitiesKrw: optMoney("부채"),
  equityKrw: optMoney("자본"),
  headcount: z.preprocess(emptyToNull, z.coerce.number().int("상시근로자는 정수로").min(0).max(10_000).nullable()),
  accountLabel: optText(50, "결산서 매출 계정"),
  note: optText(500, "비고"),
  asOfDate: optDate("기준일"),
})
export type CompanyYearInput = z.infer<typeof CompanyYearSchema>

/** 폼 상태 — 전부 글자. 서버 값(BigInt · Date)은 화면이 이 모양으로 바꿔 넘긴다 */
export type ProfileForm = { [K in keyof CompanyProfileInput]: string }

export type YearForm = { id?: string; basis: "CONFIRMED" | "PLANNED" } & {
  [K in Exclude<keyof CompanyYearInput, "basis">]: string
}

export const EMPTY_YEAR_FORM: YearForm = {
  year: String(new Date().getFullYear()),
  basis: "PLANNED",
  revenueKrw: "",
  revenueProductKrw: "",
  revenueServiceKrw: "",
  costOfSalesKrw: "",
  netIncomeKrw: "",
  assetsKrw: "",
  liabilitiesKrw: "",
  equityKrw: "",
  headcount: "",
  accountLabel: "",
  note: "",
  asOfDate: "",
}

export const PROFILE_FIELD_LABEL: Record<keyof CompanyProfileInput, string> = {
  nameKo: "상호",
  nameEn: "영문 상호",
  bizRegNo: "사업자등록번호",
  bizType: "사업자 형태",
  corpRegNo: "법인등록번호",
  industry: "업종",
  industryCode: "업종코드",
  foundedOn: "설립일",
  homepage: "홈페이지",
  hqAddress: "본사",
  labAddress: "연구소",
  partnerAddress: "연구협력기관",
  asOfDate: "기준일",
}

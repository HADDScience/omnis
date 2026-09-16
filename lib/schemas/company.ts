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

// ─── 연혁·실적 (2026-09-16) ──────────────────────────────
// 화면에서 연혁을 고칠 수 있게 하면서 만들었다. 그 전에는 이식 스크립트만 이 표에 썼다.

export const RECORD_KINDS = [
  "GRANT", "AWARD", "EXHIBITION", "FORUM", "EDUCATION", "NETWORKING", "INTERNAL", "MILESTONE",
] as const

/** 종류 이름표. 브라우저(편집 창)도 쓰므로 prisma 를 부르는 company-context 가 아니라 여기 둔다 */
export const RECORD_KIND_LABEL: Record<(typeof RECORD_KINDS)[number], string> = {
  GRANT: "지원사업",
  AWARD: "수상",
  EXHIBITION: "학회·전시",
  FORUM: "포럼·세미나",
  EDUCATION: "교육",
  NETWORKING: "네트워킹",
  INTERNAL: "내부행사",
  MILESTONE: "주요",
}

export const CompanyRecordSchema = z
  .object({
    kind: z.enum(RECORD_KINDS, { message: "종류를 고르세요" }),
    title: z.string().trim().min(1, "제목을 입력하세요").max(300, "제목은 300자 이내로"),
    organizer: optText(200, "주관"),
    startsOn: optDate("시작일"),
    endsOn: optDate("종료일"),
    /** 원문 기간 표기. 비우면 서버가 날짜로 만들어 넣는다 */
    periodRaw: optText(100, "기간 표기"),
    status: optText(20, "상태"),
    note: optText(1000, "비고"),
    subject: optText(300, "과제명"),
    role: optText(50, "역할"),
    fundingKrw: optMoney("지원금"),
    ownCashKrw: optMoney("자부담 현금"),
    ownInKindKrw: optMoney("자부담 현물"),
    grantNo: optText(100, "과제번호"),
    prize: optText(100, "상격"),
    venue: optText(200, "장소"),
    partner: optText(100, "대리점"),
    category: optText(50, "분류"),
  })
  .refine((d) => !(d.startsOn && d.endsOn) || d.startsOn <= d.endsOn, {
    message: "종료일이 시작일보다 앞섭니다",
    path: ["endsOn"],
  })

export type CompanyRecordInput = z.infer<typeof CompanyRecordSchema>

/** 폼 상태 — 전부 글자. 서버 값(BigInt · Date)은 화면이 이 모양으로 바꿔 넘긴다 */
export type RecordForm = { id?: string } & { [K in keyof CompanyRecordInput]: string }

export const EMPTY_RECORD_FORM: RecordForm = {
  kind: "MILESTONE",
  title: "",
  organizer: "",
  startsOn: "",
  endsOn: "",
  periodRaw: "",
  status: "",
  note: "",
  subject: "",
  role: "",
  fundingKrw: "",
  ownCashKrw: "",
  ownInKindKrw: "",
  grantNo: "",
  prize: "",
  venue: "",
  partner: "",
  category: "",
}

export const RECORD_FIELD_LABEL: Record<keyof CompanyRecordInput, string> = {
  kind: "종류",
  title: "제목",
  organizer: "주관",
  startsOn: "시작일",
  endsOn: "종료일",
  periodRaw: "기간 표기",
  status: "상태",
  note: "비고",
  subject: "과제명",
  role: "역할",
  fundingKrw: "지원금",
  ownCashKrw: "자부담 현금",
  ownInKindKrw: "자부담 현물",
  grantNo: "과제번호",
  prize: "상격",
  venue: "장소",
  partner: "대리점",
  category: "분류",
}

/** 상태 칸에 자주 들어가는 값 — 자유 입력이되 고르기 쉽게 */
export const RECORD_STATUSES = ["완료", "진행중", "발표완료", "계획"] as const

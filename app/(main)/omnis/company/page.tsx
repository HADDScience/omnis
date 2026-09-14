import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { CompanyProfileDialog, CompanyYearDialog } from "@/components/company/company-editors"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { won } from "@/lib/crm"
import { BASIS_LABEL, invoiceRevenue, ymd } from "@/lib/company-context"
import { isAdminSession } from "@/lib/company-edit"
import type { ProfileForm, YearForm } from "@/lib/schemas/company"
import type { CompanyProfile, CompanyYear } from "@/generated/prisma/client"

export const metadata: Metadata = { title: "회사 정보 · HADD DB" }
export const dynamic = "force-dynamic"

const money = (v: bigint | number | null | undefined) => (v === null || v === undefined ? "—" : won(Number(v)))
const moneyText = (v: bigint | null) => (v === null ? "" : Number(v).toLocaleString("ko-KR"))

/** 편집 창에 넘길 글자 모양 — BigInt · Date 는 클라이언트로 그대로 못 넘긴다 */
function profileForm(p: CompanyProfile | null): ProfileForm {
  return {
    nameKo: p?.nameKo ?? "",
    nameEn: p?.nameEn ?? "",
    bizRegNo: p?.bizRegNo ?? "",
    bizType: p?.bizType ?? "",
    corpRegNo: p?.corpRegNo ?? "",
    industry: p?.industry ?? "",
    industryCode: p?.industryCode ?? "",
    foundedOn: ymd(p?.foundedOn) ?? "",
    homepage: p?.homepage ?? "",
    hqAddress: p?.hqAddress ?? "",
    labAddress: p?.labAddress ?? "",
    partnerAddress: p?.partnerAddress ?? "",
    asOfDate: ymd(p?.asOfDate) ?? "",
  }
}

function yearForm(y: CompanyYear): YearForm {
  return {
    id: y.id,
    year: String(y.year),
    basis: y.basis,
    revenueKrw: moneyText(y.revenueKrw),
    revenueProductKrw: moneyText(y.revenueProductKrw),
    revenueServiceKrw: moneyText(y.revenueServiceKrw),
    costOfSalesKrw: moneyText(y.costOfSalesKrw),
    netIncomeKrw: moneyText(y.netIncomeKrw),
    assetsKrw: moneyText(y.assetsKrw),
    liabilitiesKrw: moneyText(y.liabilitiesKrw),
    equityKrw: moneyText(y.equityKrw),
    headcount: y.headcount === null ? "" : String(y.headcount),
    accountLabel: y.accountLabel ?? "",
    note: y.note ?? "",
    asOfDate: ymd(y.asOfDate) ?? "",
  }
}

/**
 * 회사 기본정보 + 연도별 재무.
 *
 * 매출은 공급가액(부가세 제외). 단계를 섞지 않는다 —
 *   확정: 결산서 · 잠정: 결산 전인 해의 세금계산서 합(매번 센다) · 계획: 예상·추정.
 * 결산이 끝난 해에는 세금계산서 합과의 차이를 옆에 적어 대조한다.
 * 관리자는 기본정보와 저장된 연도(확정 · 계획)를 여기서 고친다. 고친 칸은 활동 기록에 남는다.
 */
export default async function CompanyPage() {
  const isAdmin = isAdminSession(await auth())
  const [profile, years] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { id: "hadd" } }),
    prisma.companyYear.findMany({ orderBy: [{ year: "desc" }, { basis: "asc" }] }),
  ])

  const confirmed = years.filter((y) => y.basis === "CONFIRMED").map((y) => y.year)
  const thisYear = new Date().getUTCFullYear()
  const provisionalYears = [thisYear, thisYear - 1].filter((y) => !confirmed.includes(y))
  const [provisional, reconcile] = await Promise.all([
    Promise.all(provisionalYears.map(invoiceRevenue)),
    Promise.all(confirmed.map(invoiceRevenue)),
  ])

  type Row = {
    key: string
    year: number
    basis: keyof typeof BASIS_LABEL
    revenue: number | null
    product: number | null
    service: number | null
    assets: bigint | null
    liabilities: bigint | null
    equity: bigint | null
    netIncome: bigint | null
    headcount: number | null
    remark: string | null
    /** 저장된 줄만 고칠 수 있다. 잠정은 세금계산서에서 세므로 없음 */
    editable: YearForm | null
  }
  const rows: Row[] = [
    ...years.map((y) => {
      const inv = reconcile.find((r) => r.year === y.year)
      const diff = y.basis === "CONFIRMED" && inv && inv.invoices > 0 && y.revenueKrw !== null ? Number(y.revenueKrw) - inv.total : null
      return {
        key: y.id,
        year: y.year,
        basis: y.basis,
        revenue: y.revenueKrw === null ? null : Number(y.revenueKrw),
        product: y.revenueProductKrw === null ? null : Number(y.revenueProductKrw),
        service: y.revenueServiceKrw === null ? null : Number(y.revenueServiceKrw),
        assets: y.assetsKrw,
        liabilities: y.liabilitiesKrw,
        equity: y.equityKrw,
        netIncome: y.netIncomeKrw,
        headcount: y.headcount,
        remark: [
          y.accountLabel && `결산서 매출 계정: ${y.accountLabel}`,
          diff !== null && `세금계산서 ${inv!.invoices}장 합과 차이 ${diff.toLocaleString("ko-KR")}원`,
          y.note,
        ]
          .filter(Boolean)
          .join(" · ") || null,
        editable: yearForm(y),
      }
    }),
    ...provisional
      .filter((p) => p.invoices > 0)
      .map((p) => ({
        key: `prov-${p.year}`,
        year: p.year,
        basis: "PROVISIONAL" as const,
        revenue: p.total,
        product: p.product,
        service: p.service,
        assets: null,
        liabilities: null,
        equity: null,
        netIncome: null,
        headcount: null,
        remark: `세금계산서 ${p.invoices}장 · ${ymd(p.lastIssuedOn)} 발행분까지 · 결산 전 잠정치`,
        editable: null,
      })),
  ].sort((a, b) => b.year - a.year || ["CONFIRMED", "PROVISIONAL", "PLANNED"].indexOf(a.basis) - ["CONFIRMED", "PROVISIONAL", "PLANNED"].indexOf(b.basis))

  const fields: [string, string | null][] = profile
    ? [
        ["상호", `${profile.nameKo}${profile.nameEn ? ` (${profile.nameEn})` : ""}`],
        ["사업자등록번호", profile.bizRegNo],
        ["사업자 형태", profile.bizType ?? "확인 필요 — 번호 체계와 결산서로는 개인과세사업자"],
        ...(profile.corpRegNo ? ([["법인등록번호", profile.corpRegNo]] as [string, string][]) : []),
        ["업종", [profile.industry, profile.industryCode && `(${profile.industryCode})`].filter(Boolean).join(" ") || null],
        ["설립일", ymd(profile.foundedOn)],
        ["홈페이지", profile.homepage],
        ["본사", profile.hqAddress],
        ["연구소", profile.labAddress],
        ["연구협력기관", profile.partnerAddress],
        ["기준일", ymd(profile.asOfDate)],
      ]
    : []

  return (
    <>
      <Header crumbs={["HADD DB", "회사 정보"]} />
      <div className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">회사 정보</h1>
          <span className="text-[13px] text-muted-foreground">지원서에 그대로 들어가는 값 · AI 가 고쳐 쓰지 않는다</span>
          {isAdmin && profile && (
            <span className="ml-auto">
              <CompanyProfileDialog initial={profileForm(profile)} exists />
            </span>
          )}
        </div>

        {profile ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border bg-card p-4 sm:grid-cols-[140px_1fr]">
            {fields.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[12px] text-muted-foreground sm:pt-0.5">{k}</dt>
                <dd className="break-words text-[13.5px]">
                  {k === "홈페이지" && v ? (
                    <a href={v} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {v}
                    </a>
                  ) : (
                    (v ?? <span className="text-muted-foreground">—</span>)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>회사 기본정보가 아직 없습니다</EmptyTitle>
              <EmptyDescription>
                {isAdmin ? "아래 버튼으로 직접 입력하거나 " : ""}
                <code>scripts/import-company-context.ts --only company</code> 로 옮기면 여기에 보입니다.
              </EmptyDescription>
            </EmptyHeader>
            {isAdmin && (
              <EmptyContent>
                <CompanyProfileDialog initial={profileForm(null)} exists={false} />
              </EmptyContent>
            )}
          </Empty>
        )}

        <section id="years" aria-labelledby="years-heading" className="mt-8">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <h2 id="years-heading" className="text-[15px] font-semibold">
              연도별 재무
            </h2>
            <span className="text-[12px] text-muted-foreground">
              매출은 공급가액(부가세 제외) · 확정 = 결산서 · 잠정 = 결산 전 세금계산서 합 · 계획 = 예상·추정
            </span>
            <span className="ml-auto flex items-center gap-2">
              <Link href="/crm/invoices" className="text-[12px] text-muted-foreground hover:underline">
                세금계산서 보기
              </Link>
              {isAdmin && <CompanyYearDialog />}
            </span>
          </div>

          {rows.length === 0 ? (
            <Empty className="rounded-xl border border-dashed">
              <EmptyHeader>
                <EmptyTitle>재무 자료가 없습니다</EmptyTitle>
                <EmptyDescription>결산서를 이식하거나 CRM 에 세금계산서를 올리면 여기에 쌓입니다.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead className="border-b bg-muted/40 text-[11.5px] text-muted-foreground">
                  <tr>
                    {["연도", "단계", "매출", "제품", "용역", "자산", "부채", "자본", "순이익", "상시근로자"].map((h) => (
                      <th key={h} scope="col" className={`px-3 py-2 font-medium ${h === "연도" || h === "단계" ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <FinanceRow key={r.key} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )

  function FinanceRow({ r }: { r: Row }) {
    return (
      <>
        <tr className={r.remark ? "" : "border-b last:border-b-0"}>
          <td className="px-3 pt-2 font-semibold tabular-nums">{r.year}</td>
          <td className="px-3 pt-2">
            <span className="flex items-center gap-1">
              <Badge variant={r.basis === "CONFIRMED" ? "default" : "outline"}>{BASIS_LABEL[r.basis]}</Badge>
              {isAdmin && r.editable && <CompanyYearDialog initial={r.editable} />}
            </span>
          </td>
          <td className="px-3 pt-2 text-right font-semibold tabular-nums">{money(r.revenue)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{money(r.product)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{money(r.service)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{money(r.assets)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{money(r.liabilities)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{money(r.equity)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{money(r.netIncome)}</td>
          <td className="px-3 pt-2 text-right tabular-nums">{r.headcount ?? "—"}</td>
        </tr>
        {r.remark && (
          <tr className="border-b last:border-b-0">
            <td />
            <td colSpan={9} className="px-3 pb-2 pt-0.5 text-[11.5px] text-muted-foreground">
              {r.remark}
            </td>
          </tr>
        )}
      </>
    )
  }
}

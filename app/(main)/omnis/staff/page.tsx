import type { Metadata } from "next"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { SignatureActions } from "@/components/company/signature-actions"
import { StaffAssetUpload } from "@/components/company/staff-asset-upload"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { ymd } from "@/lib/company-context"

export const metadata: Metadata = { title: "인력 · HADD DB" }
export const dynamic = "force-dynamic"

/**
 * 인력 — 과제 대리 작성용. 관리자만 연다.
 *
 * 개인정보(생년월일 · 연락처 · 과학기술인번호)와 서명 · 직인이 있다.
 * 서명 · 직인은 미리보기를 띄우지 않는다. 「복사」 · 「파일로 받기」 를 누를 때만 꺼내고, 그때마다 활동 로그가 남는다.
 * 파일은 권한이 좁은 NAS 폴더(08. 개인정보/옴니스 서명·직인)에 둔다 — lib/staff-assets. 「바꾸기」 로 더 큰 스캔본을 올린다.
 * 비재직자는 이름 · 소속 · 비재직 표시만 있다(2026-09-14 결정).
 */
export default async function StaffPage() {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!isAdmin) {
    return (
      <>
        <Header crumbs={["HADD DB", "인력"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>개인정보와 서명·직인이 있어 관리자 계정에만 열려 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  const staff = await prisma.staffProfile.findMany({
    orderBy: [{ employment: "asc" }, { name: "asc" }],
    include: { assets: { orderBy: { kind: "asc" } }, user: { select: { id: true, isActive: true } } },
  })
  const employed = staff.filter((s) => s.employment === "EMPLOYED")
  const former = staff.filter((s) => s.employment === "FORMER")

  return (
    <>
      <Header crumbs={["HADD DB", "인력"]} />
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">인력</h1>
          <span className="text-[13px] text-muted-foreground">
            재직 {employed.length}명 · 4대보험 {employed.filter((s) => s.insured).length}명 · 관리자 전용 · 서명·직인을 꺼내면 기록이 남는다
          </span>
        </div>

        {employed.length === 0 ? (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>인력 정보가 아직 없습니다</EmptyTitle>
              <EmptyDescription>
                <code>scripts/import-company-context.ts --only staff</code> 로 옮기면 여기에 보입니다.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {employed.map((s) => (
              <li key={s.id} className="rounded-xl border bg-card p-3.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14.5px] font-semibold">{s.name}</span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {s.affiliation}
                    {s.position ? ` · ${s.position}` : ""}
                  </span>
                  {s.haddRole && <Badge>하드사이언스 {s.haddRole}</Badge>}
                  {s.insured && <Badge variant="secondary">4대보험</Badge>}
                  {s.user ? <Badge variant="outline">옴니스 계정</Badge> : null}
                </div>

                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[110px_1fr]">
                  {(
                    [
                      ["담당 업무", s.duties],
                      ["학력 · 전공", [s.education, s.major].filter(Boolean).join(" · ") || null],
                      ["과학기술인번호", s.ntisNo],
                      ["이메일", s.email],
                      ["연락처", s.phone],
                      ["생년월일", ymd(s.birthDate)],
                      ["입사일", ymd(s.joinedOn)],
                    ] as [string, string | null][]
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="break-words">{v ?? <span className="text-muted-foreground">—</span>}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                  {s.assets.length === 0 && (
                    <span className="text-[12px] text-muted-foreground">등록된 서명·직인이 없습니다</span>
                  )}
                  {s.assets.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-muted-foreground">
                        {a.kind === "SEAL" ? "직인" : "서명"}
                        {a.width && a.height ? ` ${a.width}×${a.height}` : ""}
                        {a.width && a.width < 300 ? " · 작아서 인쇄 시 흐릴 수 있음 — 더 큰 스캔본으로 바꾸기를 권장" : ""}
                      </span>
                      <SignatureActions assetId={a.id} staffName={s.name} kind={a.kind} />
                      <StaffAssetUpload staffId={s.id} staffName={s.name} kind={a.kind} replacing />
                    </div>
                  ))}
                  <span className="ml-auto flex flex-wrap gap-1">
                    {!s.assets.some((a) => a.kind === "SIGNATURE") && (
                      <StaffAssetUpload staffId={s.id} staffName={s.name} kind="SIGNATURE" replacing={false} />
                    )}
                    {!s.assets.some((a) => a.kind === "SEAL") && (
                      <StaffAssetUpload staffId={s.id} staffName={s.name} kind="SEAL" replacing={false} />
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {former.length > 0 && (
          <details className="mt-6 rounded-xl border bg-card p-3.5">
            <summary className="touch-target cursor-pointer text-[13px] font-medium">비재직 {former.length}명</summary>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {former.map((s) => (
                <li key={s.id} className="rounded-md border bg-muted/40 px-2 py-1 text-[12px]">
                  {s.name} <span className="text-muted-foreground">{s.affiliation}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  )
}

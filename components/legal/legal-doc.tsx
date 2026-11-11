import Link from "next/link"
import type { ReactNode } from "react"
import type { LegalCompany } from "@/lib/legal/company"
import { LEGAL_EFFECTIVE_DATE } from "@/lib/legal/company"

/**
 * 약관 · 개인정보 처리방침 화면의 틀(app/(legal)). 로그인 없이 열린다 — 로그인 화면 아래 링크에서도 온다.
 * 본문은 서버에서 그린 글이다. 표는 좁은 화면에서 가로로 밀린다.
 */
export function LegalDoc({ title, current, children }: { title: string; current: "terms" | "privacy"; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
        <nav aria-label="약관" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          <Link href="/settings?tab=info" className="hover:text-foreground">
            ← 앱 정보
          </Link>
          <span aria-hidden>·</span>
          <Link href="/terms" aria-current={current === "terms" ? "page" : undefined} className="hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
            서비스 이용약관
          </Link>
          <Link href="/privacy" aria-current={current === "privacy" ? "page" : undefined} className="hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
            개인정보 처리방침
          </Link>
        </nav>
        <article data-legal-doc={current} className="legal-doc text-[14px] leading-7 text-foreground">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">시행일 {LEGAL_EFFECTIVE_DATE}</p>
          <div className="mt-6 flex flex-col gap-8">{children}</div>
        </article>
      </div>
    </main>
  )
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-[13.5px] leading-7 [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal">{children}</div>
    </section>
  )
}

/** 머리 줄 + 본문 줄. 좁으면 가로로 밀린다 */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[12.5px] leading-6">
        <thead className="bg-muted/60">
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top [&:not(:last-child)>td]:border-b">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 회사를 부르는 말 — 「하드사이언스(이하 「회사」)」 */
export function companyLabel(c: LegalCompany) {
  return c.nameEn ? `${c.name}(${c.nameEn})` : c.name
}

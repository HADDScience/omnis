import type { Metadata } from "next"
import { LegalDoc } from "@/components/legal/legal-doc"
import { appLicenses } from "@/lib/app-info"

export const metadata: Metadata = { title: "오픈소스 라이선스 — Omnis" }

/**
 * 오픈소스 라이선스 — 운영 의존성(전이 포함)을 빌드 때 모은 목록(lib/app-info-build.mjs collectLicenses).
 * 이름 · 버전 · 라이선스 · 프로젝트 주소. 라이선스 전문은 각 프로젝트 주소에 있다.
 */
export default function LicensesPage() {
  const rows = appLicenses()
  const counts = Object.entries(
    rows.reduce<Record<string, number>>((acc, r) => ((acc[r.license] = (acc[r.license] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1])

  return (
    <LegalDoc title="오픈소스 라이선스" current="licenses" dated={false}>
      <p className="text-[13.5px] leading-7">
        옴니스는 아래 오픈소스 소프트웨어를 씁니다. 이 빌드에 들어간 {rows.length.toLocaleString("ko-KR")}개 꾸러미의 이름 · 버전 · 라이선스이며, 라이선스
        전문은 각 프로젝트 주소에서 볼 수 있습니다.
      </p>
      {counts.length > 0 && (
        <p data-license-summary className="text-[12.5px] leading-6 text-muted-foreground">
          {counts.map(([lic, n]) => `${lic} ${n}`).join(" · ")}
        </p>
      )}
      <ul data-license-list className="divide-y rounded-lg border text-[12.5px]">
        {rows.map((r) => (
          <li key={`${r.name}@${r.version}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5">
            {r.homepage ? (
              <a href={r.homepage} target="_blank" rel="noopener noreferrer" className="font-medium break-all underline-offset-4 hover:underline">
                {r.name}
              </a>
            ) : (
              <span className="font-medium break-all">{r.name}</span>
            )}
            <span className="text-muted-foreground tabular-nums">{r.version}</span>
            <span className="ml-auto text-muted-foreground">{r.license}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-3 text-muted-foreground">이 빌드에는 목록이 없습니다.</li>}
      </ul>
    </LegalDoc>
  )
}

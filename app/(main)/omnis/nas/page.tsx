import { Header } from "@/components/layout/header"
import { NasBrowser } from "./nas-browser"

export const dynamic = "force-dynamic"

/**
 * 시놀로지 NAS 를 들여다보는 창.
 *
 * 사이드바에서 「사내 자료」로 따로 서 있었는데, 「HADD DB」와 무엇이 다른지 헷갈렸다.
 * 둘 다 사내 자료를 보는 곳이니 당연하다. 지금은 HADD DB 아래로 들어가 있다 —
 * 카드로 정리된 지식이 HADD DB 고, 아직 NAS 에 파일로만 있는 것이 여기다.
 */
export default async function OmnisNasPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>
}) {
  const { path } = await searchParams
  return (
    <>
      <Header crumbs={["HADD DB", "사내 자료 (NAS)"]} />
      <div className="flex flex-1 flex-col overflow-hidden p-4">
        <NasBrowser initialPath={path ?? "/HADD Science"} />
      </div>
    </>
  )
}

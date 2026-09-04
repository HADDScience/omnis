import { Header } from "@/components/layout/header"
import { NasBrowser } from "./nas-browser"

export const dynamic = "force-dynamic"

export default async function NasPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>
}) {
  const { path } = await searchParams
  return (
    <>
      <Header title="사내 자료" />
      <div className="flex flex-1 flex-col overflow-hidden p-4">
        <NasBrowser initialPath={path ?? "/HADD Science"} />
      </div>
    </>
  )
}

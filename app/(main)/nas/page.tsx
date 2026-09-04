import { redirect } from "next/navigation"

/**
 * 옛 주소. 사내 자료를 HADD DB 아래로 옮기면서 남겨 둔다 —
 * 채팅에 남은 링크와 북마크가 여기를 가리키고 있다.
 */
export default async function NasRedirect({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>
}) {
  const { path } = await searchParams
  redirect(path ? `/omnis/nas?path=${encodeURIComponent(path)}` : "/omnis/nas")
}

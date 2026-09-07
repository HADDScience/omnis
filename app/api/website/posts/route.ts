import { NextRequest, NextResponse } from "next/server"

import { listPosts } from "@/lib/website-posts"
import { websiteCors, websiteOptions } from "@/lib/website-auth"

/**
 * 기사 목록 — 공개. 사이트(서버 렌더)와 관리 화면이 읽는다.
 * 엣지에 60초 두고 그 뒤 60초는 낡은 것을 주면서 새로 받는다. 저장 시에는 사이트가
 * 따로 재검증되므로 이 캐시는 부하를 막는 용도다.
 */
export const dynamic = "force-dynamic"

export const OPTIONS = websiteOptions

export async function GET(req: NextRequest) {
  const posts = await listPosts()
  return NextResponse.json(posts, {
    headers: {
      ...websiteCors(req.headers.get("origin")),
      "cache-control": "public, s-maxage=60, stale-while-revalidate=60",
    },
  })
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getHomeSuggestions } from "@/lib/home-suggestions/server"

// 첫 화면 「지금 할 일」 — 후보는 열 때마다 코드로 모으고, AI 는 정책(lib/home-suggestions/rules.ts)대로만 부른다
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  return NextResponse.json(await getHomeSuggestions(session.user.id))
}

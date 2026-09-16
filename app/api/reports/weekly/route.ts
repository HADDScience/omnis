import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  deleteWeeklyReport,
  listWeeklyReports,
  updateWeeklyReport,
  upsertThisWeekReport,
} from "@/lib/weekly-report"

// 알맹이는 lib/weekly-report 에 있다 — MCP(list_weekly_reports · write_weekly_report)도 같은 함수를 부른다.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  return NextResponse.json(await listWeeklyReports(session.user.id))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const { generateDraft } = await req.json()
  const report = await upsertThisWeekReport(session.user.id, { generateDraft })
  return NextResponse.json(report, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const { id, markdown, status } = await req.json()
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const result = await updateWeeklyReport(session.user.id, { id, markdown, status })
  return "error" in result
    ? NextResponse.json({ error: result.error }, { status: result.code })
    : NextResponse.json(result.report)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const result = await deleteWeeklyReport(session.user.id, id)
  return "error" in result
    ? NextResponse.json({ error: result.error }, { status: result.code })
    : NextResponse.json(result)
}

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isAdminSession } from "@/lib/company-edit"
import { syncWorksCalendars } from "@/lib/caldav/sync"

// 웍스 캘린더를 당긴다. 캘린더 화면이 열릴 때 · 주/월을 넘길 때 · 보이는 탭에서 60초마다 부른다.
// 60초 안에 이미 시도했으면 요청 없이 돌아온다 — 몇 명이 열어 두든 웍스로 가는 요청은 분당 한 번이다.
// mydocs/tech/calendar.md 2.2 · mydocs/tech/request-budget.md

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const admin = isAdminSession(session)
  // 처음부터 다시 받기는 관리자만 — 전체를 다시 받으면 요청이 십여 건 든다
  const force = admin && new URL(req.url).searchParams.get("force") === "1"

  const report = await syncWorksCalendars({ force })
  if (!report.configured) return NextResponse.json({ status: "unconfigured", changed: 0 })
  if (report.skipped) return NextResponse.json({ status: "skipped", changed: 0 })

  const changed = report.calendars.reduce((n, c) => n + c.fetched + c.deleted, 0)
  const failed = report.calendars.filter((c) => c.status === "error")
  return NextResponse.json({
    status: failed.length > 0 ? "partial" : "synced",
    changed,
    // 오류 내용(경로 · 상태 코드)은 관리자에게만
    ...(admin ? { requests: report.requests, calendars: report.calendars, missing: report.missing } : {}),
  })
}

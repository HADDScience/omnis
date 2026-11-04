import { redirect } from "next/navigation"
import { Header } from "@/components/layout/header"
import { auth } from "@/lib/auth"
import { isAdminSession } from "@/lib/company-edit"
import { CalendarView } from "./calendar-view"

export const dynamic = "force-dynamic"

// 캘린더 — 옴니스의 날짜(업무 마감 · 회사 기록 · CRM …)와 웍스에서 들여온 회사 일정을 한 달 칸에.
// 데이터는 화면이 /api/calendar 로 받는다. 달을 넘길 때마다 서버를 다시 그리지 않으려고.
// mydocs/tech/calendar.md
// ?day=YYYY-MM-DD 는 그 날을 고른 채 연다 — 새 일정 알림(calendar_event_added)이 이 주소로 온다
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const { month, day } = await searchParams
  const validDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null

  return (
    <>
      <Header title="캘린더" />
      <CalendarView isAdmin={isAdminSession(session)} initialMonth={validDay ? validDay.slice(0, 7) : (month ?? null)} initialDay={validDay} />
    </>
  )
}

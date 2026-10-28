import { redirect } from "next/navigation"

/** 워크스페이스 화면은 「업무」 탭으로 합쳤다 — 현황은 업무 목록 위 띠, 관계도는 보기 토글에 있다. */
export default function DashboardPage() {
  redirect("/tasks")
}

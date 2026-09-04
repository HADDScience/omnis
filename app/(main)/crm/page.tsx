import { redirect } from "next/navigation"

// CRM 의 첫 화면은 견적이다 — 가장 자주 여는 곳이 입구여야 한다.
export default function CrmIndexPage() {
  redirect("/crm/quotes")
}

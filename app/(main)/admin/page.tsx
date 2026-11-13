import { redirect } from "next/navigation"

import { requireAdminPage } from "@/lib/admin-access-server"
import { ADMIN_HOME } from "@/lib/admin-sections"

export default async function AdminIndex() {
  await requireAdminPage()
  redirect(ADMIN_HOME)
}

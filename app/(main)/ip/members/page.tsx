import type { Metadata } from "next"

import { MembersView } from "@/components/ip/members-view"

export const metadata: Metadata = {
  title: "멤버 · 지식재산권",
}

export default function Page() {
  return <MembersView />
}

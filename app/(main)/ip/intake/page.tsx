import type { Metadata } from "next"

import { IntakeView } from "@/components/ip/intake-view"

export const metadata: Metadata = {
  title: "메일로 입력 · 지식재산권",
}

export default function Page() {
  return <IntakeView />
}

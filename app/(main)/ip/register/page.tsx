import type { Metadata } from "next"

import { RegisterView } from "@/components/ip/register-view"

export const metadata: Metadata = {
  title: "IP · 지식재산권",
}

export default function Page() {
  return <RegisterView />
}

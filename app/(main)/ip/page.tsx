import type { Metadata } from "next"

import { OverviewView } from "@/components/ip/overview-view"

export const metadata: Metadata = { title: "지식재산권" }

export default function Page() {
  return <OverviewView />
}

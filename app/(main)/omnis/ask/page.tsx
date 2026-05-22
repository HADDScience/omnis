import type { Metadata } from "next"
import { OmnisAsk } from "@/components/omnis/omnis-ask"

export const metadata: Metadata = {
  title: "옴니스에게 질문 · Omnis",
}

export default function OmnisAskPage() {
  return <OmnisAsk />
}

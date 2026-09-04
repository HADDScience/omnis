import type { Metadata } from "next"
import { Header } from "@/components/layout/header"
import { OmnisAsk } from "@/components/omnis/omnis-ask"

export const metadata: Metadata = {
  title: "옴니스에게 질문 · Omnis",
}

export default function OmnisAskPage() {
  return (
    <>
      <Header crumbs={["HADD DB", "옴니스에게 질문"]} />
      <OmnisAsk />
    </>
  )
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createContact } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 기관에 담당자 한 명 — 규칙은 lib/crm-ops.ts createContact(도구 create_contact 와 같다) */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const r = await createContact(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}

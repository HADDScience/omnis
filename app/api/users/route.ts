import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const users = await prisma.user.findMany({
    where: ACTIVE_MEMBER_WHERE,
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(users)
}

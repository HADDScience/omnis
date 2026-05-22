import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const products = await prisma.product.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, color: true },
  })

  return NextResponse.json(products)
}

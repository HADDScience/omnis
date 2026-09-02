import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { findOrCreateProduct } from "@/lib/project-resolve"


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

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) {
    return NextResponse.json({ error: "name 필수" }, { status: 400 })
  }

  const { product, reused } = await prisma.$transaction((tx) =>
    findOrCreateProduct(tx, name, typeof body?.color === "string" ? body.color : null)
  )

  return NextResponse.json(product, { status: reused ? 200 : 201 })
}

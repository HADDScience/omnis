import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const products = await prisma.product.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, color: true },
  })

  return NextResponse.json(products)
}

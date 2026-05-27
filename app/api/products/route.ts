import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

/** 신규 제품에 순환 배정할 색상 팔레트 (기존 제품 색상과 동일 계열) */
const PRODUCT_COLORS = [
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
]

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

  // 같은 이름의 제품이 이미 있으면 그대로 반환 (멱등 — 재시도/중복 제출 방어)
  const existing = await prisma.product.findUnique({
    where: { name },
    select: { id: true, name: true, color: true },
  })
  if (existing) return NextResponse.json(existing)

  const count = await prisma.product.count()
  const color =
    typeof body?.color === "string" && body.color.trim()
      ? body.color.trim()
      : PRODUCT_COLORS[count % PRODUCT_COLORS.length]

  const product = await prisma.product.create({
    data: { name, color, sortOrder: count },
    select: { id: true, name: true, color: true },
  })

  return NextResponse.json(product, { status: 201 })
}

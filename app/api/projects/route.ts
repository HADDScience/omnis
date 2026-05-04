import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const projects = await prisma.project.findMany({
    where: { archived: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      product: { select: { id: true, name: true, color: true } },
    },
  })

  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { name, productId } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: "name 필수" }, { status: 400 })
  }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      status: "진행 중",
      productId: productId || null,
    },
    select: {
      id: true,
      name: true,
      status: true,
      product: { select: { id: true, name: true, color: true } },
    },
  })

  return NextResponse.json(project, { status: 201 })
}

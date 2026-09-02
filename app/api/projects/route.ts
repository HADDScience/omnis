import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { findOrCreateProject } from "@/lib/project-resolve"

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
  const { name, productId, purpose, goal } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: "name 필수" }, { status: 400 })
  }

  const { project, reused } = await prisma.$transaction((tx) =>
    findOrCreateProject(tx, { name, productId, purpose, goal })
  )

  // reused=true면 기존 프로젝트를 재사용했다는 뜻 — 클라이언트가 사용자에게 알릴 수 있다
  return NextResponse.json({ ...project, reused }, { status: reused ? 200 : 201 })
}

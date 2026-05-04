import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(users)
}

import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const rooms = await prisma.chatRoom.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { author: { select: { name: true } } },
      },
    },
  })
  return NextResponse.json(rooms)
}

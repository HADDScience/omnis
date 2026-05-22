import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { OmnisCardDetail } from "./card-detail"
import { VersionHistory } from "@/components/omnis/version-history"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ cardId: string }>
}

export default async function OmnisCardPage({ params }: Props) {
  const { cardId } = await params
  const session = await auth()
  const userId = session?.user?.id as string | undefined

  const [card, allCards, bookmark] = await Promise.all([
    prisma.omnisCard.findUnique({
      where: { id: cardId },
      include: {
        category: { select: { name: true, icon: true } },
        updatedBy: { select: { name: true } },
      },
    }),
    prisma.omnisCard.findMany({
      where: { id: { not: cardId } },
      select: { id: true, title: true },
    }),
    userId
      ? prisma.bookmark.findUnique({
          where: { userId_cardId: { userId, cardId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  if (!card) notFound()

  if (userId) {
    await prisma.omnisViewLog.create({
      data: { cardId: card.id, userId },
    })
    await writeActivity({
      userId,
      action: "omnis.viewed",
      entity: "OMNIS_CARD",
      entityId: card.id,
      title: `카드 열람: ${card.title}`,
    })
  }

  return (
    <>
      <Header title="HADD DB" />
      <div className="flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          <OmnisCardDetail
            card={{
              ...card,
              createdAt: card.createdAt.toISOString(),
              updatedAt: card.updatedAt.toISOString(),
            }}
            allCards={allCards}
            initialBookmarked={!!bookmark}
          />
        </div>
        <VersionHistory cardId={card.id} />
      </div>
    </>
  )
}

import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { OmnisCardDetail } from "./card-detail"
import { VersionHistory } from "@/components/omnis/version-history"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ cardId: string }>
}

export default async function OmnisCardPage({ params }: Props) {
  const { cardId } = await params

  const [card, allCards] = await Promise.all([
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
  ])

  if (!card) notFound()

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
          />
        </div>
        <VersionHistory cardId={card.id} />
      </div>
    </>
  )
}

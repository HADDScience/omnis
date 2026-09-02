import { normalizeProjectName } from "@/lib/project-name"
import type { Prisma } from "@/generated/prisma/client"

/**
 * 제품·프로젝트를 "있으면 쓰고 없으면 만드는" 해석기.
 *
 * 트랜잭션 클라이언트를 받는 이유가 전부다(인수인계 §5-B-2 고아 프로젝트):
 * 예전에는 클라이언트가 제품 → 프로젝트 → 업무를 **세 번의 HTTP 요청**으로 만들었고,
 * 마지막 업무 생성이 실패하면 앞서 만든 제품·프로젝트가 주인 없이 남았다.
 * 같은 트랜잭션 안에서 셋을 만들면 업무가 실패할 때 앞의 둘도 함께 사라진다.
 */

const PROJECT_SELECT = {
  id: true,
  name: true,
  status: true,
  product: { select: { id: true, name: true, color: true } },
} as const

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

export type ResolvedProject = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>

/**
 * 공백·대소문자만 다른 이름은 같은 프로젝트로 보고 기존 것을 돌려준다.
 * 같은 이름이 동시에 들어오면 advisory lock으로 직렬화한다 — 잠그지 않으면
 * 양쪽이 "없음"을 보고 둘 다 만든다.
 */
export async function findOrCreateProject(
  tx: Prisma.TransactionClient,
  input: { name: string; productId?: string | null; purpose?: string | null; goal?: string | null }
): Promise<{ project: ResolvedProject; reused: boolean }> {
  const normalized = normalizeProjectName(input.name)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project:${normalized}`}))`

  const candidates = await tx.project.findMany({
    where: { archived: false },
    orderBy: { createdAt: "asc" },
    select: PROJECT_SELECT,
  })
  const existing = candidates.find((c) => normalizeProjectName(c.name) === normalized)
  if (existing) return { project: existing, reused: true }

  const project = await tx.project.create({
    data: {
      name: input.name.trim(),
      status: "진행 중",
      productId: input.productId || null,
      purpose: input.purpose?.trim() || null,
      goal: input.goal?.trim() || null,
    },
    select: PROJECT_SELECT,
  })
  return { project, reused: false }
}

/** 제품명은 유니크라 이름 일치만으로 멱등하다. */
export async function findOrCreateProduct(
  tx: Prisma.TransactionClient,
  rawName: string,
  color?: string | null
) {
  const name = rawName.trim()
  const existing = await tx.product.findUnique({
    where: { name },
    select: { id: true, name: true, color: true },
  })
  if (existing) return { product: existing, reused: true }

  const count = await tx.product.count()
  const product = await tx.product.create({
    data: {
      name,
      color: color?.trim() || PRODUCT_COLORS[count % PRODUCT_COLORS.length],
      sortOrder: count,
    },
    select: { id: true, name: true, color: true },
  })
  return { product, reused: false }
}

interface NodeRect {
  id: string
  position: { x: number; y: number }
  measured?: { width?: number; height?: number }
  width?: number
  height?: number
  parentId?: string
}

interface CollisionOptions {
  maxIterations?: number
  overlapThreshold?: number
  margin?: number
}

function getNodeRect(node: NodeRect) {
  const w = node.measured?.width ?? node.width ?? 100
  const h = node.measured?.height ?? node.height ?? 50
  return {
    x: node.position.x,
    y: node.position.y,
    w,
    h,
    right: node.position.x + w,
    bottom: node.position.y + h,
  }
}

function getOverlap(a: ReturnType<typeof getNodeRect>, b: ReturnType<typeof getNodeRect>, margin: number) {
  const overlapX = Math.min(a.right + margin, b.right + margin) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.bottom + margin, b.bottom + margin) - Math.max(a.y, b.y)

  if (overlapX <= 0 || overlapY <= 0) return null
  return { x: overlapX, y: overlapY }
}

export function resolveCollisions<T extends NodeRect>(
  nodes: T[],
  options: CollisionOptions = {}
): T[] {
  const { maxIterations = 50, margin = 20 } = options

  // 부모 노드(제품 방)만 충돌 처리 — 자식은 부모 안에서 상대 좌표
  const topLevel = nodes.filter((n) => !n.parentId)
  const children = nodes.filter((n) => n.parentId)

  const result = topLevel.map((n) => ({
    ...n,
    position: { ...n.position },
  }))

  for (let iter = 0; iter < maxIterations; iter++) {
    let hasCollision = false

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = getNodeRect(result[i])
        const b = getNodeRect(result[j])
        const overlap = getOverlap(a, b, margin)

        if (!overlap) continue
        hasCollision = true

        // 겹침이 적은 축으로 밀어내기
        if (overlap.x < overlap.y) {
          const push = overlap.x / 2
          if (a.x < b.x) {
            result[i].position.x -= push
            result[j].position.x += push
          } else {
            result[i].position.x += push
            result[j].position.x -= push
          }
        } else {
          const push = overlap.y / 2
          if (a.y < b.y) {
            result[i].position.y -= push
            result[j].position.y += push
          } else {
            result[i].position.y += push
            result[j].position.y -= push
          }
        }
      }
    }

    if (!hasCollision) break
  }

  return [...result, ...children]
}

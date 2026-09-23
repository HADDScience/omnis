"use client"

const nodes = [
  { label: "Next.js", x: 10, y: 20 },
  { label: "Prisma", x: 85, y: 20 },
  { label: "PostgreSQL", x: 95, y: 55 },
  { label: "Gemini 2.5", x: 85, y: 85 },
  { label: "NextAuth", x: 10, y: 85 },
  { label: "Synology", x: 0, y: 55 },
]

export function AnimatedBeamHub() {
  const center = { x: 50, y: 50 }
  return (
    <div className="relative mx-auto h-[360px] w-full max-w-[720px]">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {nodes.map((n, i) => (
          <line
            key={i}
            x1={center.x}
            y1={center.y}
            /* 선은 이름표 쪽으로 4 만큼 파고든다. 오른쪽 이름표는 왼쪽으로 자라므로 부호가 반대다. */
            x2={n.x > 50 ? n.x - 4 : n.x + 4}
            y2={n.y + 4}
            stroke="color-mix(in oklch, var(--primary) 40%, transparent)"
            strokeWidth={0.25}
            strokeDasharray="1 2"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to="-6"
              dur="3s"
              repeatCount="indefinite"
            />
          </line>
        ))}
      </svg>
      <div
        className="absolute flex h-16 w-16 items-center justify-center rounded-2xl bg-primary font-bold text-primary-foreground shadow-xl shadow-primary/30"
        style={{ left: "calc(50% - 32px)", top: "calc(50% - 32px)" }}
      >
        Omnis
      </div>
      {/*
        이름표는 가까운 쪽 가장자리에 붙여 **안쪽으로 자라게** 한다.
        전부 left 로 잡으면 오른쪽 이름표(x=95)가 자기 너비만큼 밖으로 나가고,
        그 폭이 문서 전체를 넓혀 버린다 — 좁은 화면에서는 사파리가 그 폭에 맞춰
        축소해 화면 오른쪽에 흰 여백이 생긴다. (2026-09-23)
      */}
      {nodes.map((n) => (
        <div
          key={n.label}
          className="absolute inline-flex items-center rounded-md border bg-card px-3 py-1.5 text-[12px] font-medium shadow-sm"
          style={
            n.x > 50
              ? { right: `${100 - n.x}%`, top: `${n.y}%` }
              : { left: `${n.x}%`, top: `${n.y}%` }
          }
        >
          {n.label}
        </div>
      ))}
    </div>
  )
}

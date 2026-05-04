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
            x2={n.x + 4}
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
      {nodes.map((n) => (
        <div
          key={n.label}
          className="absolute inline-flex items-center rounded-md border bg-card px-3 py-1.5 text-[12px] font-medium shadow-sm"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          {n.label}
        </div>
      ))}
    </div>
  )
}

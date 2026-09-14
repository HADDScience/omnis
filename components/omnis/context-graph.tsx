"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { apiUrl } from "@/lib/base-path"
import { NODE_TYPE_COLOR, NODE_TYPE_LABEL, type ContextNode, type Neighborhood } from "@/lib/context-graph-types"

type GraphNodeData = { node: ContextNode; center: boolean }

const CENTER_HANDLE = { top: "50%", bottom: "auto", left: "50%", transform: "translate(-50%, -50%)" } as const

function GraphNode({ data }: NodeProps) {
  const { node, center } = data as unknown as GraphNodeData
  return (
    <div
      className={`w-[170px] rounded-lg border bg-card px-2.5 py-2 text-left shadow-sm transition-colors ${
        center ? "border-primary ring-2 ring-primary/30" : "cursor-pointer hover:border-border-strong"
      }`}
    >
      {/* 연결점을 노드 한가운데에 둔다 — 위 · 아래에 두면 방사형 배치에서 선이 다른 노드를 가로지른다.
          선은 노드 아래에 그려져 상자에 가려지고, 이름표만 가운데에 남는다 */}
      <Handle type="target" position={Position.Top} isConnectable={false} style={CENTER_HANDLE} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={CENTER_HANDLE} className="!pointer-events-none !opacity-0" />
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_TYPE_COLOR[node.type] }} aria-hidden />
        {NODE_TYPE_LABEL[node.type]}
      </div>
      <div className="mt-0.5 line-clamp-2 break-words text-[12px] font-medium leading-snug">{node.label}</div>
      {node.sub && <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{node.sub}</div>}
    </div>
  )
}

const nodeTypes = { ctx: GraphNode } as unknown as NodeTypes
const NODE_W = 170
const NODE_H = 64

/** 가운데 하나 · 안쪽 고리 = 실선 이웃 · 바깥 고리 = 점선 이웃 */
function layout(data: Neighborhood): { nodes: Node[]; edges: Edge[] } {
  const fkKeys = new Set(data.edges.filter((e) => e.kind === "fk").flatMap((e) => [e.from, e.to]))
  const fk = data.nodes.filter((n) => fkKeys.has(n.key))
  const vec = data.nodes.filter((n) => !fkKeys.has(n.key))
  const inner = Math.max(240, fk.length * 30)
  const outer = inner + 230
  const at = (n: ContextNode, angle: number, r: number, center = false): Node => ({
    id: n.key,
    type: "ctx",
    position: { x: Math.cos(angle) * r - NODE_W / 2, y: Math.sin(angle) * r * 0.75 - NODE_H / 2 },
    data: { node: n, center } satisfies GraphNodeData,
    draggable: false,
    selectable: !center,
  })
  const ring = (list: ContextNode[], r: number, offset: number) =>
    list.map((n, i) => at(n, offset + (2 * Math.PI * i) / Math.max(list.length, 1), r))

  return {
    nodes: [at(data.center, 0, 0, true), ...ring(fk, inner, -Math.PI / 2), ...ring(vec, outer, -Math.PI / 2 + 0.35)],
    edges: data.edges.map((e) => ({
      id: `${e.from}>${e.to}>${e.kind}>${e.label}`,
      source: e.from,
      target: e.to,
      type: "straight",
      label: e.label,
      labelStyle: { fontSize: 10, fill: "var(--color-muted-foreground)" },
      labelBgStyle: { fill: "var(--color-card)" },
      style:
        e.kind === "vector"
          ? { stroke: "var(--color-primary)", strokeDasharray: "5 5", strokeWidth: 1.2 }
          : { stroke: "var(--color-border-strong)", strokeWidth: 1.2 },
    })),
  }
}

export function ContextGraph({ initial, suggestions, missing }: { initial: Neighborhood | null; suggestions: ContextNode[]; missing: boolean }) {
  const [data, setData] = useState<Neighborhood | null>(initial)
  const [loading, setLoading] = useState(false)
  const [trail, setTrail] = useState<ContextNode[]>(initial ? [initial.center] : [])
  const [q, setQ] = useState("")
  const [results, setResults] = useState<ContextNode[] | null>(null)
  const [searching, setSearching] = useState(false)
  const reqRef = useRef(0)

  useEffect(() => {
    if (missing) toast.error("찾을 수 없거나 볼 수 없는 대상입니다")
  }, [missing])

  const load = useCallback(async (key: string, push = true) => {
    const req = ++reqRef.current
    setLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/context/graph?node=${encodeURIComponent(key)}`))
      const body = (await res.json().catch(() => null)) as (Neighborhood & { error?: string }) | null
      if (!res.ok || !body) throw new Error(body?.error ?? "그래프를 불러오지 못했습니다")
      if (req !== reqRef.current) return
      setData(body)
      setResults(null)
      setTrail((t) => [...t.filter((x) => x.key !== body.center.key), body.center].slice(-8))
      if (push) window.history.pushState({ node: key }, "", apiUrl(`/omnis/context?node=${encodeURIComponent(key)}`))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "그래프를 불러오지 못했습니다")
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const onPop = () => {
      const key = new URLSearchParams(window.location.search).get("node")
      if (key) void load(key, false)
      else setData(null)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [load])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      const res = await fetch(apiUrl(`/api/context/search?q=${encodeURIComponent(q)}`))
      const body = (await res.json().catch(() => null)) as { results?: ContextNode[]; error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? "찾지 못했습니다")
      setResults(body?.results ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "찾지 못했습니다")
    } finally {
      setSearching(false)
    }
  }

  const flow = useMemo(() => (data ? layout(data) : null), [data])
  const groups = useMemo(() => {
    if (!data) return []
    const byLabel = new Map<string, { kind: "fk" | "vector"; nodes: ContextNode[] }>()
    for (const e of data.edges) {
      const other = e.from === data.center.key ? e.to : e.from
      const n = data.nodes.find((x) => x.key === other)
      if (!n) continue
      const label = e.kind === "vector" ? "의미상 가까움" : e.label
      const g = byLabel.get(label) ?? { kind: e.kind, nodes: [] }
      if (!g.nodes.some((x) => x.key === n.key)) g.nodes.push(n)
      byLabel.set(label, g)
    }
    return [...byLabel.entries()]
  }, [data])

  return (
    <div>
      <form onSubmit={search} role="search" className="mb-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="업무 · 프로젝트 · 사람 · 기관 · 특허 이름으로 찾기"
          aria-label="Context 에서 찾기"
          className="touch-target min-w-0 flex-1 rounded-lg border bg-card px-3 py-2 text-[13px] outline-none focus:border-border-strong"
        />
        {searching && <Spinner />}
      </form>

      {results && (
        <div className="mb-3 rounded-xl border bg-card p-2">
          {results.length === 0 ? (
            <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">「{q}」 과 이름이 맞는 대상이 없습니다</p>
          ) : (
            <NodeList nodes={results} onPick={(k) => void load(k)} />
          )}
        </div>
      )}

      {!data || !flow ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyTitle>가운데에 둘 대상을 고르세요</EmptyTitle>
            <EmptyDescription>
              고른 대상을 가운데 두고 DB 로 이어진 것(실선)과 의미상 가까운 것(점선)을 펼칩니다. 이웃을 누르면 그쪽으로 옮겨 갑니다.
            </EmptyDescription>
          </EmptyHeader>
          {suggestions.length > 0 && (
            <div className="mt-2 w-full max-w-[640px] text-left">
              <NodeList nodes={suggestions} onPick={(k) => void load(k)} />
            </div>
          )}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative h-[58vh] min-h-[380px] overflow-hidden rounded-xl border bg-card">
            <ReactFlow
              key={data.center.key}
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => {
                if (n.id !== data.center.key) void load(n.id)
              }}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.2}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              zoomOnScroll={false}
              preventScrolling={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border-strong)" />
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-card/90 px-2 py-1 text-[10.5px] text-muted-foreground">
              <span>── DB 연결 (사실)</span>
              <span className="text-primary">- - 의미상 가까움 (추정 · 유사도)</span>
            </div>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-card/50" aria-live="polite">
                <Spinner />
              </div>
            )}
          </div>

          <aside aria-label="가운데 대상" className="flex min-w-0 flex-col gap-3">
            <div className="rounded-xl border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{NODE_TYPE_LABEL[data.center.type]}</Badge>
                {data.center.sub && <span className="text-[11.5px] text-muted-foreground">{data.center.sub}</span>}
                {typeof data.ms === "number" && <span className="ml-auto text-[10.5px] text-muted-foreground">{data.ms}ms</span>}
              </div>
              <h2 className="mt-1 break-words text-[15px] font-semibold leading-snug">{data.center.label}</h2>
              {data.center.href && (
                <Link href={data.center.href} className="mt-1 inline-block text-[12px] text-muted-foreground hover:underline">
                  상세 화면 열기
                </Link>
              )}
              {data.truncated.map((t) => (
                <p key={t} className="mt-1 text-[11px] text-muted-foreground">
                  {t}
                </p>
              ))}
            </div>

            <div className="rounded-xl border bg-card p-3.5">
              <h3 className="text-[12.5px] font-semibold">연결 {data.nodes.length}</h3>
              {groups.length === 0 ? (
                <p className="mt-1 text-[12px] text-muted-foreground">이어진 대상이 없습니다</p>
              ) : (
                groups.map(([label, g]) => (
                  <div key={label} className="mt-2">
                    <div className={`text-[11px] ${g.kind === "vector" ? "text-primary" : "text-muted-foreground"}`}>
                      {label} · {g.nodes.length}
                    </div>
                    <NodeList nodes={g.nodes} onPick={(k) => void load(k)} compact />
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border bg-card p-3.5">
              <h3 className="text-[12.5px] font-semibold">AI 가 읽는 조각 {data.chunks.length}</h3>
              {data.chunkNote && <p className="mt-0.5 text-[11px] text-muted-foreground">{data.chunkNote}</p>}
              {data.chunks.length === 0 ? (
                !data.chunkNote && <p className="mt-1 text-[12px] text-muted-foreground">임베딩된 조각이 없습니다</p>
              ) : (
                <div className="mt-1.5 flex max-h-[360px] flex-col gap-1 overflow-y-auto">
                  {data.chunks.map((c) => (
                    <details key={c.id} className="rounded-md border px-2 py-1.5">
                      <summary className="cursor-pointer break-words text-[12px]">
                        <span className="text-[10.5px] text-muted-foreground">{c.source === "CHAT_MESSAGE" ? "채팅" : "본문"} · </span>
                        {c.title}
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">{c.content}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>

            {trail.length > 1 && (
              <nav aria-label="지나온 대상" className="flex flex-wrap gap-1">
                {trail.slice(0, -1).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => void load(t.key)}
                    className="touch-target max-w-[160px] truncate rounded-full border bg-muted px-2.5 py-0.5 text-[11px] hover:border-border-strong"
                  >
                    ← {t.label}
                  </button>
                ))}
              </nav>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function NodeList({ nodes, onPick, compact = false }: { nodes: ContextNode[]; onPick: (key: string) => void; compact?: boolean }) {
  return (
    <ul className={`flex flex-col ${compact ? "mt-0.5" : ""}`}>
      {nodes.map((n) => (
        <li key={n.key}>
          <button
            type="button"
            onClick={() => onPick(n.key)}
            className="touch-target flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_TYPE_COLOR[n.type] }} aria-hidden />
            <span className="shrink-0 text-[10.5px] text-muted-foreground">{NODE_TYPE_LABEL[n.type]}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{n.label}</span>
            {n.sub && <span className="shrink-0 text-[10.5px] text-muted-foreground">{n.sub}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { ProductRoomNodeData } from "@/lib/workspace-types"

interface ProductRoomNodeProps {
  data: ProductRoomNodeData
}

export const ProductRoomNode = memo(function ProductRoomNode({
  data,
}: ProductRoomNodeProps) {
  return (
    <div
      className="relative flex min-w-[200px] flex-col gap-1 rounded-2xl border-2 px-4 py-3 shadow-sm"
      style={{
        borderColor: data.color + "40",
        background: `linear-gradient(135deg, ${data.color}08, ${data.color}14)`,
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="h-3 w-3 rounded-full shadow-sm"
          style={{
            backgroundColor: data.color,
            boxShadow: `0 0 8px ${data.color}60`,
          }}
        />
        <span className="text-sm font-bold tracking-tight text-foreground">
          {data.name}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">
        {data.activeProjectCount}개 진행
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-none !bg-muted-foreground/40"
      />
    </div>
  )
})

"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnOrderState,
  type VisibilityState,
} from "@tanstack/react-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon, SortingIcon, FilterIcon } from "@hugeicons/core-free-icons"

interface DashboardListsProps {
  gajumMarkdown: string
  gwajaeMarkdown: string
}

function parseMarkdownTable(md: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = md.trim().split("\n").filter((l) => l.trim())
  if (lines.length < 3) return { headers: [], rows: [] }
  const headers = lines[0].split("|").map((h) => h.trim()).filter(Boolean)
  const rows = lines.slice(2).map((line) => {
    const cells = line.split("|").map((c) => c.trim())
    const filtered = cells.slice(1, cells.length - 1)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = filtered[i] || "" })
    return obj
  })
  return { headers, rows }
}

// 과제 리스트 기본 정렬: 마감 안 된 것 위로, 접수마감일 가까운 순
function sortGwajae(rows: Record<string, string>[]): Record<string, string>[] {
  const priority: Record<string, number> = {
    "준비 중": 0, "진행 중": 0, "검토 필요": 1, "신청 완료": 2, "마감": 3,
  }
  return [...rows].sort((a, b) => {
    const pa = priority[a["가능여부"]] ?? 1
    const pb = priority[b["가능여부"]] ?? 1
    if (pa !== pb) return pa - pb
    const da = a["접수마감일"] || "9999"
    const db = b["접수마감일"] || "9999"
    return da.localeCompare(db)
  })
}

// 가점항목 기본 정렬: 미보유 + 난이도 낮은 것 위로
function sortGajum(rows: Record<string, string>[]): Record<string, string>[] {
  const boyuPri: Record<string, number> = { "미보유": 0, "보유": 2 }
  const nanPri: Record<string, number> = { "하": 0, "중": 1, "상": 2 }
  return [...rows].sort((a, b) => {
    const ba = boyuPri[a["보유"]] ?? 1
    const bb = boyuPri[b["보유"]] ?? 1
    if (ba !== bb) return ba - bb
    const na = nanPri[a["난이도"]] ?? 1
    const nb = nanPri[b["난이도"]] ?? 1
    return na - nb
  })
}

function statusColor(val: string) {
  if (val === "마감") return "bg-muted text-muted-foreground"
  if (val.includes("준비") || val.includes("진행")) return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
  if (val.includes("완료")) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
  if (val.includes("검토")) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
  return ""
}

function boyuColor(val: string) {
  if (val === "보유") return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
  if (val === "미보유") return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
  return ""
}

function GenericDataTable({ headers, rows, searchPlaceholder, badgeCols, defaultSorter }: {
  headers: string[]
  rows: Record<string, string>[]
  searchPlaceholder: string
  badgeCols?: Record<string, (val: string) => string>
  defaultSorter?: (rows: Record<string, string>[]) => Record<string, string>[]
}) {
  const sortedRows = React.useMemo(() => defaultSorter ? defaultSorter(rows) : rows, [rows, defaultSorter])
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(headers)

  // 컬럼별 내용물 최대 길이 기반으로 기본 너비 계산
  const colSizes = React.useMemo(() => {
    const sizes: Record<string, number> = {}
    headers.forEach((h) => {
      const headerLen = h.length
      const maxContentLen = rows.reduce((max, row) => Math.max(max, (row[h] || "").length), 0)
      const charWidth = 8 // 대략적인 글자 너비 (px)
      const padding = 32
      const computed = Math.max(headerLen, maxContentLen) * charWidth + padding
      sizes[h] = Math.max(60, Math.min(computed, 300))
    })
    return sizes
  }, [headers, rows])

  const columns: ColumnDef<Record<string, string>>[] = React.useMemo(() => headers.map((h) => ({
    accessorKey: h,
    header: ({ column }) => (
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {h}
        {column.getIsSorted() === "asc" ? " ↑" : column.getIsSorted() === "desc" ? " ↓" : ""}
      </button>
    ),
    cell: ({ row }) => {
      const val = row.getValue(h) as string
      const colorFn = badgeCols?.[h]
      if (colorFn) {
        const color = colorFn(val)
        return color
          ? <Badge variant="secondary" className={`text-[10px] whitespace-nowrap ${color}`}>{val}</Badge>
          : <span className="text-xs">{val}</span>
      }
      return <span className="text-xs">{val}</span>
    },
    size: colSizes[h] ?? 100,
    minSize: 50,
    maxSize: 400,
    enableResizing: true,
  })), [headers, badgeCols, colSizes])

  const table = useReactTable({
    data: sortedRows,
    columns,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
    columnResizeMode: "onChange",
    state: { sorting, globalFilter, columnVisibility, columnOrder },
    onGlobalFilterChange: setGlobalFilter,
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <HugeiconsIcon icon={Search01Icon} size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8 text-xs gap-1" />}>
            <HugeiconsIcon icon={FilterIcon} size={12} />
            컬럼
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table.getAllColumns().map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                checked={col.getIsVisible()}
                onCheckedChange={(v) => col.toggleVisibility(!!v)}
                className="text-xs"
              >
                {col.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-auto max-h-[350px] rounded-md border">
        <table
          className="w-full caption-bottom text-sm"
          style={{ width: table.getCenterTotalSize() }}
        >
          <thead className="[&_tr]:border-b sticky top-0 bg-background z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="text-[10px] px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap relative select-none"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50 ${header.column.getIsResizing() ? "bg-primary" : ""}`}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b hover:bg-muted/50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-2 py-1.5 text-xs truncate"
                      style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-16 text-center text-xs text-muted-foreground">
                  검색 결과 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <span className="text-[10px] text-muted-foreground">{table.getFilteredRowModel().rows.length}건</span>
    </div>
  )
}

export function DashboardLists({ gajumMarkdown, gwajaeMarkdown }: DashboardListsProps) {
  const gwajae = parseMarkdownTable(gwajaeMarkdown)
  const gajum = parseMarkdownTable(gajumMarkdown)

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">과제 리스트</CardTitle>
        </CardHeader>
        <CardContent>
          {gwajae.rows.length > 0 ? (
            <GenericDataTable
              headers={gwajae.headers}
              rows={gwajae.rows}
              searchPlaceholder="사업과제명 검색..."
              badgeCols={{ "가능여부": statusColor }}
              defaultSorter={sortGwajae}
            />
          ) : <p className="text-sm text-muted-foreground">데이터 없음</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">가점항목 리스트</CardTitle>
        </CardHeader>
        <CardContent>
          {gajum.rows.length > 0 ? (
            <GenericDataTable
              headers={gajum.headers}
              rows={gajum.rows}
              searchPlaceholder="인증명 검색..."
              badgeCols={{ "보유": boyuColor }}
              defaultSorter={sortGajum}
            />
          ) : <p className="text-sm text-muted-foreground">데이터 없음</p>}
        </CardContent>
      </Card>
    </div>
  )
}

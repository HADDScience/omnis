"use client"

import { useEffect, useMemo, useState } from "react"
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { apiUrl } from "@/lib/base-path"
import { rankFolders } from "@/lib/grants-match"
import type { NasEntry } from "@/lib/nas"

const ROOT = "/HADD Science/(2026) 예비 지원과제"

async function dirs(path: string): Promise<{ name: string; path: string }[]> {
  const r = await fetch(apiUrl(`/api/nas?path=${encodeURIComponent(path)}`))
  if (!r.ok) return []
  const d = (await r.json()) as { kind: string; entries?: NasEntry[] }
  return (d.entries ?? [])
    .filter((e) => e.isDir)
    .map((e) => ({ name: e.name.normalize("NFC"), path: e.path }))
}

/** 「(2026) 예비 지원과제」(와 99.불참 또는 탈락 과제) 폴더 고르기 — 과제명과 비슷한 순서로 위에 */
export function NasFolderPicker({
  id,
  value,
  title,
  extraTitles,
  onChange,
}: {
  id: string
  value: string
  title: string
  extraTitles: string[]
  onChange: (path: string) => void
}) {
  const [folders, setFolders] = useState<
    { name: string; path: string }[] | null
  >(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const top = await dirs(ROOT)
      const drop = top.find((f) => f.name.startsWith("99."))
      const inner = drop ? await dirs(drop.path) : []
      if (alive) setFolders([...top.filter((f) => f !== drop), ...inner])
    })().catch(() => alive && setFolders([]))
    return () => {
      alive = false
    }
  }, [])

  const ranked = useMemo(
    () => (folders ? rankFolders(title, folders, extraTitles) : []),
    [folders, title, extraTitles]
  )
  if (folders === null) return <Skeleton className="h-9 w-full rounded-md" />

  const rankedPaths = new Set(ranked.map((f) => f.path))
  const rest = folders
    .filter((f) => !rankedPaths.has(f.path))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
  const known = value === "" || folders.some((f) => f.path === value)
  return (
    <NativeSelect
      id={id}
      className="w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <NativeSelectOption value="">없음</NativeSelectOption>
      {!known && (
        <NativeSelectOption value={value}>
          {value.split("/").pop()}
        </NativeSelectOption>
      )}
      {ranked.length > 0 && (
        <NativeSelectOptGroup label="비슷한 폴더">
          {ranked.map((f) => (
            <NativeSelectOption key={f.path} value={f.path}>
              {f.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      )}
      <NativeSelectOptGroup label="모든 폴더">
        {rest.map((f) => (
          <NativeSelectOption key={f.path} value={f.path}>
            {f.name}
          </NativeSelectOption>
        ))}
      </NativeSelectOptGroup>
    </NativeSelect>
  )
}

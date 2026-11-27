"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  File02Icon,
  Folder01Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons"
import { Skeleton } from "@/components/ui/skeleton"
import { apiUrl } from "@/lib/base-path"
import { formatBytes } from "@/lib/room-drawer"
import type { NasEntry } from "@/lib/nas"
import { attLine, type AttView } from "@/lib/grant-attachments"

export interface AttachmentView {
  name: string
  type: string | null
  size: number | null
  href: string
}

function TypeBadge({ type }: { type: string | null }) {
  return (
    <span className="inline-flex h-5 min-w-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] px-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
      {type ?? "파일"}
    </span>
  )
}

/** 공고 첨부 — 원문 사이트에서 받는다(기업마당은 서버가 새 토큰을 얻어 보낸다) */
export function AttachmentList({
  title,
  items,
  status,
}: {
  title: string
  items: AttachmentView[]
  /** 수집기가 원문에서 확인한 첨부 상태(있음 · 없음 · 확인 불가)와 다 읽지 못한 첨부 */
  status?: AttView | null
}) {
  const line = attLine(status ?? null)
  if (items.length === 0 && !line) return null
  return (
    <div>
      <h4 className="mb-1 text-[11.5px] font-medium text-muted-foreground">
        {title}
      </h4>
      {line && (
        <p className="mb-1 px-1.5 text-[11.5px] text-muted-foreground" data-grant-att-status={status?.status}>
          {line}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((a, i) => (
          <li key={`${a.name}-${i}`}>
            <a
              href={a.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-h-9 items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] transition-colors hover:bg-foreground/[0.04]"
            >
              <TypeBadge type={a.type} />
              <span className="min-w-0 flex-1 truncate group-hover:underline">
                {a.name}
              </span>
              {status?.byName[a.name] && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[10.5px] text-amber-700 dark:text-amber-300" data-grant-att-unread>
                  {status.byName[a.name]}
                </span>
              )}
              {a.size !== null && (
                <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                  {formatBytes(a.size)}
                </span>
              )}
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                strokeWidth={2}
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Listing =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; entries: NasEntry[] }

/** NAS 폴더 안 파일 — 펼칠 때 읽고, 파일은 옴니스가 중계해 바로 연다(/api/nas) */
export function NasFolderFiles({ path }: { path: string }) {
  const [listing, setListing] = useState<Listing>({ state: "loading" })
  useEffect(() => {
    let alive = true
    fetch(apiUrl(`/api/nas?path=${encodeURIComponent(path)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(
        (d: { kind: string; entries?: NasEntry[] }) =>
          alive &&
          setListing(
            d.kind === "dir"
              ? { state: "ok", entries: d.entries ?? [] }
              : { state: "error" }
          )
      )
      .catch(() => alive && setListing({ state: "error" }))
    return () => {
      alive = false
    }
  }, [path])

  const name = path.split("/").pop() ?? path
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <HugeiconsIcon
          icon={Folder01Icon}
          strokeWidth={2}
          className="size-3.5"
          aria-hidden
        />
        <Link
          href={`/omnis/nas?path=${encodeURIComponent(path)}`}
          className="truncate hover:underline"
        >
          {name}
        </Link>
      </h4>
      {listing.state === "loading" ? (
        <div className="space-y-1.5 px-1.5 py-1" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-5 w-9 rounded-md" />
              <Skeleton
                className="h-3.5 flex-1"
                style={{ opacity: 1 - i * 0.2 }}
              />
            </div>
          ))}
        </div>
      ) : listing.state === "error" ? (
        <p className="px-1.5 text-[12px] text-muted-foreground">
          NAS 에 닿지 못했습니다
        </p>
      ) : listing.entries.length === 0 ? (
        <p className="px-1.5 text-[12px] text-muted-foreground">빈 폴더</p>
      ) : (
        <ul className="space-y-0.5">
          {[...listing.entries]
            .sort(
              (a, b) =>
                Number(b.isDir) - Number(a.isDir) ||
                a.name.localeCompare(b.name, "ko")
            )
            .map((e) => (
              <li key={e.path}>
                {e.isDir ? (
                  <Link
                    href={`/omnis/nas?path=${encodeURIComponent(e.path)}`}
                    className="group flex min-h-9 items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] transition-colors hover:bg-foreground/[0.04]"
                  >
                    <span className="inline-flex h-5 min-w-9 items-center justify-center">
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        strokeWidth={2}
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate group-hover:underline">
                      {e.name}
                    </span>
                  </Link>
                ) : (
                  <a
                    href={apiUrl(`/api/nas?path=${encodeURIComponent(e.path)}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-h-9 items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] transition-colors hover:bg-foreground/[0.04]"
                  >
                    <TypeBadge
                      type={
                        e.name
                          .match(/\.([A-Za-z0-9]{2,5})$/)?.[1]
                          ?.toLowerCase() ?? null
                      }
                    />
                    <span className="min-w-0 flex-1 truncate group-hover:underline">
                      {e.name}
                    </span>
                    {e.size !== null && (
                      <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                        {formatBytes(e.size)}
                      </span>
                    )}
                    <HugeiconsIcon
                      icon={File02Icon}
                      strokeWidth={2}
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </a>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

/** 공고 첨부와 NAS 폴더를 한 칸에 — 같은 사업이면 둘을 나란히 */
export function GrantFiles({
  attachments,
  nasFolder,
  status,
}: {
  attachments: AttachmentView[]
  nasFolder: string | null
  status?: AttView | null
}) {
  if (attachments.length === 0 && !nasFolder && !attLine(status ?? null)) return null
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 rounded-xl bg-background/50 p-2.5 md:grid-cols-2">
      <AttachmentList title="공고 첨부" items={attachments} status={status} />
      {nasFolder && <NasFolderFiles path={nasFolder} />}
    </div>
  )
}

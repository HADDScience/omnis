"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { SocialBadge } from "@/components/settings/social-badge"
import { UnlockButton } from "@/components/admin/unlock-button"
import { Checkbox } from "@/components/ui/checkbox"
import { ONBOARDING_STATUS_LABEL, type AdminUserRow, type OnboardingAdminAction } from "@/lib/admin-users"
import { apiUrl } from "@/lib/base-path"
import { seoulClock } from "@/lib/login-attempts"
import { cn } from "@/lib/utils"

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })
const fmt = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "–")
const CELL = "whitespace-nowrap px-2 py-2 align-middle"
const SMALL_BTN =
  "touch-target inline-flex min-h-8 items-center rounded-full border px-2.5 text-[11.5px] font-medium transition-colors hover:bg-muted disabled:opacity-50"

function Status({ u }: { u: AdminUserRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={u.role === "ADMIN" ? "rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary" : "rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground"}>
        {u.role === "ADMIN" ? "관리자" : "구성원"}
      </span>
      {!u.isActive && <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">쉬는 계정</span>}
    </span>
  )
}

function Lock({ u }: { u: AdminUserRow }) {
  if (u.lock.locked) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span data-lock-state="locked" className="text-[12.5px] font-medium text-destructive">{seoulClock(u.lock.until)}까지 잠김</span>
        <UnlockButton userId={u.id} name={u.name} />
      </span>
    )
  }
  return (
    <span data-lock-state="open" className="text-[12.5px] text-muted-foreground">
      {u.lock.fails > 0 ? `최근 실패 ${u.lock.fails}회` : "정상"}
    </span>
  )
}

function Social({ u }: { u: AdminUserRow }) {
  const providers = u.social.filter((p): p is "google" | "kakao" => p === "google" || p === "kakao")
  if (providers.length === 0) return <span className="text-muted-foreground">–</span>
  return (
    <span className="inline-flex gap-1">
      {providers.map((p) => (
        <SocialBadge key={p} provider={p} />
      ))}
    </span>
  )
}

/** 온보딩 칸 — 본 판/지금 판 · 상태 · 마지막으로 본 시각 */
function Onboarding({ u, current }: { u: AdminUserRow; current: number }) {
  const o = u.onboarding
  return (
    <span data-onboarding-state={o.status} className="flex flex-col leading-tight">
      <span className="text-[12.5px]">
        <span className="tabular-nums">{o.seen}/{current}판</span>
        <span className={cn("ml-1.5", o.status === "seen" ? "text-muted-foreground" : o.status === "due" ? "font-medium text-primary" : "text-destructive")}>
          {ONBOARDING_STATUS_LABEL[o.status]}
        </span>
      </span>
      <span className="text-[11.5px] text-muted-foreground tabular-nums">{o.lastSeenAt ? `본 시각 ${fmt(o.lastSeenAt)}` : "본 기록 없음"}</span>
    </span>
  )
}

/**
 * 계정 표 — PC 는 표, 폰은 한 사람 묶음. 체크해서 여러 명에게 온보딩 「다시 띄우기」 · 「끄기」 를 한꺼번에 하거나 줄마다 한다
 * (app/api/admin/onboarding — 사람마다 감사 기록). 메일은 서버에서 가려 온다.
 */
export function AdminUsersTable({ users, current }: { users: AdminUserRow[]; current: number }) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const allOn = picked.size > 0 && picked.size === users.length

  async function apply(action: OnboardingAdminAction, ids: string[]) {
    if (busy || ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(apiUrl("/api/admin/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userIds: ids }),
      })
      if (!res.ok) throw new Error(`바꾸지 못했습니다 (${res.status})`)
      const body = (await res.json()) as { names: string[] }
      const who = body.names.length === 1 ? `${body.names[0]} 님` : `${body.names.length}명`
      toast.success(action === "replay" ? `${who}에게 다음 화면에 안내가 다시 뜹니다` : `${who}의 이번 판 안내를 껐습니다`)
      setPicked(new Set())
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "바꾸지 못했습니다")
    } finally {
      setBusy(false)
    }
  }

  const RowButtons = ({ u }: { u: AdminUserRow }) => (
    <span className="inline-flex gap-1">
      <button type="button" data-onboarding-row-replay={u.name} disabled={busy} onClick={() => void apply("replay", [u.id])} className={SMALL_BTN}>
        다시 띄우기
      </button>
      <button type="button" data-onboarding-row-dismiss={u.name} disabled={busy || u.onboarding.status === "seen"} onClick={() => void apply("dismiss", [u.id])} className={SMALL_BTN}>
        끄기
      </button>
    </span>
  )

  return (
    <>
      {/* 고른 사람 한꺼번에 — 고른 사람이 있을 때만 단추가 살아난다 */}
      <div data-onboarding-bulk className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
        <label className="touch-target inline-flex items-center gap-2 md:hidden">
          <Checkbox checked={allOn} onCheckedChange={(v) => setPicked(v ? new Set(users.map((u) => u.id)) : new Set())} aria-label="모두 고르기" />
          모두
        </label>
        <span className="text-muted-foreground">{picked.size}명 고름</span>
        <button type="button" data-onboarding-bulk-replay disabled={busy || picked.size === 0} onClick={() => void apply("replay", [...picked])} className={SMALL_BTN}>
          고른 사람 다시 띄우기
        </button>
        <button type="button" data-onboarding-bulk-dismiss disabled={busy || picked.size === 0} onClick={() => void apply("dismiss", [...picked])} className={SMALL_BTN}>
          고른 사람 끄기
        </button>
      </div>

      {/* PC — 표 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className={`${CELL} w-8`}>
                <Checkbox checked={allOn} onCheckedChange={(v) => setPicked(v ? new Set(users.map((u) => u.id)) : new Set())} aria-label="모두 고르기" />
              </th>
              {["이름 · 소셜", "웍스 메일", "역할 · 상태", "마지막 로그인", "임시 비밀번호", "온보딩", "로그인 잠금"].map((h) => (
                <th key={h} scope="col" className={`${CELL} font-medium`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-admin-user={u.name} className="border-b last:border-b-0">
                <td className={CELL}>
                  <Checkbox checked={picked.has(u.id)} onCheckedChange={(v) => toggle(u.id, v === true)} aria-label={`${u.name} 고르기`} />
                </td>
                <th scope="row" className={`${CELL} text-left font-medium`}>
                  <span className="inline-flex items-center gap-1.5">
                    {u.name}
                    {u.social.length > 0 && <Social u={u} />}
                  </span>
                </th>
                <td className={`${CELL} font-mono text-[12px]`}>{u.maskedEmail ?? <span className="text-muted-foreground">없음</span>}</td>
                <td className={CELL}><Status u={u} /></td>
                <td className={`${CELL} tabular-nums`}>{fmt(u.lastLoginAt)}</td>
                <td className={CELL}>{u.tempPassword ? <span className="text-destructive">사용 중</span> : <span className="text-muted-foreground">–</span>}</td>
                <td className={CELL}>
                  <span className="flex flex-col items-start gap-1">
                    <Onboarding u={u} current={current} />
                    <RowButtons u={u} />
                  </span>
                </td>
                <td className={CELL}><Lock u={u} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 폰 — 한 사람 한 묶음 */}
      <ul className="flex flex-col divide-y md:hidden">
        {users.map((u) => (
          <li key={u.id} data-admin-user-card={u.name} className="flex gap-2.5 py-3 first:pt-0 last:pb-0">
            <Checkbox className="mt-0.5" checked={picked.has(u.id)} onCheckedChange={(v) => toggle(u.id, v === true)} aria-label={`${u.name} 고르기`} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{u.name}</span>
                  {u.social.length > 0 && <Social u={u} />}
                </span>
                <Status u={u} />
              </div>
              <span className="truncate font-mono text-[12px] text-muted-foreground">{u.maskedEmail ?? "메일 없음"}</span>
              <span className="text-[12px] text-muted-foreground">
                마지막 로그인 <span className="tabular-nums">{fmt(u.lastLoginAt)}</span>
                {u.tempPassword && <span className="text-destructive"> · 임시 비밀번호 사용 중</span>}
              </span>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Onboarding u={u} current={current} />
                <RowButtons u={u} />
              </div>
              <Lock u={u} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

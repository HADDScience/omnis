import type { Metadata } from "next"

import { SocialBadge } from "@/components/settings/social-badge"
import { UnlockButton } from "@/components/admin/unlock-button"
import { requireAdminPage } from "@/lib/admin-access-server"
import { CODE_EVENT_LABEL, CODE_HISTORY_DAYS, type AdminUserRow } from "@/lib/admin-users"
import { loadAdminUsers, loadLoginCodeHistory } from "@/lib/admin-users-server"
import { seoulClock } from "@/lib/login-attempts"

export const metadata: Metadata = { title: "사용자" }
export const dynamic = "force-dynamic"

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })
const fmt = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "–")

const SECTION = "glass rounded-2xl p-4"
const CELL = "whitespace-nowrap px-2 py-2 align-middle"

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
  if (u.social.length === 0) return <span className="text-muted-foreground">–</span>
  return (
    <span className="inline-flex gap-1">
      {u.social.filter((p): p is "google" | "kakao" => p === "google" || p === "kakao").map((p) => (
        <SocialBadge key={p} provider={p} />
      ))}
    </span>
  )
}

/**
 * 사용자 — 계정 목록 · 로그인 잠금 · 로그인 코드 기록. 보기와 잠금 해제만 한다(비활성 · 역할 바꾸기는 넣지 않는다).
 * 메일은 서버에서 가려 온다 · 비밀번호 · 해시 · 코드 값은 질의에도 오르지 않는다(lib/admin-users-server.ts)
 */
export default async function AdminUsersPage() {
  await requireAdminPage()
  const [users, codes] = await Promise.all([loadAdminUsers(), loadLoginCodeHistory()])
  const locked = users.filter((u) => u.lock.locked).length
  const temp = users.filter((u) => u.tempPassword && u.isActive).length

  return (
    <>
      <section aria-labelledby="admin-users-title" className={SECTION} data-admin-users>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="admin-users-title" className="text-base font-semibold">계정</h1>
          <p className="text-[12.5px] text-muted-foreground">
            {users.length}명 · 활성 {users.filter((u) => u.isActive).length} · 잠김 {locked} · 임시 비밀번호 {temp}
          </p>
        </div>

        {/* PC — 표 */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12px] text-muted-foreground">
              <tr className="border-b">
                {["이름", "웍스 메일", "역할 · 상태", "마지막 로그인", "소셜", "임시 비밀번호", "로그인 잠금"].map((h) => (
                  <th key={h} scope="col" className={`${CELL} font-medium`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-admin-user={u.name} className="border-b last:border-b-0">
                  <th scope="row" className={`${CELL} text-left font-medium`}>{u.name}</th>
                  <td className={`${CELL} font-mono text-[12px]`}>{u.maskedEmail ?? <span className="text-muted-foreground">없음</span>}</td>
                  <td className={CELL}><Status u={u} /></td>
                  <td className={`${CELL} tabular-nums`}>{fmt(u.lastLoginAt)}</td>
                  <td className={CELL}><Social u={u} /></td>
                  <td className={CELL}>{u.tempPassword ? <span className="text-destructive">사용 중</span> : <span className="text-muted-foreground">–</span>}</td>
                  <td className={CELL}><Lock u={u} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 폰 — 한 사람 한 줄 묶음 */}
        <ul className="flex flex-col divide-y md:hidden">
          {users.map((u) => (
            <li key={u.id} data-admin-user-card={u.name} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
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
              <Lock u={u} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          마지막 로그인은 비밀번호 · 로그인 코드로 들어온 때입니다. 잠금은 15분 안에 5번 틀리면 걸리고 15분 뒤 저절로 풀립니다. 「잠금 해제」 는 실패 수를 0 으로 되돌리고 기록 탭에 남습니다.
        </p>
      </section>

      <section aria-labelledby="admin-codes-title" className={SECTION} data-admin-login-codes>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-codes-title" className="text-base font-semibold">로그인 코드 기록</h2>
          <p className="text-[12.5px] text-muted-foreground">최근 {CODE_HISTORY_DAYS}일 · {codes.length}건 · 코드 값은 남기지도 보이지도 않습니다</p>
        </div>
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">최근 {CODE_HISTORY_DAYS}일 동안 보낸 코드가 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {codes.map((c) => (
              <li key={c.id} data-code-event={c.action} className="flex flex-wrap gap-x-2">
                <span className="w-[7.5rem] shrink-0 text-muted-foreground tabular-nums">{fmt(c.at)}</span>
                <span className="font-medium">{c.userName}</span>
                <span className={c.action === "wrong" ? "text-destructive" : "text-muted-foreground"}>{CODE_EVENT_LABEL[c.action] ?? c.action}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

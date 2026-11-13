import type { Metadata } from "next"

import { AdminUsersTable } from "@/components/admin/users-table"
import { OnboardingReplay } from "@/components/settings/onboarding-replay"
import { requireAdminPage } from "@/lib/admin-access-server"
import { CODE_EVENT_LABEL, CODE_HISTORY_DAYS } from "@/lib/admin-users"
import { loadAdminUsers, loadLoginCodeHistory } from "@/lib/admin-users-server"
import { currentOnboardingVersion } from "@/lib/onboarding-version-store"

export const metadata: Metadata = { title: "사용자" }
export const dynamic = "force-dynamic"

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })
const fmt = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "–")

const SECTION = "glass rounded-2xl p-4"

/**
 * 사용자 — 계정 목록 · 온보딩 조절 · 로그인 잠금 · 로그인 코드 기록. 계정에 대한 쓰기는 잠금 해제와 온보딩 판뿐이다
 * (비활성 · 역할 바꾸기는 넣지 않는다). 「모두에게 온보딩 다시 띄우기」 도 이 표 위에 있다(2026-11-13, 운영 탭에서 옮김).
 * 메일은 서버에서 가려 온다 · 비밀번호 · 해시 · 코드 값은 질의에도 오르지 않는다(lib/admin-users-server.ts)
 */
export default async function AdminUsersPage() {
  await requireAdminPage()
  const [users, codes, current] = await Promise.all([loadAdminUsers(), loadLoginCodeHistory(), currentOnboardingVersion()])
  const locked = users.filter((u) => u.lock.locked).length
  const temp = users.filter((u) => u.tempPassword && u.isActive).length

  return (
    <>
      <section aria-labelledby="admin-onboarding-title" className={SECTION} data-admin-onboarding>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="admin-onboarding-title" className="text-base font-semibold">사용 안내(온보딩)</h2>
            <p className="text-[12.5px] text-muted-foreground">
              지금 <span data-onboarding-version className="font-medium text-foreground tabular-nums">{current}판</span> · 봤음 {users.filter((u) => u.onboarding.status === "seen").length} · 다시 뜰 예정 {users.filter((u) => u.onboarding.status === "due").length} · 안 봄 {users.filter((u) => u.onboarding.status === "never").length}
            </p>
          </div>
          <OnboardingReplay version={current} />
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">한 사람씩은 아래 표의 「다시 띄우기」 · 「끄기」 로, 여러 명은 체크해서 한꺼번에. 모든 조작은 기록 탭에 남습니다.</p>
      </section>

      <section aria-labelledby="admin-users-title" className={SECTION} data-admin-users>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="admin-users-title" className="text-base font-semibold">계정</h1>
          <p className="text-[12.5px] text-muted-foreground">
            {users.length}명 · 활성 {users.filter((u) => u.isActive).length} · 잠김 {locked} · 임시 비밀번호 {temp}
          </p>
        </div>

        <AdminUsersTable users={users} current={current} />
        <p className="mt-3 text-[12px] text-muted-foreground">
          마지막 로그인은 비밀번호 · 로그인 코드로 들어온 때입니다. 잠금은 15분 안에 5번 틀리면 걸리고 15분 뒤 저절로 풀립니다. 「잠금 해제」 는 실패 수를 0 으로 되돌리고 기록 탭에 남습니다. 온보딩 「다시 띄우기」 는 그 사람만 다음 화면에 안내가 뜨고, 「끄기」 는 이번 판을 본 것으로 둡니다.
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

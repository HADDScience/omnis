import { redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getMembership } from "@/lib/ip-data"
import { ApproveButton } from "./approve-button"

/**
 * AI 도구가 지식재산권 기록에 접근해도 되는지 사람이 승인하는 화면.
 *
 * 예전에는 정적 앱(ip-platform)에 두고 Supabase 세션 토큰을 헤더로 넘겨받았다.
 * Omnis 안으로 들어오면서 그 왕복이 사라졌다 — 여기는 이미 로그인 세션이 있는
 * 자리라, 로그인 화면을 새로 만들 필요도 토큰을 손으로 옮길 필요도 없다.
 *
 * 이 화면이 인가 흐름에서 유일하게 사람이 개입하는 지점이다. 무엇을 승인하는지
 * (어느 도구인지)를 반드시 보여준다 — 확인 없이 통과시키면 아무 클라이언트나
 * 등록해 놓고 사용자를 이 주소로 흘려보내는 것으로 접근을 얻는다.
 */
export const dynamic = "force-dynamic"

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ req?: string }>
}) {
  const { req } = await searchParams
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/ip-mcp/authorize?req=${req ?? ""}`)}`)
  }

  const membership = await getMembership(session.user.id)

  const rows = req
    ? await prisma.$queryRaw<{ client_id: string; client_name: string; expires_at: Date }[]>`
        SELECT r.client_id, c.client_name, r.expires_at
          FROM ip.oauth_requests r
          JOIN ip.oauth_clients c ON c.client_id = r.client_id
         WHERE r.id = ${req}::uuid`
    : []
  const request = rows[0]
  const expired = request ? request.expires_at < new Date() : false

  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-[420px]">
        <div className="mb-6">
          <p className="text-[12px] font-semibold text-primary">HADD IP</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">
            AI 도구 연결 승인
          </h1>
        </div>

        {!membership ? (
          <Notice
            title="지식재산권 자료에 접근할 수 없는 계정입니다"
            body="Omnis 계정은 있지만 지식재산권 구성원이 아닙니다. 담당자에게 권한을 요청하세요."
          />
        ) : !request ? (
          <Notice
            title="만료되었거나 없는 요청입니다"
            body="연결을 처음부터 다시 시작해 주세요. 승인 요청은 10분이 지나면 사라집니다."
          />
        ) : expired ? (
          <Notice
            title="요청이 만료되었습니다"
            body="AI 도구에서 연결을 다시 시작해 주세요."
          />
        ) : (
          <>
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">아래 도구가 접근을 요청합니다.</p>
              <p className="mt-2 text-[17px] font-semibold">
                {request.client_name || request.client_id}
              </p>
              <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-muted-foreground">
                <li>· 상표·특허 목록과 진행 이력을 읽습니다</li>
                <li>
                  ·{" "}
                  {membership.role === "viewer"
                    ? "읽기 전용 권한이라 기록을 남기지는 못합니다"
                    : "진행 기록을 남기고 값을 고칠 수 있습니다"}
                </li>
                <li>· 접근 권한은 8시간마다 갱신되며 언제든 끊을 수 있습니다</li>
              </ul>
              <p className="mt-4 border-t border-border pt-3 text-[12px] text-muted-foreground">
                승인하는 계정: <span className="font-medium text-foreground">{session.user.name}</span>{" "}
                ({membership.role})
              </p>
            </div>

            <ApproveButton req={req!} />

            <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
              요청한 적이 없다면 이 창을 닫으세요. 승인하지 않으면 아무 일도 일어나지 않습니다.
            </p>
          </>
        )}
      </div>
    </main>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{body}</p>
    </div>
  )
}

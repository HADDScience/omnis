"use client"

import { createContext, useContext, useEffect, useState } from "react"

import { Header } from "@/components/layout/header"
import { api, OmnisError, omnisSettingsUrl } from "@/lib/ip/omnis"

interface Member {
  userId: string
  email: string
  displayName: string | null
  role: "owner" | "editor" | "viewer"
}

interface AuthValue {
  member: Member
  canWrite: boolean
  isOwner: boolean
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth 는 AuthGate 안에서만 쓸 수 있습니다.")
  return value
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "not-a-member" }
  | { kind: "ready"; member: Member }

/**
 * 구성원 게이트.
 *
 * 로그인은 Omnis 레이아웃이 이미 끝냈다 — 여기 들어왔다면 쿠키 세션이 있다.
 * ip-platform 시절의 표 교환·자동 진입은 다른 오리진이라 필요했던 것이라 걷었다.
 * 남은 질문은 하나, 「이 사람이 지식재산권 구성원인가」 뿐이다.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    api<{ me: Member }>("/snapshot")
      .then((snap) => {
        if (!cancelled) setPhase({ kind: "ready", member: snap.me })
      })
      .catch((err) => {
        if (cancelled) return
        // 구성원이 아닌 것은 로그인 문제가 아니다 — 다시 로그인하라고 하면 몇 번을 해도 같다.
        if (err instanceof OmnisError && err.code === "not_a_member") {
          setPhase({ kind: "not-a-member" })
          return
        }
        setPhase({
          kind: "error",
          message: err instanceof OmnisError ? err.message : "자료를 불러오지 못했습니다.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (phase.kind === "loading") {
    return (
      <Centered>
        <p className="text-muted-foreground">확인 중…</p>
      </Centered>
    )
  }

  if (phase.kind === "not-a-member") {
    return (
      <Centered>
        <div className="w-full max-w-sm">
          <h1 className="font-heading text-[18px] font-semibold tracking-tight">접근 권한이 없습니다</h1>
          <p className="mt-2 text-[13px]/relaxed text-muted-foreground">
            지식재산권 자료를 볼 수 있는 구성원이 아닙니다. 담당자에게 권한을 요청하세요.
          </p>
          <a
            href={omnisSettingsUrl()}
            className="mt-4 inline-flex text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            계정 설정
          </a>
        </div>
      </Centered>
    )
  }

  if (phase.kind === "error") {
    return (
      <Centered>
        <p role="alert" className="text-red-600 dark:text-red-400">
          {phase.message}
        </p>
      </Centered>
    )
  }

  return (
    <AuthContext.Provider
      value={{
        member: phase.member,
        canWrite: phase.member.role !== "viewer",
        isOwner: phase.member.role === "owner",
        // 로그아웃은 Omnis 계정 메뉴가 맡는다. 이 화면만 따로 빠져나갈 길은 없다.
        signOut: () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/** 자료를 받기 전에도 제목줄은 그린다 — 받은 뒤에 제목줄이 튀어나오면 화면이 덜컹인다. */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header crumbs={["아카이브", "지식재산권"]} />
      <div className="flex min-h-[60svh] items-center justify-center px-4 text-[13px]">
        {children}
      </div>
    </>
  )
}

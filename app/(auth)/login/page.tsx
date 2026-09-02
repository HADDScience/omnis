"use client"

import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight02Icon,
  LockPasswordIcon,
  MailAtSign01Icon,
  WorkflowSquare08Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { DemoAccountsCard } from "@/components/layout/demo-accounts-card"
import { SocialSignInButton, type SocialProvider } from "@/components/auth/social-buttons"

export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [socials, setSocials] = useState<SocialProvider[]>([])
  const [social, setSocial] = useState<SocialProvider | null>(null)

  // 어떤 소셜이 켜져 있는지는 서버 설정이 정한다. 화면에 고정해 두면
  // 키를 넣지 않은 제공자 버튼이 떠서 누르면 깨진다.
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((all: Record<string, unknown>) =>
        setSocials((["google", "kakao"] as const).filter((p) => p in all))
      )
      .catch(() => setSocials([]))
  }, [])

  // 연결되지 않은 소셜로 들어온 경우. 소셜만으로는 계정이 만들어지지 않는다.
  // useSearchParams 를 쓰면 이 페이지가 정적 프리렌더를 못 하므로 효과 안에서 직접 읽는다.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "notlinked") {
      setError(
        "아직 이 계정에 연결되지 않은 소셜 로그인입니다. 이름·비밀번호로 로그인한 뒤 설정 → 소셜 로그인 연결에서 연결해 주세요."
      )
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const result = await signIn("credentials", {
      name,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError("이름 또는 비밀번호가 올바르지 않습니다.")
      setLoading(false)
    } else {
      router.push("/dashboard")
      router.refresh()
    }
  }

  return (
    <main className="grid min-h-svh bg-background text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
      <aside className="relative hidden overflow-hidden bg-[#0b1020] text-white lg:flex lg:min-h-svh lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#0b1020_0%,#172554_46%,#4f46e5_100%)]" />
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="absolute right-[-120px] top-20 h-[360px] w-[360px] rounded-full border border-white/15" />
        <div className="absolute bottom-[-140px] left-[-100px] h-[420px] w-[420px] rounded-full border border-cyan-200/20" />
        <div className="absolute right-16 top-1/2 h-32 w-32 rotate-45 border border-white/15" />

        <div className="relative z-10 flex items-center gap-3 px-10 pt-10">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-primary p-1.5 shadow-2xl shadow-black/20 backdrop-blur">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/omnis-logo.png" alt="Omnis" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">Omnis</div>
            <div className="font-mono text-[10px] text-white/58">HADD Science</div>
          </div>
        </div>

        <div className="relative z-10 px-10 pb-14">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white/80 backdrop-blur">
            <HugeiconsIcon icon={WorkflowSquare08Icon} size={14} />
            Internal workspace
          </div>
          <h1 className="max-w-[560px] text-[44px] font-semibold leading-[1.05] tracking-normal xl:text-[56px]">
            업무, 지식, 보고를 하나의 흐름으로.
          </h1>
          <p className="mt-5 max-w-[480px] text-[15px] leading-7 text-white/70">
            HADD Science 팀의 지시, 실행 현황, 지식 자산을 채팅 기반 워크스페이스에서 빠르게 연결합니다.
          </p>

          <div className="mt-10 grid max-w-[520px] grid-cols-3 gap-3">
            {[
              ["Tasks", "실행 추적"],
              ["HADD DB", "지식 검색"],
              ["Reports", "보고 초안"],
            ].map(([title, caption]) => (
              <div key={title} className="rounded-lg border border-white/12 bg-white/8 p-3 backdrop-blur">
                <div className="text-[12px] font-semibold">{title}</div>
                <div className="mt-1 text-[10.5px] text-white/55">{caption}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-h-svh items-center justify-center bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-10 dark:bg-[linear-gradient(180deg,var(--background)_0%,#111111_100%)] sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-9 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary p-1.5 shadow-lg shadow-primary/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/omnis-logo.png" alt="Omnis" className="h-full w-full object-contain" />
              </div>
              <div className="leading-tight">
                <div className="text-[14px] font-semibold">Omnis</div>
                <div className="font-mono text-[9.5px] text-muted-foreground">HADD Science</div>
              </div>
            </Link>
            <Link
              href="/"
              className="text-[12px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              랜딩으로
            </Link>
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase text-primary">Welcome back</p>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-normal text-foreground">
              Sign in to Omnis
            </h1>
            <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
              사내 계정으로 로그인해 워크스페이스를 이어서 사용하세요.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-[12.5px] font-semibold text-foreground">
                이메일
              </Label>
              <div className="relative">
                <HugeiconsIcon
                  icon={MailAtSign01Icon}
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="name"
                  type="text"
                  aria-label="이름"
                  autoComplete="username"
                  placeholder="name@haddscience.com 또는 사내 이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-12 rounded-lg border-border bg-white pl-10 pr-3 text-[14px] shadow-sm placeholder:text-muted-foreground/70 dark:bg-input/30"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[12.5px] font-semibold text-foreground">
                  비밀번호
                </Label>
                <Link
                  href="/login"
                  className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <HugeiconsIcon
                  icon={LockPasswordIcon}
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 rounded-lg border-border bg-white pl-10 pr-3 text-[14px] shadow-sm placeholder:text-muted-foreground/70 dark:bg-input/30"
                />
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              aria-label="로그인"
              disabled={loading}
              className="mt-1 h-12 w-full rounded-lg text-[14px] font-semibold shadow-lg shadow-primary/20"
            >
              {loading ? <Spinner className="h-4 w-4" /> : null}
              <span>{loading ? "Signing in..." : "Sign in"}</span>
              {!loading ? <HugeiconsIcon icon={ArrowRight02Icon} size={16} /> : null}
            </Button>
          </form>

          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase text-muted-foreground">
              or continue with
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2.5">
            {socials.map((provider) => (
              <SocialSignInButton
                key={provider}
                provider={provider}
                disabled={social !== null}
                pending={social === provider}
                onClick={() => {
                  setSocial(provider)
                  signIn(provider, { callbackUrl: "/dashboard" })
                }}
              />
            ))}
            {socials.length === 0 && (
              <p className="text-center text-[12.5px] text-muted-foreground">
                소셜 로그인은 아직 설정되지 않았습니다.
              </p>
            )}
          </div>

          <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
            계정 접근이 필요하면 관리자에게 요청하세요.{" "}
            <Link href="/" className="font-semibold text-primary underline-offset-4 hover:underline">
              서비스 소개 보기
            </Link>
          </p>

          <div className="mt-6">
            <DemoAccountsCard />
          </div>
        </div>
      </section>
    </main>
  )
}

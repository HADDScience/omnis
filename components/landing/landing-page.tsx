"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Task01Icon,
  BookOpen01Icon,
  AiMagicIcon,
  FileAttachmentIcon,
  TimeQuarterPassIcon,
  Message01Icon,
  PlayIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons"
import { HeroVideo } from "./hero-video"
import { AuroraText } from "./aurora-text"
import { BentoCard } from "./bento-card"
import { BorderBeamButton } from "./border-beam-button"
import { AnimatedBeamHub } from "./animated-beam-hub"
import { CountUp } from "./count-up"

export function LandingPage() {
  return (
    <div className="bg-background text-foreground">
      {/* Top Nav */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[14px] font-bold text-primary-foreground">
              O
            </div>
            <span className="text-[14px] font-semibold">Omnis</span>
          </Link>
          <div className="hidden items-center gap-5 text-[13px] text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">기능</a>
            <a href="#workflow" className="hover:text-foreground">워크플로</a>
            <a href="#knowledge" className="hover:text-foreground">HADD DB</a>
            <a href="#metrics" className="hover:text-foreground">성과</a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              로그인
            </Link>
            <BorderBeamButton href="/login">시작하기</BorderBeamButton>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden pt-14">
        <HeroVideo src="/hero.mp4" />

        {/* grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-[900px] px-6 py-28 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
            <HugeiconsIcon icon={AiMagicIcon} size={11} className="text-primary" />
            HADD Science AI 워크스페이스
          </div>
          <h1 className="text-[clamp(40px,7vw,80px)] font-bold leading-[1.05] tracking-[-0.035em]">
            채팅 한 줄로,
            <br />
            <AuroraText>업무가 완성됩니다.</AuroraText>
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-[15px] leading-[1.65] text-muted-foreground">
            Omnis는 HADD Science의 전사 지식·업무·커뮤니케이션을 하나로 잇는 AI 워크스페이스입니다.
            메시지에 <span className="font-mono text-foreground">/업무</span>만 쓰면, 나머지는 AI가 채웁니다.
          </p>
          <div className="mt-8 flex items-center justify-center gap-2.5">
            <BorderBeamButton href="/login" variant="primary">
              무료로 시작하기 <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
            </BorderBeamButton>
            <a
              href="#workflow"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-[13px] font-medium transition-colors hover:border-border-strong"
            >
              <HugeiconsIcon icon={PlayIcon} size={11} />
              데모 보기
            </a>
          </div>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            HADD 전 구성원 사용 중
          </p>
        </div>
      </section>

      {/* Bento Features */}
      <section id="features" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="mb-10 text-center">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            왜 Omnis인가
          </div>
          <h2 className="text-[36px] font-bold tracking-[-0.02em]">
            과학자가 만든, 과학을 위한 도구
          </h2>
        </div>
        <div className="grid grid-cols-6 gap-4">
          <BentoCard
            className="col-span-6 lg:col-span-4"
            icon={Message01Icon}
            title="채팅 → 업무 자동화"
            description="/업무 @담당 '샘플 재검' D-0 한 줄이면 끝. 빈칸은 AI가 맥락으로 채웁니다."
            beam
          >
            <MockSlashDemo />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-2"
            icon={BookOpen01Icon}
            title="HADD DB 통합 검색"
            description="⌘K로 카드·업무·보고서를 한 번에. 33개 결과를 0.02초에."
          >
            <MockCommandK />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-2"
            icon={TimeQuarterPassIcon}
            title="git 기반 버전관리"
            description="모든 편집이 commit. 언제든 이전 버전으로 복원."
          >
            <MockVersionHistory />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-4"
            icon={AiMagicIcon}
            title="스레드 대화로 업무 재구성"
            description="#업무명 멘션하면 전체 스레드를 Gemini가 다시 구조화합니다."
          >
            <MockRebuild />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-3"
            icon={FileAttachmentIcon}
            title="주간 보고 자동 초안"
            description="이번 주 완료/진행 업무를 요약해 한 문장으로 전송."
          />
          <BentoCard
            className="col-span-6 lg:col-span-3"
            icon={Task01Icon}
            title="통합 스레드 뷰"
            description="하나의 메시지가 여러 스레드에 동시 출현. 뷰 관점의 자유."
          />
        </div>
      </section>

      {/* Workflow Showcase */}
      <section id="workflow" className="relative border-t bg-muted/30 py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                워크플로
              </div>
              <h2 className="mb-4 text-[32px] font-bold tracking-[-0.02em]">
                5초 업무 지시, 0초 문서화
              </h2>
              <ol className="flex flex-col gap-4 text-[13.5px] text-muted-foreground">
                {[
                  ["01", "Dock 입력창에 /업무 한 줄"],
                  ["02", "AI 자동생성으로 빈칸 채우기"],
                  ["03", "최종 확인 → 채팅에 업무 카드 게시"],
                  ["04", "담당자가 체크리스트 완료 → DONE 자동 전이"],
                  ["05", "#업무명 대화로 언제든 재구성"],
                ].map(([n, t]) => (
                  <li key={n} className="flex items-baseline gap-3">
                    <span className="font-mono text-[11px] text-primary">{n}</span>
                    <span className="text-foreground">{t}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="relative">
              <div
                className="rounded-xl border bg-card p-5 shadow-2xl"
                style={{ boxShadow: "0 30px 80px -20px color-mix(in oklch, var(--primary) 30%, transparent)" }}
              >
                <MockSlashDemo large />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Knowledge Showcase */}
      <section id="knowledge" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="relative">
            <div className="rounded-xl border bg-card p-5 shadow-xl">
              <MockCommandK large />
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              HADD DB
            </div>
            <h2 className="mb-4 text-[32px] font-bold tracking-[-0.02em]">
              회사의 모든 지식을 한 번의 검색으로
            </h2>
            <ul className="flex flex-col gap-3 text-[13.5px] text-muted-foreground">
              <li className="flex items-baseline gap-2">
                <span className="text-primary">●</span>
                <span>⌘K 글로벌 팔레트 · 카드/업무/보고서/액션 4개 섹션</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-primary">●</span>
                <span>모든 카드 <span className="font-mono">vN</span> 버전 배지 · git 기반 이력</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-primary">●</span>
                <span>편집은 자동 commit · 언제든 복원</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-primary">●</span>
                <span>참조 빈도로 &quot;인기 카드&quot;를 자동 추천</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="border-y bg-muted/20 py-24">
        <div className="mx-auto max-w-[1200px] px-6 text-center">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            기술 스택
          </div>
          <h2 className="mb-10 text-[32px] font-bold tracking-[-0.02em]">
            검증된 스택, 안전한 온프레미스
          </h2>
          <AnimatedBeamHub />
        </div>
      </section>

      {/* Metrics */}
      <section id="metrics" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <MetricCard value={80} suffix="%" label="업무 작성 시간 단축" />
          <MetricCard value={10} suffix="×" label="지식 검색 속도" />
          <MetricCard value={95} suffix="%" label="반복 질문 감소" />
          <MetricCard value={0} suffix="초" label="문서화 오버헤드" />
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden border-t">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(ellipse at top, color-mix(in oklch, var(--primary) 25%, transparent), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-[1200px] px-6 py-28 text-center">
          <h2 className="mb-5 text-[clamp(32px,5vw,56px)] font-bold tracking-[-0.025em]">
            지식이 흐르는 조직,
            <br />
            <AuroraText>지금 시작하세요.</AuroraText>
          </h2>
          <p className="mx-auto mb-8 max-w-[500px] text-[14px] text-muted-foreground">
            HADD Science 내부 계정으로 바로 로그인하세요.
          </p>
          <BorderBeamButton href="/login" variant="primary">
            시작하기 <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
          </BorderBeamButton>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-2 px-6 text-[11.5px] text-muted-foreground md:flex-row md:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
              O
            </div>
            <span>Made with science by HADD Science</span>
          </div>
          <div className="flex gap-5">
            <span>© {new Date().getFullYear()} HADD Science</span>
            <a href="https://github.com/HADDScience/omnis" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function MetricCard({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center">
      <div className="text-[44px] font-bold tracking-[-0.02em] text-primary">
        <CountUp to={value} />
        {suffix}
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">{label}</div>
    </div>
  )
}

function MockSlashDemo({ large }: { large?: boolean }) {
  return (
    <div className={["rounded-md border bg-background p-3", large ? "text-[13px]" : "text-[11.5px]"].join(" ")}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        <span className="ml-2 font-mono">dock · 전체</span>
      </div>
      <div className="rounded-md bg-muted px-2.5 py-1.5 font-mono">/업무 @박지훈 샘플 재검 D-0</div>
      <div className="mt-2 rounded-md border bg-card p-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-success)]">
          <HugeiconsIcon icon={Task01Icon} size={11} /> 업무 생성됨 · #A-25
        </div>
        <div className={["font-semibold", large ? "text-[14px]" : "text-[12px]"].join(" ")}>샘플 재검</div>
        <div className="mt-1 flex gap-2 text-[10.5px] text-muted-foreground">
          <span>담당 · 박지훈</span>
          <span className="text-destructive">마감 · D-0</span>
          <span>프로젝트 · 봄 시즌</span>
        </div>
      </div>
    </div>
  )
}

function MockCommandK({ large }: { large?: boolean }) {
  return (
    <div className={["rounded-md border bg-background p-2.5", large ? "text-[13px]" : "text-[11px]"].join(" ")}>
      <div className="flex items-center gap-1.5 border-b pb-2">
        <span className="text-muted-foreground">🔍</span>
        <span className="flex-1 text-foreground">HPLC</span>
        <span className="rounded border px-1 font-mono text-[9px]">esc</span>
      </div>
      <div className="mt-2 px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        HADD DB · 카드
      </div>
      <div className="mt-1 space-y-1">
        {[
          ["HPLC 세척 주기 개정", "공정 · v4", true],
          ["HPLC 교정 체크리스트", "장비 · v1", false],
        ].map(([t, m, hl], i) => (
          <div
            key={i}
            className={[
              "flex items-center gap-2 rounded px-2 py-1",
              hl ? "bg-muted" : "",
            ].join(" ")}
          >
            <HugeiconsIcon icon={BookOpen01Icon} size={11} className="text-muted-foreground" />
            <span className={["flex-1", hl ? "font-semibold" : ""].join(" ")}>{t}</span>
            <span className="font-mono text-[9px] text-muted-foreground">{m}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MockVersionHistory() {
  return (
    <div className="flex flex-col gap-1.5 text-[10.5px]">
      {[
        ["a1b2c3d", "현재", "이수민"],
        ["e4f5g6h", "v4 → v5", "이수민"],
        ["i7j8k9l", "v3 → v4", "정민호"],
      ].map(([h, m, a], i) => (
        <div key={i} className="flex items-center gap-1.5 rounded border bg-background px-2 py-1">
          <span className="font-mono text-muted-foreground">{h}</span>
          <span className="flex-1">{m}</span>
          <span className="text-muted-foreground">{a}</span>
        </div>
      ))}
    </div>
  )
}

function MockRebuild() {
  return (
    <div className="space-y-1.5 text-[11px]">
      <div className="rounded-md border bg-background px-2.5 py-1.5">
        <span className="font-mono text-primary">#A-24</span> 컬럼 압력 변동 있음. 세척 빈도 v3→v4로
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <HugeiconsIcon icon={AiMagicIcon} size={11} className="text-primary" />
        <span>Gemini가 체크리스트 3건 재생성</span>
      </div>
      <div className="rounded-md border bg-muted/50 px-2.5 py-1.5 text-[10.5px]">
        ✓ 압력 로그 확인 → ✓ 세척 주기 확인 → ☐ SOP v4 반영
      </div>
    </div>
  )
}

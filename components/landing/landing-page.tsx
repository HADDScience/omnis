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
      <nav
        className="fixed inset-x-0 border-b border-border/60 bg-background/70 backdrop-blur-xl"
        style={{ top: "var(--demo-banner-height, 0px)", zIndex: "var(--z-dock)" }}
      >
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[14px] font-bold text-primary-foreground">
              O
            </div>
            <span className="text-[14px] font-semibold">Omnis</span>
          </Link>
          <div className="hidden items-center gap-5 text-[13px] text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">해결 과제</a>
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
            Notion + Slack + 지식베이스 통합 운영 도구
          </div>
          <h1 className="text-[clamp(40px,7vw,80px)] font-bold leading-[1.05] tracking-[-0.035em]">
            흩어진 업무를,
            <br />
            <AuroraText>실행 가능한 카드로 바꿉니다.</AuroraText>
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-[15px] leading-[1.65] text-muted-foreground">
            Omnis는 HADD Science의 채팅 지시, 업무 카드, 보고서, 사내 지식을 한 화면에 묶는
            AI 운영 워크스페이스입니다. 메시지에 <span className="font-mono text-foreground">/업무</span>를 쓰면
            담당자·마감·체크리스트가 채워지고, 완료 이력은 HADD DB에 남습니다.
          </p>
          <div className="mt-8 flex items-center justify-center gap-2.5">
            <BorderBeamButton href="/login" variant="primary">
              내부 계정으로 시작하기 <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
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
            업무 지시 · 지식 검색 · 보고 초안을 하나의 흐름으로
          </p>
        </div>
      </section>

      {/* Bento Features */}
      <section id="features" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="mb-10 text-center">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            해결 과제
          </div>
          <h2 className="text-[36px] font-bold tracking-[-0.02em]">
            채팅, 문서, 보고가 따로 놀지 않게
          </h2>
          <p className="mx-auto mt-3 max-w-[640px] text-[14px] leading-[1.6] text-muted-foreground">
            실무자는 대화하듯 지시하고, 관리자는 누락 없이 추적하며, 반복 질문은 사내 지식 검색으로 줄입니다.
          </p>
        </div>
        <div className="grid grid-cols-6 gap-4">
          <BentoCard
            className="col-span-6 lg:col-span-4"
            icon={Message01Icon}
            title="채팅 → 업무 자동화"
            description="/업무 @담당 '샘플 재검' D-0 한 줄이면 업무명, 담당자, 마감, 체크리스트를 AI가 구조화합니다."
            beam
          >
            <MockSlashDemo />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-2"
            icon={BookOpen01Icon}
            title="HADD DB 통합 검색"
            description="⌘K로 제품, 인증, 지원사업, 업무, 보고서를 한 번에 찾아 같은 질문 반복을 줄입니다."
          >
            <MockCommandK />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-2"
            icon={TimeQuarterPassIcon}
            title="git 기반 버전관리"
            description="카드 편집 이력을 자동 저장해 변경 이유를 추적하고 이전 버전으로 복원합니다."
          >
            <MockVersionHistory />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-4"
            icon={AiMagicIcon}
            title="스레드 대화로 업무 재구성"
            description="#업무명을 멘션하면 흩어진 대화 맥락을 다시 읽어 다음 액션과 체크리스트로 정리합니다."
          >
            <MockRebuild />
          </BentoCard>
          <BentoCard
            className="col-span-6 lg:col-span-3"
            icon={FileAttachmentIcon}
            title="주간 보고 자동 초안"
            description="완료·진행·지연 업무를 모아 주간 보고 초안을 만들고 빠진 업데이트를 확인합니다."
          />
          <BentoCard
            className="col-span-6 lg:col-span-3"
            icon={Task01Icon}
            title="통합 스레드 뷰"
            description="같은 메시지를 업무, 담당자, 프로젝트 관점에서 다시 묶어 필요한 맥락만 빠르게 봅니다."
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
                지시는 채팅처럼, 관리는 카드처럼
              </h2>
              <p className="mb-6 max-w-[520px] text-[14px] leading-[1.65] text-muted-foreground">
                별도 양식을 열지 않아도 채팅 입력에서 업무가 생성되고, 담당자의 진행 상황은 대시보드와 보고서로 이어집니다.
              </p>
              <ol className="flex flex-col gap-4 text-[13.5px] text-muted-foreground">
                {[
                  ["01", "Dock 입력창에 /업무로 지시 작성"],
                  ["02", "AI가 담당자, 마감, 체크리스트 후보 생성"],
                  ["03", "최종 확인 후 채팅과 업무 보드에 카드 게시"],
                  ["04", "담당자가 체크리스트를 완료하면 상태 자동 전이"],
                  ["05", "#업무명 멘션으로 관련 대화와 이력을 재구성"],
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
              회사 지식은 찾을 수 있어야 자산이 됩니다
            </h2>
            <p className="mb-5 max-w-[520px] text-[14px] leading-[1.65] text-muted-foreground">
              인증, 지원사업, 고객사, 제품 자료처럼 반복해서 묻는 정보를 HADD DB 카드로 정리하고 업무 흐름 안에서 바로 참조합니다.
            </p>
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
            내부 데이터 흐름에 맞춘 검증된 스택
          </h2>
          <AnimatedBeamHub />
        </div>
      </section>

      {/* Metrics */}
      <section id="metrics" className="mx-auto max-w-[1200px] px-6 py-24">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <MetricCard value={80} suffix="%" label="업무 카드 작성 시간 단축" />
          <MetricCard value={10} suffix="×" label="사내 지식 탐색 속도" />
          <MetricCard value={95} suffix="%" label="반복 질문 감소 목표" />
          <MetricCard value={0} suffix="초" label="보고 초안 취합 대기" />
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
            채팅에서 끝나던 일을,
            <br />
            <AuroraText>추적 가능한 운영 흐름으로.</AuroraText>
          </h2>
          <p className="mx-auto mb-8 max-w-[500px] text-[14px] text-muted-foreground">
            HADD Science 내부 계정으로 로그인해 업무 지시, 지식 검색, 보고 초안을 바로 연결하세요.
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

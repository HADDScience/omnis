import Link from "next/link"
import { apiUrl } from "@/lib/base-path"
import { OmnisMark } from "@/components/brand/omnis-mark"
import type { LandingStats } from "@/lib/landing-stats"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiMagicIcon,
  BookOpen01Icon,
  BubbleChatIcon,
  FileAttachmentIcon,
  Task01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { CompanyTabs } from "./company-tabs"
import { DemoStage } from "./demo-stage"
import "./landing-v2.css"

/**
 * 새 랜딩 — 「HADD Science 는 이렇게 일한다」(mydocs/plans/2026-10-29-landing-v2.md).
 *
 * 보는 사람은 회사 밖(고객 · 투자자 · 지원기관)과 안(구성원) 모두다. 그래서 주어를 「HADD Science 는 / 우리는」 으로 쓴다 —
 * 밖에서 읽으면 자랑, 안에서 읽으면 「이게 우리 것이다」. 판매 문구(「당신의 업무를 혁신」)를 쓰지 않는다.
 * 구성원 수 · 얼굴 · 꾸민 숫자 · 후기 · 로고는 넣지 않는다(「정한 것」 1 · 2).
 */

export const CONTACT_MAIL = "mailto:jwoochang@haddscience.com"

/** stats 가 null 이면(세다가 실패) 「쌓이는 것」 섹션을 통째로 숨긴다 — 대신 넣을 숫자를 만들지 않는다 */
export function LandingV2({ stats }: { stats: LandingStats | null }) {
  return (
    <div className="lv2">
      <Nav />
      <main>
        <Hero />
        <StartWork />
        <ProgressWork />
        <Resources />
        <MyAi />
        {stats && <Stats stats={stats} />}
        <Closing />
      </main>
    </div>
  )
}

function Nav() {
  return (
    <nav className="lv2-nav" aria-label="랜딩">
      <div className="lv2-wrap lv2-nav-inner">
        <Link href="/" className="lv2-brand">
          <OmnisMark className="size-[30px] rounded-[9px]" />
          Omnis
          <small>HADD SCIENCE</small>
        </Link>
        <div className="lv2-nav-links">
          <a href="#start">업무</a>
          <a href="#resources">회사가 가진 것</a>
          <a href="#my-ai">나의 AI</a>
        </div>
        <Link href="/login" className="lv2-btn lv2-btn-light lv2-btn-small lv2-nav-enter">
          들어가기
        </Link>
      </div>
    </nav>
  )
}

/** 로고 타일 — 온보딩 영상 1장 「안녕하세요, Omnis 입니다」 의 그것. 옆에 늘 글자가 있어 그림은 읽지 않는다 */
function Mark({ className = "" }: { className?: string }) {
  return (
    <div className={`lv2-mark ${className}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={apiUrl("/omnis-logo.png")} alt="" />
    </div>
  )
}

function Wash() {
  return (
    <div className="lv2-wash" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  )
}

function Hero() {
  return (
    <section className="lv2-dark lv2-hero" aria-labelledby="lv2-hero-title">
      <Wash />
      <div className="lv2-wrap lv2-hero-inner">
        <Mark className="lv2-arrive" />
        <span className="lv2-eyebrow lv2-arrive lv2-arrive-2">HADD Science · Omnis</span>
        <h1 id="lv2-hero-title" className="lv2-display lv2-arrive lv2-arrive-2">
          HADD Science 는
          <br />
          <em>옴니스</em>와 함께 일합니다
        </h1>
        <p className="lv2-lede lv2-arrive lv2-arrive-3">
          회사의 대화 · 업무 · 기록이 지식으로 쌓이고, 묻는 사람에게 답합니다.
        </p>
        <div className="lv2-actions lv2-arrive lv2-arrive-4">
          <Link href="/login" className="lv2-btn lv2-btn-light">
            들어가기 <span aria-hidden="true">→</span>
          </Link>
          <a href="#start" className="lv2-btn lv2-btn-glass">
            어떻게 일하는지 보기 <span aria-hidden="true">↓</span>
          </a>
        </div>
        <p className="lv2-hero-note lv2-arrive lv2-arrive-4">구성원은 들어가기 · 처음 오셨다면 아래로</p>
      </div>
    </section>
  )
}

/*
 * 시연 두 장면의 글은 온보딩 안내(components/onboarding/tour-stops.ts 「create-task」 · 「write-doc」)와 같은 사실을 말한다 —
 * 확인 카드를 눌러야 만들어진다는 것까지. 대본 자체는 tour-demo.tsx 의 것을 그대로 돌린다.
 */
function StartWork() {
  return (
    <section id="start" className="lv2-scene" aria-labelledby="lv2-start-title">
      <div className="lv2-wrap lv2-story">
        <div className="lv2-rise">
          <span className="lv2-eyebrow">01 · 업무의 시작</span>
          <h2 id="lv2-start-title" className="lv2-title">
            우리는 한 줄로
            <br />
            <em>업무를 시작합니다.</em>
          </h2>
          <p className="lv2-copy">
            옴니스에게 말하면 담당자를 찾아 업무 카드를 제안합니다. 사람이 확인을 눌러야 만들어집니다.
          </p>
          <ul className="lv2-points">
            <li>담당 · 마감 · 체크리스트가 붙은 업무 카드</li>
            <li>만들어지면 담당자에게 수락 알림</li>
            <li>지시 원문과 카드가 전사방에 함께 남습니다</li>
          </ul>
        </div>
        <div className="lv2-rise">
          <DemoStage
            script="create-task"
            title="옴니스와 업무 시작 — 예시 대화"
            summary="예시: 「다음 주 금요일까지 가벽 블라인드 설치 견적 받아줘. 담당은 사원2」 라고 보내면 옴니스가 구성원을 확인하고 담당 · 마감 · 체크리스트가 담긴 새 업무 카드를 제안합니다. 확인을 누르면 업무가 만들어지고 담당자에게 수락 알림이 갑니다."
          />
        </div>
      </div>
    </section>
  )
}

function ProgressWork() {
  return (
    <section id="progress" className="lv2-scene" aria-labelledby="lv2-progress-title">
      <div className="lv2-wrap lv2-story lv2-story-flip">
        <div className="lv2-rise">
          <span className="lv2-eyebrow">02 · 업무의 진행</span>
          <h2 id="lv2-progress-title" className="lv2-title">
            진행한 만큼
            <br />
            <em>지식이 됩니다.</em>
          </h2>
          <p className="lv2-copy">
            <code className="font-[inherit] font-semibold text-primary">#업무 이름</code>으로 부르면 옴니스가 그 업무의 진행과
            사내 자료를 읽고 지식 카드 초안을 씁니다. 이것도 확인을 눌러야 저장됩니다.
          </p>
          <ul className="lv2-points">
            <li>업무의 글 · 체크리스트 · 사내 자료를 함께 읽습니다</li>
            <li>지식 카드는 구성원 모두가 읽습니다</li>
            <li>옴니스는 다음 질문에 그 카드를 찾아 답합니다</li>
          </ul>
        </div>
        <div className="lv2-rise">
          <DemoStage
            script="write-doc"
            title="옴니스로 업무 진행 — 예시 대화"
            summary="예시: 「#가벽 블라인드 설치 견적 지금까지 진행 상황 지식 카드로 정리해줘」 라고 보내면 옴니스가 업무와 사내 자료를 찾아 읽고 개요 · 진행 상황 · 다음 할 일로 정리한 지식 카드 초안을 씁니다. 확인을 누르면 지식 카드가 저장됩니다."
          />
        </div>
      </div>
    </section>
  )
}

function Resources() {
  return (
    <section id="resources" className="lv2-scene lv2-scene-tint" aria-labelledby="lv2-resources-title">
      <div className="lv2-wrap">
        <div className="lv2-head-center lv2-rise">
          <span className="lv2-eyebrow">03 · 회사가 가진 것</span>
          <h2 id="lv2-resources-title" className="lv2-title">
            우리 회사의 자원,
            <br />
            <em>탭 넷에 모입니다.</em>
          </h2>
          <p className="lv2-copy">채팅 · 업무 · 캘린더 · 아카이브. 회사의 일과 기록이 필요한 순간 한곳에 있습니다.</p>
        </div>
        <div className="lv2-rise">
          <CompanyTabs />
        </div>
      </div>
    </section>
  )
}

/** 온보딩 영상 6장 「AI 연결」 의 도구 소개 — 사람이 하던 일과 그 일을 맡는 MCP 도구 이름(lib/omnis-mcp.ts 의 실제 이름) */
const MCP_TOOLS = [
  [Task01Icon, "업무 확인 · 수정", "list_tasks · update_task"],
  [BubbleChatIcon, "채팅에 보고", "post_message"],
  [FileAttachmentIcon, "첨부 올리기 · 읽기", "upload_file · read_file"],
  [AiMagicIcon, "알림에 응답", "respond_notification"],
  [BookOpen01Icon, "사내 지식 묻기", "ask_omnis"],
  [UserGroupIcon, "고객 · 회사 정보", "find_org"],
] as const

/** 연결 안내(components/onboarding/mcp-clients.tsx)에 탭이 있는 AI 도구 */
const MCP_CLIENTS = ["Claude Code", "claude.ai", "ChatGPT", "Codex", "Gemini CLI", "Cursor", "VS Code"]

function MyAi() {
  return (
    <section id="my-ai" className="lv2-scene" aria-labelledby="lv2-ai-title">
      <div className="lv2-wrap">
        <div className="lv2-head-center lv2-rise">
          <span className="lv2-eyebrow">04 · 나의 AI</span>
          <h2 id="lv2-ai-title" className="lv2-title">
            쓰는 AI 에
            <br />
            <em>회사의 지식을 연결합니다.</em>
          </h2>
          <p className="lv2-copy">
            Omnis MCP 를 붙이면 구성원이 쓰는 AI 가 업무를 확인하고, 사내 지식을 묻고, 보고까지 대신합니다. 연결은 Omnis
            계정으로 승인해야 열립니다.
          </p>
        </div>
        <div className="lv2-mcp lv2-rise">
          <div className="lv2-mcp-card">
            <span className="lv2-mcp-label">나의 AI</span>
            <ul className="lv2-mcp-clients">
              {MCP_CLIENTS.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
          <div className="lv2-mcp-link" aria-hidden="true">
            <i />
            <span>hadd-omnis</span>
          </div>
          <div className="lv2-mcp-card">
            <span className="lv2-mcp-label">AI 가 대신하는 일</span>
            <ul className="lv2-mcp-tools">
              {MCP_TOOLS.map(([icon, title, tool]) => (
                <li key={title}>
                  <HugeiconsIcon icon={icon} size={18} aria-hidden="true" />
                  <span>{title}</span>
                  <code>{tool}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * 「쌓이는 것」 — DB 가 센 개수만(lib/landing-stats.ts, 한 시간 캐시). 예전 랜딩의 80% · 10× 같은 값은 잰 적이 없어 넣지 않는다.
 * 사람 수는 세지 않는다 — 운영 데이터의 타인 명의 글 대부분이 수기 사본이라 「N명이 씁니다」 는 사실과 다르게 읽힌다.
 * 지식 카드 수도 뺐다 — 운영에 아직 1장이라(2026-10-29) 자랑하는 자리에서 거꾸로 읽힌다. 쌓이면 다시 넣는다.
 */
function Stats({ stats }: { stats: LandingStats }) {
  const items = [
    ["업무", stats.tasks],
    ["지식재산권", stats.ipCases],
    ["옴니스가 답한 질문", stats.answeredQuestions],
  ] as const
  return (
    <section id="numbers" className="lv2-scene lv2-scene-tint" aria-labelledby="lv2-stats-title">
      <div className="lv2-wrap">
        <div className="lv2-head-center lv2-rise">
          <span className="lv2-eyebrow">05 · 쌓이는 것</span>
          <h2 id="lv2-stats-title" className="lv2-title">
            일한 만큼 <em>쌓입니다.</em>
          </h2>
        </div>
        <dl className="lv2-stats lv2-rise">
          {items.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value.toLocaleString("ko-KR")}</dd>
            </div>
          ))}
        </dl>
        <p className="lv2-stats-note">Omnis 데이터베이스에서 센 개수입니다. 한 시간마다 다시 셉니다.</p>
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section className="lv2-dark lv2-closing" aria-labelledby="lv2-closing-title">
      <Wash />
      <div className="lv2-wrap lv2-hero-inner">
        <Mark className="lv2-rise" />
        <h2 id="lv2-closing-title" className="lv2-display lv2-rise">
          회사의 지식을 <em>하나로,</em>
        </h2>
        <p className="lv2-lede lv2-rise">HADD Science 의 다음 업무가 시작되는 곳. Omnis</p>
        <div className="lv2-audiences lv2-rise">
          <div className="lv2-audience">
            <span>
              <b>구성원이라면</b>
              회사 계정으로 들어갑니다
            </span>
            <Link href="/login" className="lv2-btn lv2-btn-light">
              들어가기 <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="lv2-audience">
            <span>
              <b>회사 밖에서 오셨다면</b>
              함께 일하는 이야기를 나눠요
            </span>
            <a href={CONTACT_MAIL} className="lv2-btn lv2-btn-glass">
              문의하기 <span aria-hidden="true">✉</span>
            </a>
          </div>
        </div>
      </div>
      <footer className="lv2-footer">
        <div className="lv2-wrap">
          <span className="lv2-footer-brand">
            <OmnisMark className="size-5 rounded-[6px]" />
            Omnis · HADD Science 의 업무 시스템
          </span>
          <span>© {new Date().getFullYear()} HADD Science</span>
        </div>
      </footer>
    </section>
  )
}

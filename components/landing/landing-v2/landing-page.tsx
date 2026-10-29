import Link from "next/link"
import { apiUrl } from "@/lib/base-path"
import { OmnisMark } from "@/components/brand/omnis-mark"
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

export function LandingV2() {
  return (
    <div className="lv2">
      <Nav />
      <main>
        <Hero />
        <StartWork />
        <ProgressWork />
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

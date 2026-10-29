import Link from "next/link"
import { apiUrl } from "@/lib/base-path"
import { OmnisMark } from "@/components/brand/omnis-mark"
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

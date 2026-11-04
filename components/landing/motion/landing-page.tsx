"use client"

import Link from "next/link"
import Image from "next/image"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUp01Icon,
  Add01Icon,
  Mic01Icon,
  Menu01Icon,
  ArrowDown01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { OmnisMark } from "@/components/brand/omnis-mark"
import { WorkflowFilm } from "./workflow-film"
import "./landing.css"

/** 도입 문의 — 작업지시자 회사 메일(2026-10-29 결정) */
const CONTACT_MAIL =
  "mailto:jwoochang@haddscience.com?subject=" +
  encodeURIComponent("Omnis 도입 문의")

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const windowOpacity = (p: number, start: number, end: number) =>
  clamp((p - start) / 0.035) * clamp((end - p) / 0.035)

function useSceneClock(active: boolean) {
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!active) {
      const reset = setTimeout(() => setTime(0), 0)
      return () => clearTimeout(reset)
    }
    const start = performance.now()
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    const timer = setInterval(
      () =>
        setTime(reduced ? 10000 : Math.min(10000, performance.now() - start)),
      40
    )
    return () => clearInterval(timer)
  }, [active])
  return time
}

export function LandingPage() {
  const story = useRef<HTMLElement>(null)
  const firstOmnis = useRef<HTMLElement>(null)
  const nextOmnis = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [heroWord, setHeroWord] = useState({ left: 0, top: 0, size: 60 })
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = story.current
        if (el)
          setProgress(
            clamp(
              -el.getBoundingClientRect().top /
                (el.getBoundingClientRect().height - window.innerHeight)
            )
          )
      })
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])
  useEffect(() => {
    const stops = [0, 0.205, 0.375, 0.56, 0.68, 0.745, 0.795, 0.85, 0.955]
    let busyUntil = 0,
      lastWheel = 0,
      wheelTotal = 0
    let wheelConsumed = false
    let touchStart: number | null = null
    const inStory = () => {
      const el = story.current
      if (!el) return false
      const rect = el.getBoundingClientRect()
      return rect.top <= 2 && rect.bottom > window.innerHeight + 2
    }
    const advance = (direction: number) => {
      const el = story.current
      if (!el || performance.now() < busyUntil) return
      const rect = el.getBoundingClientRect()
      const distance = rect.height - window.innerHeight
      const current = clamp(-rect.top / distance)
      const next =
        direction > 0
          ? stops.find((value) => value > current + 0.012)
          : stops.findLast((value) => value < current - 0.012)
      busyUntil = performance.now() + 1100
      const top = window.scrollY + rect.top
      window.scrollTo({
        top:
          next === undefined
            ? direction > 0
              ? top + rect.height
              : top
            : top + next * distance,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      })
    }
    const wheel = (event: WheelEvent) => {
      if (
        !inStory() ||
        event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return
      event.preventDefault()
      const now = performance.now(),
        quiet = now - lastWheel > 220
      lastWheel = now
      if (quiet) {
        wheelTotal = 0
        wheelConsumed = false
      }
      if (now < busyUntil || wheelConsumed) return
      wheelTotal +=
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? window.innerHeight
            : 1)
      if (Math.abs(wheelTotal) >= 25) {
        wheelConsumed = true
        advance(Math.sign(wheelTotal))
        wheelTotal = 0
      }
    }
    const start = (event: TouchEvent) => {
      touchStart = event.touches.length === 1 ? event.touches[0].clientY : null
    }
    const move = (event: TouchEvent) => {
      if (inStory() && touchStart !== null && event.touches.length === 1)
        event.preventDefault()
    }
    const end = (event: TouchEvent) => {
      if (inStory() && touchStart !== null) {
        const delta = touchStart - event.changedTouches[0].clientY
        if (Math.abs(delta) > 40) advance(Math.sign(delta))
      }
      touchStart = null
    }
    const key = (event: KeyboardEvent) => {
      if (
        !inStory() ||
        (event.target as HTMLElement).closest("a,button,input,textarea,select")
      )
        return
      if (
        ["ArrowDown", "PageDown", " ", "ArrowUp", "PageUp"].includes(event.key)
      ) {
        event.preventDefault()
        advance(
          event.key === "ArrowUp" ||
            event.key === "PageUp" ||
            (event.key === " " && event.shiftKey)
            ? -1
            : 1
        )
      }
    }
    window.addEventListener("wheel", wheel, { passive: false })
    window.addEventListener("touchstart", start, { passive: true })
    window.addEventListener("touchmove", move, { passive: false })
    window.addEventListener("touchend", end)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("wheel", wheel)
      window.removeEventListener("touchstart", start)
      window.removeEventListener("touchmove", move)
      window.removeEventListener("touchend", end)
      window.removeEventListener("keydown", key)
    }
  }, [])
  useLayoutEffect(() => {
    const first = firstOmnis.current,
      next = nextOmnis.current,
      container = stage.current
    if (!first || !next || !container) return
    const a = first.getBoundingClientRect(),
      b = next.getBoundingClientRect(),
      parent = container.getBoundingClientRect()
    const t = clamp((progress - 0.245) / 0.09)
    setHeroWord({
      left: a.left + (b.left - a.left) * t - parent.left,
      top: a.top + (b.top - a.top) * t - parent.top,
      size: parseFloat(getComputedStyle(first).fontSize),
    })
  }, [progress])
  const heroTime = useSceneClock(progress >= 0.335 && progress < 0.46)
  const aiTime = useSceneClock(progress >= 0.48 && progress < 0.62)
  const heroText = "는\n회사의 맥락을 이해하며\n일합니다."
  const heroTyped = heroText.slice(
    0,
    Math.max(0, Math.floor((heroTime - 200) / 65))
  )
  const worryPull = clamp((progress - 0.755) / 0.035)
  const worryPositions = [
    [27, 18],
    [78, 33],
    [24, 82],
    [77, 12],
    [23, 61],
    [76, 88],
    [48, 27],
    [78, 68],
    [21, 40],
    [49, 74],
  ]
  const question = "우리 회사 고객사 제안서 작성해줘."
  const questionTyped = question.slice(
    0,
    Math.max(0, Math.floor((aiTime - 800) / 55))
  )
  const travel = clamp(progress / 0.12)
  const scene = (start: number, end: number): CSSProperties => ({
    opacity: windowOpacity(progress, start, end),
    transform: `translateY(${(1 - clamp((progress - start) / 0.06)) * 18}px)`,
    visibility: progress >= start && progress <= end ? "visible" : "hidden",
  })
  return (
    <div className="landing-cinema">
      <header
        className="cinema-header"
        style={{
          opacity: travel,
          pointerEvents: travel > 0.9 ? "auto" : "none",
        }}
      >
        <a href="#" className="cinema-wordmark" aria-label="Omnis 처음으로">
          <OmnisMark className="header-omnis-mark" />
          Omnis
          <span className="header-hadd-brand">
            <span aria-hidden="true">|</span>
            <Image
              src="/hadd-logo-white.png"
              alt="하드사이언스"
              width={100}
              height={28}
            />
          </span>
        </a>
        <a href="#film" className="header-demo">
          업무의 새로운 흐름
        </a>
        <Link href="/login" className="cinema-entry">
          들어가기 ↗
        </Link>
      </header>
      <section
        className="scroll-story"
        ref={story}
        aria-label="Omnis 소개: 스크롤하여 다음 장면 보기"
      >
        <div className="story-stage" ref={stage}>
          <div className="cinema-grain" aria-hidden="true" />
          <div
            className="story-orbit"
            aria-hidden="true"
            style={{ opacity: clamp((progress - 0.15) * 4) }}
          />
          <div
            className={`travel-icon ${progress < 0.005 ? "icon-floating" : ""}`}
            style={{
              opacity: 1 - clamp((travel - 0.92) / 0.08),
              left: `calc(${50 * (1 - travel)}% + ${travel * 28}px)`,
              top: `calc(${50 * (1 - travel)}% + ${travel * 19}px)`,
              transform: `translate(${-50 * (1 - travel)}%, ${-50 * (1 - travel)}%) scale(${1 - travel * 0.7})`,
              transformOrigin: "top left",
            }}
          >
            <OmnisMark className="cinema-mark" />
          </div>
          <div className="story-copy hero-text-scene" style={scene(0.12, 0.29)}>
            <h1>
              HADD Science는
              <br />
              <strong ref={firstOmnis} className="hero-word-placeholder">
                Omnis
              </strong>
              와 함께 일합니다.
            </h1>
          </div>
          <div className="story-copy hero-text-scene" style={scene(0.29, 0.46)}>
            <h2>
              <strong ref={nextOmnis} className="hero-word-placeholder">
                Omnis
              </strong>
              <span className="hero-full-text">
                는<br />
                회사의 맥락을 이해하며
                <br />
                일합니다.
              </span>
              <span className="hero-typed-copy" aria-hidden="true">
                <strong className="hero-word-placeholder">Omnis</strong>
                {heroTyped.split("\n").map((line, i) => (
                  <span key={i}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </span>
            </h2>
          </div>
          <span
            className="shared-omnis-word"
            aria-hidden="true"
            style={{
              left: heroWord.left,
              top: heroWord.top,
              fontSize: heroWord.size,
              opacity: windowOpacity(progress, 0.12, 0.46),
            }}
          >
            Omnis
          </span>
          <div
            className="chaos-scene ai-question-scene"
            style={scene(0.46, 0.62)}
          >
            <div
              className="external-question glass"
              style={{
                transform: `scaleX(${Math.min(1, aiTime / 700)})`,
                opacity: Math.min(1, aiTime / 350),
              }}
            >
              <span className="question-typing" aria-label={question}>
                {questionTyped || "\u00a0"}
              </span>
              <span className="question-send glass" aria-hidden="true">
                <HugeiconsIcon icon={ArrowUp01Icon} size={22} />
              </span>
            </div>
            <div className="ai-question-lines" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="external-ai-grid">
              {["Claude", "ChatGPT", "Gemini", "Grok"].map((name, i) => (
                <div
                  key={name}
                  className={`external-ai-chat provider-${i}`}
                  style={{
                    opacity: clamp((aiTime - 2400 - i * 500) / 550),
                    transform: `translateY(${12 * (1 - clamp((aiTime - 2400 - i * 500) / 550))}px)`,
                  }}
                >
                  <div className="provider-toolbar">
                    <HugeiconsIcon icon={Menu01Icon} size={14} aria-hidden />
                    <b>{name}</b>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={12}
                      aria-hidden
                    />
                    <span className="provider-avatar">H</span>
                  </div>
                  <div className="provider-topic">고객사 제안서 작성</div>
                  <div className="external-user">
                    우리 회사 고객사 제안서 작성해줘.
                  </div>
                  <div className="provider-answer">
                    <span className="provider-symbol" aria-hidden="true">
                      {["✳", "◉", "✦", "𝕏"][i]}
                    </span>
                    <p>
                      {
                        [
                          "회사의 서비스와 고객사 정보를 알려주시겠어요?",
                          "일반적인 제안서 양식을 작성해 드릴게요.",
                          "관련 자료를 첨부해 주세요. 어떤 회사인가요?",
                          "제안 목적과 기존 상담 내용을 알려주세요.",
                        ][i]
                      }
                    </p>
                  </div>
                  <div className="provider-answer-tools" aria-hidden="true">
                    <HugeiconsIcon icon={Copy01Icon} size={12} />
                    <span>좋아요　↻</span>
                  </div>
                  <div className="provider-composer" aria-hidden="true">
                    <span>
                      {
                        [
                          "Claude에게 답장하기…",
                          "무엇이든 물어보세요",
                          "Gemini에게 물어보기",
                          "무엇이든 물어보세요",
                        ][i]
                      }
                    </span>
                    <div>
                      <HugeiconsIcon icon={Add01Icon} size={16} />
                      <small>{["Claude", "도구", "도구", "Auto"][i]}</small>
                      <HugeiconsIcon icon={Mic01Icon} size={14} />
                      <span className="provider-send">
                        <HugeiconsIcon icon={ArrowUp01Icon} size={15} />
                      </span>
                    </div>
                  </div>
                  <small className="provider-fiction">
                    가상 대화 · 회사 맥락 미연결
                  </small>
                </div>
              ))}
            </div>
            <small className="fiction-note">
              회사 맥락이 연결되지 않은 상황을 재현한 가상 대화입니다.
            </small>
          </div>
          <div
            className="chaos-scene scattered-worries"
            style={scene(0.62, 0.835)}
          >
            {[
              "🤔 업무에 AI 도입하고 싶은데…",
              "무슨 AI가 좋지?",
              "😮‍💨 업무를 시켜도 결과가 아쉬워…",
              "우리 회사 상황부터 다시 설명해야 하나?",
              "자료는 도대체 어디까지 줘야 하지?",
              "같은 설명을 또 하고 있네…",
              "우리 팀 업무랑 어떻게 연결하지?",
              "AI 쓰는 법 배우다 하루가 다 가겠어",
              "🔍 답은 맞는데 우리 회사 얘기가 아니야",
              "그래서 지금 뭘 먼저 해야 하지?",
            ].map((text, i) => (
              <p
                key={text}
                className={`worry worry-${i}`}
                style={
                  {
                    opacity:
                      clamp((progress - 0.62 - i * 0.004) / 0.018) *
                      (1 - worryPull),
                    "--worry-x": `${worryPositions[i][0]}%`,
                    "--worry-y": `${worryPositions[i][1]}%`,
                    "--worry-pull": worryPull,
                  } as CSSProperties
                }
              >
                {text}
              </p>
            ))}
          </div>
          <div className="story-copy ax-copy" style={scene(0.72, 0.88)}>
            <h2
              key={
                progress < 0.77 ? "adopt" : progress < 0.82 ? "transform" : "ax"
              }
            >
              {progress < 0.77
                ? "AI 도입"
                : progress < 0.82
                  ? "AI 전환"
                  : "AX 어떻게 하지?"}
            </h2>
          </div>
          <div className="story-copy" style={scene(0.88, 1.04)}>
            <h2>
              <strong>Omnis</strong>와 함께라면
              <br />
              가능합니다.
            </h2>
          </div>
          <span
            className="scroll-cue"
            style={{
              opacity: 1 - clamp(progress / 0.1),
              visibility: progress < 0.1 ? "visible" : "hidden",
            }}
          >
            스크롤하여 시작하기
          </span>
        </div>
      </section>
      <WorkflowFilm />
      <section className="cinema-benefits" id="effects">
        <h2>
          AI를 쓰는 것에서,
          <br />
          <span>함께 일하는 것으로.</span>
        </h2>
        <div className="benefit-grid">
          {[
            [
              "01",
              "지시는 명확하게",
              "모호한 지시는 되묻고, 필요한 정보를 채워 실행할 수 있는 업무로 만듭니다.",
            ],
            [
              "02",
              "우선순위는 맥락 있게",
              "마감과 연결된 업무, 회사의 상황을 함께 살펴 지금 해야 할 일을 알려줍니다.",
            ],
            [
              "03",
              "실행은 끊김 없이",
              "업무를 파악한 그 대화에서 자료를 찾고 도구를 연결해 초안까지 이어갑니다.",
            ],
          ].map(([n, title, text]) => (
            <article key={n}>
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="cinema-vision">
        <OmnisMark className="vision-mark" />
        <h2>
          회사의 맥락을 파악하고
          <br />
          <strong>움직이는 AI.</strong>
        </h2>
        <p>
          대화를 이해하고, 지식을 연결하고, 일을 앞으로.
          <br />
          당신의 회사와 함께 일하는 Omnis.
        </p>
        <div className="cinema-ctas">
          <Link href="/login">들어가기 ↗</Link>
          <a href={CONTACT_MAIL}>문의하기 ↗</a>
        </div>
        <div id="contact" className="cinema-contact">
          <h3>Omnis 도입 문의</h3>
          <p>
            회사의 업무 흐름과 도입하고 싶은 범위를{" "}
            <a href={CONTACT_MAIL}>jwoochang@haddscience.com</a> 으로
            알려주세요.
          </p>
        </div>
      </section>
      <footer className="cinema-footer">
        <span>
          Omnis <small>by HADD Science</small>
        </span>
        <p>© {new Date().getFullYear()} HADD Science</p>
        <a href="#">처음으로 ↑</a>
      </footer>
    </div>
  )
}

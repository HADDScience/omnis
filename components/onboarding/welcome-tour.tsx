"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Task01Icon,
  BubbleChatIcon,
  BookOpen01Icon,
  FileAttachmentIcon,
  AiMagicIcon,
  UserGroupIcon,
  Legal01Icon,
} from "@hugeicons/core-free-icons"
import { apiUrl } from "@/lib/base-path"
import { TaskCard } from "@/components/tasks/task-card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { ShineBorder } from "@/components/magicui/shine-border"
import { TourSurface } from "./tour-surface"
import { useTourClock } from "./use-tour-clock"
import "./onboarding.css"

const chapters = [
  {
    title: (
      <>
        안녕하세요.
        <br />
        <em>Omnis</em> 입니다.
      </>
    ),
    caption: "업무와 대화, 지식이 만나는 곳",
    duration: 4000,
    name: "환영합니다",
  },
  {
    title: (
      <>
        Omnis를 이용하여
        <br />
        <em>업무하는 법</em>에 대해서 알아볼게요.
      </>
    ),
    caption: "한 번의 지시에서, 우리 회사의 지식까지.",
    duration: 5000,
    name: "업무의 시작",
  },
  {
    title: (
      <>
        생각을 전하면,
        <br />
        <em>업무가 만들어집니다.</em>
      </>
    ),
    caption: "Omnis로 업무지시하기 · / 커맨드, 파일 업로드, AI 자동생성",
    duration: 12000,
    name: "업무 지시",
  },
  {
    title: (
      <>
        대화로 확인하고,
        <br />
        <em>완료까지 함께.</em>
      </>
    ),
    caption:
      "업무를 언급하거나 스레드에서 대화하고, 완료 보고로 상태를 관리하세요.",
    duration: 12000,
    name: "확인과 완료",
  },
  {
    title: (
      <>
        추가 지시도,
        <br />
        <em>대화하듯 자연스럽게.</em>
      </>
    ),
    caption: "업무 언급이나 스레드의 새 지시가 업무 내용과 상태에 반영됩니다.",
    duration: 10000,
    name: "추가 지시",
  },
  {
    title: (
      <>
        나의 AI에,
        <br />
        <em>Omnis의 지식을 연결하세요.</em>
      </>
    ),
    caption: "프로필 메뉴에서 Omnis MCP를 등록하여 AI를 활용해 보세요.",
    duration: 9000,
    name: "AI 연결",
  },
  {
    title: (
      <>
        우리 회사의 자원,
        <br />
        <em>필요한 순간 한곳에서.</em>
      </>
    ),
    caption: "CRM, 지식재산권 등 다양한 도구를 활용해 보세요.",
    duration: 7000,
    name: "회사 도구",
  },
  {
    title: (
      <>
        회사의 지식을 <em>하나로,</em>
      </>
    ),
    caption: "당신의 다음 업무가 시작되는 곳. Omnis",
    duration: 0,
    name: "시작하기",
  },
]
const rainbow = [
  "#ff3d81",
  "#ff8a00",
  "#ffd60a",
  "#34d399",
  "#38bdf8",
  "#a855f7",
]

function Mark() {
  return (
    <div className="intro-mark">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={apiUrl("/omnis-logo.png")} alt="" />
      <span className="intro-orbit" />
    </div>
  )
}

function TaskPreview({
  state,
  extra = false,
}: {
  state: string
  extra?: boolean
}) {
  const status =
    state === "완료" ? "DONE" : state === "할 일" ? "TODO" : "IN_PROGRESS"
  return (
    <div className="intro-task-preview">
      <TaskCard
        readOnly
        variant="board"
        className="intro-real-task"
        task={{
          id: "onboarding-demo",
          slug: "DEMO-01",
          name: "신규 고객 제안서 준비",
          status,
          priority: "NORMAL",
          ownerName: "김하드",
          projectName: "고객 제안",
          productName: null,
          productColor: null,
          deadline: null,
        }}
      />
      {state === "완료 확인 대기" && (
        <Badge variant="outline" className="mt-3">
          완료 확인 대기
        </Badge>
      )}
      <p>고객 미팅을 위한 제품 소개와 견적 정리</p>
      <div className="intro-check">
        <Checkbox
          checked={state === "완료" || extra}
          disabled
          aria-label="제품 소개와 견적 정리"
        />{" "}
        제품 소개와 견적 정리
      </div>
      {extra && (
        <div className="intro-check intro-reveal">
          <Checkbox checked={false} disabled aria-label="샘플 일정 추가" /> 샘플
          일정 추가
        </div>
      )}
    </div>
  )
}

function Workflow({ step, elapsed }: { step: number; elapsed: number }) {
  const beat = Math.floor(elapsed / 2800)
  const creating = step === 2
  const completing = step === 3
  const sent = elapsed >= 2400
  const message = creating
    ? "/업무 신규 고객 제안서를 준비해 주세요. 담당자는 김하드, 금요일까지 부탁해요."
    : completing
      ? "#신규 고객 제안서 준비 제안서 작성을 마쳤습니다. 확인 부탁드려요."
      : "#신규 고객 제안서 준비 샘플 일정도 추가해서 다시 진행해 주세요."
  const typed = message.slice(
    0,
    Math.floor(message.length * Math.min(1, elapsed / 2000))
  )
  const state = creating
    ? "할 일"
    : completing
      ? beat >= 3
        ? "완료"
        : beat >= 2
          ? "완료 확인 대기"
          : "진행 중"
      : beat >= 2
        ? "진행 중"
        : "완료"
  return (
    <div
      className="intro-workflow"
      data-focus={
        elapsed < 2400
          ? "composer"
          : elapsed >= 3200 && elapsed < 5000
            ? "message"
            : "overview"
      }
      role="img"
      aria-label={
        creating
          ? "슬래시 업무 명령, 파일 첨부, AI 생성으로 업무 카드가 만들어지는 예시"
          : completing
            ? "완료 보고 후 담당자가 확인하여 완료되는 예시"
            : "추가 지시 후 업무가 진행 중으로 바뀌는 예시"
      }
    >
      <div className="intro-chat-preview">
        <div className="intro-window-bar">
          <span className="intro-window-dots">● ● ●</span>
          <span>
            {creating ? "전체 대화" : "# 신규 고객 제안서 준비 · 스레드"}
          </span>
          <span>예시</span>
        </div>
        <div className="intro-chat-body">
          <span className="intro-chat-label">
            {creating
              ? "업무 지시"
              : completing
                ? "담당자 · 김하드"
                : "추가 지시"}
          </span>
          {sent ? (
            <div className="intro-message-focus">
              <div
                className="intro-bubble intro-message-sent"
                key={`${step}-message`}
              >
                {creating ? (
                  <>
                    <code>/업무</code> 신규 고객 제안서를 준비해 주세요.
                    <br />
                    담당자는 김하드, 금요일까지 부탁해요.
                  </>
                ) : completing ? (
                  <>
                    <code>#신규 고객 제안서 준비</code>
                    <br />
                    제안서 작성을 마쳤습니다. 확인 부탁드려요.
                  </>
                ) : (
                  <>
                    <code>#신규 고객 제안서 준비</code>
                    <br />
                    샘플 일정도 추가해서 다시 진행해 주세요.
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="intro-typing-hint">
              <span />
              <span />
              <span />
              <small>메시지를 입력하고 있어요</small>
            </div>
          )}
          {beat >= 1 && (
            <div className="intro-reveal">
              {creating ? (
                <div className="intro-file">
                  <HugeiconsIcon icon={FileAttachmentIcon} size={20} />
                  <div>
                    고객 미팅 자료.pdf<small>업무에 참고할 파일 업로드</small>
                  </div>
                  <span>✓</span>
                </div>
              ) : (
                <div className="intro-reply">
                  <HugeiconsIcon icon={BubbleChatIcon} size={18} />
                  {completing
                    ? "대화와 보고가 업무에 함께 남아요."
                    : "새로운 지시를 업무에 반영하고 있어요."}
                </div>
              )}
            </div>
          )}
          {beat >= 2 && (
            <div className="intro-ai-note intro-reveal">
              <HugeiconsIcon icon={AiMagicIcon} size={19} />
              {creating
                ? "AI가 담당자·기한·체크리스트를 정리했어요."
                : completing
                  ? beat >= 3
                    ? "담당자가 완료를 확인했어요. ✓"
                    : "완료 보고를 확인했어요. 담당자 확인 대기"
                  : "샘플 일정 추가 · 진행 중으로 변경되었어요."}
            </div>
          )}
        </div>
        <div className="intro-composer" data-sent={sent}>
          <Textarea
            readOnly
            tabIndex={-1}
            aria-label="예시 메시지 입력"
            className="min-h-0 resize-none border-0 text-xs shadow-none"
            value={
              sent
                ? ""
                : typed + (Math.floor(elapsed / 400) % 2 === 0 ? "▍" : "")
            }
            placeholder={
              creating ? "/ 명령 · 파일 첨부" : "# 업무 언급 · 스레드 답장"
            }
          />
          <span
            className={`intro-send ${sent ? "intro-send-confirmed" : ""}`}
            aria-hidden="true"
          >
            {sent && elapsed < 3000 ? "✓" : "↑"}
          </span>
        </div>
      </div>
      <div className="intro-flow-arrow" aria-hidden="true">
        →
      </div>
      <div
        className={`intro-result ${creating && beat < 2 ? "is-waiting" : ""}`}
      >
        <TaskPreview state={state} extra={step === 4 && beat >= 2} />
        <span className="intro-result-caption">
          {creating && beat < 2
            ? "대화가 업무로 이어집니다"
            : "대화와 함께 달라지는 업무 상태"}
        </span>
      </div>
    </div>
  )
}

function Chapter({
  step,
  onAdvance,
  onPrevious,
  onFinish,
}: {
  step: number
  onAdvance: () => void
  onPrevious: () => void
  onFinish: () => void
}) {
  const chapter = chapters[step]
  const clock = useTourClock(chapter.duration, onAdvance)
  const viewport = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const slot = viewport.current!
    const scene = content.current!
    const fitted = frame.current!
    const fit = () => {
      const scale = Math.min(
        1,
        slot.clientHeight / Math.max(1, scene.offsetHeight)
      )
      fitted.style.setProperty("--intro-fit-scale", String(scale))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(slot)
    observer.observe(scene)
    fit()
    return () => observer.disconnect()
  }, [])
  return (
    <div
      className="intro-stage"
      data-step={step + 1}
      data-paused={clock.stopped}
    >
      <div className="intro-wash" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <header className="intro-header">
        <span className="intro-wordmark">
          Omnis<span>FIRST STEPS</span>
        </span>
        <button onClick={onFinish}>건너뛰기</button>
      </header>
      <div ref={viewport} className="intro-viewport">
        <div ref={frame} className="intro-fit">
          <section
            ref={content}
            className={`intro-chapter ${step >= 2 && step <= 6 ? "has-demo" : ""}`}
            key={step}
          >
            {(step === 0 || step === 7) && <Mark />}
            <div className="intro-copy">
              <span className="intro-eyebrow">
                {String(step + 1).padStart(2, "0")} / OMNIS
              </span>
              <h1>{chapter.title}</h1>
              <p>{chapter.caption}</p>
            </div>
            {step === 1 && (
              <div className="intro-concepts">
                {[
                  [Task01Icon, "업무"],
                  [BubbleChatIcon, "대화"],
                  [BookOpen01Icon, "지식"],
                ].map(([icon, title], i) => (
                  <div
                    key={String(title)}
                    style={{ animationDelay: `${i * 160}ms` }}
                  >
                    <HugeiconsIcon icon={icon as typeof Task01Icon} size={30} />
                    <span>{String(title)}</span>
                  </div>
                ))}
              </div>
            )}
            {step >= 2 && step <= 4 && (
              <Workflow step={step} elapsed={clock.elapsed} />
            )}
            {step === 5 && (
              <div className="intro-mcp-map">
                <div className="intro-profile-preview">
                  <span className="intro-chat-label">내 프로필</span>
                  <div className="intro-profile-person">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback>김</AvatarFallback>
                    </Avatar>
                    <strong>김하드</strong>
                    <span>MEMBER</span>
                  </div>
                  <div className="intro-mcp-highlight">
                    <ShineBorder shineColor={rainbow} borderWidth={1.5} />
                    <HugeiconsIcon icon={AiMagicIcon} size={21} />
                    Omnis MCP 등록 <span>↗</span>
                  </div>
                  <div className="intro-profile-muted">온보딩 튜토리얼</div>
                </div>
                <div className="intro-link-line" aria-hidden="true">
                  <i />
                  <span>OAuth 연결</span>
                </div>
                <div className="intro-ai-orb">
                  <HugeiconsIcon icon={AiMagicIcon} size={36} />
                  <strong>나의 AI</strong>
                  <span>업무 · 지식 · 회사 자원</span>
                </div>
              </div>
            )}
            {step === 6 && (
              <div className="intro-tools">
                {[
                  [UserGroupIcon, "CRM", "고객과 견적을 함께"],
                  [Legal01Icon, "지식재산권", "회사의 아이디어와 권리"],
                  [BookOpen01Icon, "HADD DB", "쌓이는 우리 회사의 지식"],
                ].map(([icon, title, description], i) => (
                  <div
                    key={String(title)}
                    style={{ animationDelay: `${i * 200}ms` }}
                  >
                    <HugeiconsIcon icon={icon as typeof Task01Icon} size={32} />
                    <strong>{String(title)}</strong>
                    <p>{String(description)}</p>
                    <div className="intro-mini-lines" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <div className="intro-story-navigation">
          <button
            className="intro-story-previous"
            aria-label="이전 장면"
            disabled={step === 0}
            onClick={onPrevious}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            className="intro-story-next"
            aria-label="다음 장면"
            disabled={step === 7}
            onClick={onAdvance}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
      <footer className="intro-footer">
        <p className="intro-story-hint">왼쪽 탭은 이전 · 오른쪽 탭은 다음</p>
        {step === 7 && (
          <button className="intro-start" onClick={onFinish}>
            업무 시작하기 <span aria-hidden="true">→</span>
          </button>
        )}
        <div className="intro-progress" aria-label={`${step + 1} / 8 단계`}>
          {chapters.map((item, i) => (
            <span key={item.name}>
              <i
                style={{
                  transform: `scaleX(${i < step ? 1 : i === step ? (chapter.duration ? clock.elapsed / chapter.duration : 1) : 0})`,
                }}
              />
            </span>
          ))}
        </div>
        <div className="intro-playback">
          <span>
            {chapter.name} <small>{step + 1} / 8</small>
          </span>
          {chapter.duration > 0 ? (
            <button
              onClick={clock.toggle}
              aria-label={clock.paused ? "재생" : "일시정지"}
            >
              {clock.paused ? "▷ 재생" : "Ⅱ 일시정지"}
            </button>
          ) : (
            <span>준비되셨나요?</span>
          )}
        </div>
      </footer>
      <span className="sr-only" role="status">
        {chapter.name}, {step + 1} / 8 단계
      </span>
    </div>
  )
}

export default function WelcomeTour({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0)
  return (
    <TourSurface
      label="Omnis 온보딩 튜토리얼"
      onEscape={onFinish}
      className="intro-surface"
    >
      <Chapter
        key={step}
        step={step}
        onAdvance={() => setStep(Math.min(step + 1, 7))}
        onPrevious={() => setStep(Math.max(step - 1, 0))}
        onFinish={onFinish}
      />
    </TourSurface>
  )
}

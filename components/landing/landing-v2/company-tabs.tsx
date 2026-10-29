"use client"

import { useId, useRef, useState, type KeyboardEvent } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Archive02Icon,
  BookOpen01Icon,
  BubbleChatIcon,
  Calendar03Icon,
  Database01Icon,
  Legal01Icon,
  Task01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { TaskCard } from "@/components/tasks/task-card"

/**
 * 「회사가 가진 것」 — 앱의 탭 넷(채팅 · 업무 · 캘린더 · 아카이브, components/layout/floating-nav.tsx)을 그대로 탭으로 그린다.
 * 문구는 온보딩 안내(components/onboarding/tour-stops.ts)와 같은 사실만 말한다. 화면 속 업무 · 일정 · 이름은 예시라
 * 「예시」 표를 붙인다 — 랜딩은 회사 밖에서도 보므로 실제 업무 · 사람 이름을 꺼내지 않는다.
 * 업무 탭은 실제 업무 카드 컴포넌트(TaskCard readOnly)를 쓴다. 마감은 비운다 — D-n 은 오늘 기준이라 서버 · 브라우저가 어긋날 수 있다.
 */
const TABS = [
  {
    key: "chat",
    label: "채팅",
    icon: BubbleChatIcon,
    title: "대화는 채팅에",
    copy: "옴니스 방 · 전사방 · 사람끼리의 대화가 한 목록에 있습니다. 업무를 #이름으로 부르면 대화가 그 업무에 남습니다.",
  },
  {
    key: "tasks",
    label: "업무",
    icon: Task01Icon,
    title: "업무는 업무 탭에",
    copy: "멈춘 업무 · 사람별 업무를 골라 보고, 목록 · 보드 · 관계도로 바꿔 봅니다. 업무를 누르면 그 업무의 스레드가 열립니다.",
  },
  {
    key: "calendar",
    label: "캘린더",
    icon: Calendar03Icon,
    title: "일정은 캘린더에",
    copy: "업무 마감과 회사 일정이 한 달력에 모입니다. 네이버 웍스 캘린더의 일정도 함께 보입니다.",
  },
  {
    key: "archive",
    label: "아카이브",
    icon: Archive02Icon,
    title: "회사의 자료는 아카이브에",
    copy: "지식 카드 · 시놀로지 · 지식재산권 · 고객 · 견적이 아카이브 탭 한 곳에 모여 있습니다.",
  },
] as const

type TabKey = (typeof TABS)[number]["key"]

export function CompanyTabs() {
  const [active, setActive] = useState<TabKey>("tasks")
  const base = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // WAI-ARIA 탭 — 좌우 화살표 · Home · End 로 옮기고, 옮기면 바로 그 탭을 연다
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = TABS.length - 1
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null
    if (next === null) return
    event.preventDefault()
    setActive(TABS[next].key)
    buttons.current[next]?.focus()
  }

  return (
    <div className="lv2-tabs">
      <div className="lv2-tablist" role="tablist" aria-label="Omnis 의 탭 넷">
        {TABS.map((tab, i) => {
          const selected = tab.key === active
          return (
            <button
              key={tab.key}
              ref={(el) => {
                buttons.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => onKeyDown(event, i)}
            >
              <HugeiconsIcon icon={tab.icon} size={20} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${base}-panel-${tab.key}`}
          aria-labelledby={`${base}-tab-${tab.key}`}
          hidden={tab.key !== active}
          className="lv2-panel"
        >
          <div className="lv2-panel-copy">
            <h3>{tab.title}</h3>
            <p>{tab.copy}</p>
          </div>
          <div className="lv2-panel-screen">
            <span className="lv2-demo-tag lv2-panel-tag">예시</span>
            {tab.key === "chat" && <ChatScreen />}
            {tab.key === "tasks" && <TasksScreen />}
            {tab.key === "calendar" && <CalendarScreen />}
            {tab.key === "archive" && <ArchiveScreen />}
          </div>
        </div>
      ))}
    </div>
  )
}

function ChatScreen() {
  const rooms = [
    ["옴니스", "가벽 블라인드 설치 견적 업무를 만들었어요.", true],
    ["전사방", "#가벽 블라인드 설치 견적 견적 2곳 받았습니다.", false],
    ["사원1 · 사원2", "내일 실측 같이 가요.", false],
  ] as const
  return (
    <ul className="lv2-rooms">
      {rooms.map(([name, last, omnis]) => (
        <li key={name}>
          <span className={omnis ? "lv2-room-avatar is-omnis" : "lv2-room-avatar"} aria-hidden="true">
            {omnis ? "O" : name.slice(0, 1)}
          </span>
          <span className="lv2-room-text">
            <strong>{name}</strong>
            <small>{last}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}

function TasksScreen() {
  // 업무 탭의 보드 보기처럼 상태별 칸에 놓는다
  const columns = [
    ["할 일", [["DEMO-02", "신규 고객 제안서 준비", "TODO", "사원1", "고객 제안"]]],
    ["진행 중", [["DEMO-01", "가벽 블라인드 설치 견적", "IN_PROGRESS", "사원2", "사무실"], ["DEMO-04", "전시회 부스 자료 정리", "IN_PROGRESS", "사원1", "전시회"]]],
    ["완료", [["DEMO-03", "샘플 발송 일정 정리", "DONE", "사원3", "고객 제안"]]],
  ] as const
  return (
    <div className="lv2-board">
      {columns.map(([label, tasks]) => (
        <div key={label} className="lv2-board-col">
          <span>
            {label} <small>{tasks.length}</small>
          </span>
          {tasks.map(([slug, name, status, owner, project]) => (
            <TaskCard
              key={slug}
              readOnly
              variant="board"
              task={{
                id: slug,
                slug,
                name,
                status,
                priority: "NORMAL",
                ownerName: owner,
                projectName: project,
                productName: null,
                productColor: null,
                deadline: null,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function CalendarScreen() {
  const days = ["월", "화", "수", "목", "금"]
  // [요일 칸, 제목, 출처] — 업무 마감과 웍스 일정이 같은 달력에 놓이는 모습
  const events = [
    [0, "주간 회의", "works"],
    [1, "고객 미팅", "works"],
    [2, "실측", "works"],
    [4, "견적 마감", "task"],
    [4, "제안서 마감", "task"],
  ] as const
  return (
    <div className="lv2-week">
      {days.map((day, i) => (
        <div key={day} className="lv2-day">
          <span>{day}</span>
          {events
            .filter(([d]) => d === i)
            .map(([, title, from]) => (
              <em key={title} data-from={from}>
                {title}
              </em>
            ))}
        </div>
      ))}
      <p className="lv2-week-legend">
        <i data-from="task" /> 업무 마감 <i data-from="works" /> 웍스 일정
      </p>
    </div>
  )
}

function ArchiveScreen() {
  const items = [
    [BookOpen01Icon, "지식 카드", "업무에서 나온 회사의 지식"],
    [Database01Icon, "시놀로지", "회사 NAS 의 파일"],
    [Legal01Icon, "지식재산권", "상표 · 특허의 진행"],
    [UserGroupIcon, "고객 · 견적", "거래처 · 견적 · 샘플"],
  ] as const
  return (
    <div className="lv2-archive">
      {items.map(([icon, title, description]) => (
        <div key={title}>
          <HugeiconsIcon icon={icon} size={24} aria-hidden="true" />
          <strong>{title}</strong>
          <small>{description}</small>
        </div>
      ))}
    </div>
  )
}

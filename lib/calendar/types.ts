/**
 * 캘린더 화면과 API 가 같이 쓰는 모양. 서버 코드(prisma)를 끌어오지 않는다 — 클라이언트도 import 한다.
 */

/** 화면에서 켜고 끄는 단위. 웍스는 캘린더마다 따로 켜고 끈다 */
export type CalendarGroup = "tasks" | "projects" | "records" | "crm" | "finance" | "reports" | "works"

export const CALENDAR_GROUPS: { key: CalendarGroup; label: string; defaultOn: boolean }[] = [
  { key: "works", label: "웍스 일정", defaultOn: true },
  { key: "tasks", label: "업무 마감", defaultOn: true },
  { key: "projects", label: "프로젝트", defaultOn: true },
  { key: "records", label: "회사 기록", defaultOn: true },
  { key: "crm", label: "견적 · 샘플 · 출고", defaultOn: false },
  { key: "finance", label: "세금계산서 · 입금", defaultOn: false },
  { key: "reports", label: "내 주간보고", defaultOn: false },
]

export type CalendarItem = {
  /** 회차마다 고유하다. 반복 일정은 `works:{행 id}:{원래 시각}` */
  id: string
  group: CalendarGroup
  /** 짧은 꼬리표 — 마감 · 견적 · 출고 … 웍스는 캘린더 이름 */
  tag: string
  title: string
  /** ISO. 종일이면 서울 자정 */
  start: string
  /** ISO, 끝은 포함하지 않는다. 종일이면 마지막 날 다음 서울 자정 */
  end: string
  allDay: boolean
  /** 옴니스 안의 원본. 웍스 일정은 null */
  href: string | null
  /** 웍스 캘린더 id — 화면에서 캘린더별로 켜고 끈다 */
  calendarId?: string
  /** 완료 · 취소처럼 흐리게 그릴 것 */
  muted?: boolean
  recurring?: boolean
  location?: string | null
  description?: string | null
}

export type CalendarSource = {
  id: string
  displayName: string
  audience: "ALL" | "ADMIN"
  syncedAt: string | null
  /** 관리자에게만 실린다 */
  lastError?: string | null
}

export type CalendarResponse = {
  items: CalendarItem[]
  calendars: CalendarSource[]
  /** 웍스 연동이 설정돼 있는가 — 없으면 화면이 안내만 한다 */
  worksConfigured: boolean
}

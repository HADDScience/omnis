/**
 * 스포트라이트 안내의 장면 — 순서와 문구는 작업지시자가 정했다(mydocs/plans/2026-10-29-onboarding-tab-tour.md).
 *
 * 장면에 들어가면 `route` 로 옮겨 가고, 화면이 그려지면 `target`(data-onboarding 표식)을 잰다.
 * 탭 장면은 nav 의 탭과 그 화면 본문을 함께 비춘다 — 탭만 비추면 그 탭에 무엇이 있는지 안 보인다.
 */
export interface TourStop {
  id: string
  /** 이 장면에 들어갈 때 옮겨 갈 화면 */
  route?: string
  /** 비출 data-onboarding 표식. 없으면 화면 가운데 설명창만 */
  target?: string
  /** 탭 장면 — nav 탭과 함께 화면 본문([data-main-scroll])도 비춘다 */
  body?: boolean
  title: string
  copy: string
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: "tasks",
    route: "/tasks",
    target: "tasks",
    body: true,
    title: "업무는 업무 탭에",
    copy: "위 현황 띠에서 멈춘 업무 · 사람별 업무를 골라 보고, 목록 · 보드 · 관계도로 바꿔 볼 수 있어요. 업무를 누르면 그 업무의 스레드가 열려요.",
  },
  {
    id: "calendar",
    route: "/calendar",
    target: "calendar",
    body: true,
    title: "일정은 캘린더에",
    copy: "업무 마감과 회사 일정이 한 달력에 모여요. 웍스 캘린더 일정도 함께 보여요.",
  },
  {
    id: "archive",
    route: "/omnis",
    target: "resources",
    body: true,
    title: "회사의 자료는 아카이브에",
    copy: "지식 카드 · 시놀로지 · 지식재산권 · 고객·견적이 아카이브 탭 한 곳에 모여 있어요. 안내는 마이에서 다시 볼 수 있어요.",
  },
]

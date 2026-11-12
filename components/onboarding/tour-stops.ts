/**
 * 스포트라이트 안내의 장면 — 순서와 문구는 작업지시자가 정했다(mydocs/plans/2026-10-29-onboarding-tab-tour.md).
 *
 * 장면에 들어가면 `route` 로 옮겨 가고, 화면이 그려지면 `target`(data-onboarding 표식)을 잰다.
 * 탭 장면은 nav 의 탭과 그 화면 본문을 함께 비춘다 — 탭만 비추면 그 탭에 무엇이 있는지 안 보인다.
 */
import type { DemoScript } from "./tour-demo"

export interface TourStop {
  id: string
  /** 이 장면에 들어갈 때 옮겨 갈 화면 */
  route?: string
  /** 비출 data-onboarding 표식. 없으면 화면 가운데 설명창만 */
  target?: string
  /** 탭 장면 — nav 탭과 함께 화면 본문([data-main-scroll])도 비춘다 */
  body?: boolean
  /** 간편 로그인 장면 — 소셜 연결 버튼. 저절로 넘어가지 않는다(고르는 장면이다) */
  social?: true
  /** 옴니스 방(/chat/new) 대화 칸 자리에서 재생할 대본(components/onboarding/tour-demo.tsx) */
  demo?: DemoScript
  /** 설문이 열린 계정(lib/ai-survey/access.ts)에만 보이는 장면 */
  surveyOnly?: true
  title: string
  copy: string
  /** 폰(md 미만)에서 바꿔 보일 문구 — PC 에만 있는 화면을 말하는 장면 */
  phoneCopy?: string
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: "social",
    social: true,
    title: "간편 로그인",
    // 사실 확인(2026-10-29): lib/auth.ts signIn 콜백은 provider · providerAccountId · email 만 남긴다
    // (lib/auth-identity.ts). 사람은 provider + providerAccountId 로 알아보고, 화면의 이름은 언제나 옴니스 계정 이름이다(jwt 콜백).
    // 메일은 마이의 연결 목록에 「어느 계정을 연결했는지」 보여 주는 데만 쓴다
    copy: "구글 · 카카오 계정을 연결해 두면 다음부터 이름 · 비밀번호 없이 한 번에 들어와요. 소셜 계정은 누구인지 알아보는 데만 쓰고, 이름 · 사진 같은 계정 정보는 가져다 쓰지 않아요. 메일 주소는 어느 계정을 연결했는지 보여 드리는 데만 남겨요.",
  },
  {
    id: "create-task",
    route: "/chat/new",
    target: "omnis-room",
    demo: "create-task",
    title: "옴니스와 함께 업무를 시작해보세요",
    copy: "채팅에 한 줄로 지시하면 옴니스가 담당자를 찾아 업무 카드를 제안해요. 확인을 눌러야 만들어져요. 지금 보이는 대화는 예시라 실제로 보내지 않아요.",
  },
  {
    id: "write-doc",
    route: "/chat/new",
    target: "omnis-room",
    demo: "write-doc",
    title: "옴니스로 업무를 진행해요",
    copy: "#업무 이름으로 부르면 옴니스가 그 업무의 진행과 사내 자료를 읽고 지식 카드 초안을 써 줘요. 이것도 확인을 눌러야 저장돼요. 예시 대화예요.",
  },
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
    copy: "지식 카드 · 시놀로지 · 지식재산권 · 고객·견적이 아카이브 탭 한 곳에 모여 있어요.",
  },
  // 2판(2026-11-12, lib/onboarding-version.ts) — 최근 바뀐 화면을 못 본 사람이 있어 짧게 더했다
  {
    id: "chat-updates",
    title: "대화에서 새로 생긴 것",
    copy: "업무 · 캘린더 같은 화면에서는 오른쪽 아래 둥근 단추로 대화 패널을 열어 보던 화면 옆에서 채팅을 이어 가요. 방 머리의 ≡ 서랍에는 그 방의 사진 · 파일 · 링크가 모여 있고, 여러 개를 골라 한 번에 받을 수 있어요. 답장 위의 인용을 누르면 원래 메시지로 이동해요.",
    phoneCopy: "방 머리의 ≡ 서랍에는 그 방의 사진 · 파일 · 링크가 모여 있고, 여러 개를 골라 한 번에 받을 수 있어요. 글을 오른쪽으로 밀면 답장, 답장 위의 인용을 누르면 원래 메시지로 이동해요.",
  },
  {
    id: "survey",
    surveyOnly: true,
    title: "AI 활용 설문에 참여해 주세요",
    copy: "AI 를 어떻게 쓰고 계신지 2~3분이면 알려 주실 수 있어요. 맨 위 안내 띠나 마이의 「설문 참여하기」 에서 열 수 있어요. 안내는 마이에서 다시 볼 수 있어요.",
  },
]

/** 이 사람에게 보일 장면 — 설문 장면은 설문이 열린 계정에만. 이어 보기(saveTourResume)의 번호는 이 목록 기준이다 */
export function tourStopsFor({ survey }: { survey: boolean }): readonly TourStop[] {
  return survey ? TOUR_STOPS : TOUR_STOPS.filter((s) => !s.surveyOnly)
}

/**
 * 소셜 연결은 구글 · 카카오 화면으로 나갔다 온다. 나가기 전에 다음 장면을 적어 두고, 돌아오면 그 장면부터 잇는다.
 * 같은 탭에서만 이어지면 되니 sessionStorage — 오래된 기록(연결을 포기하고 한참 뒤)은 버린다
 */
const RESUME_KEY = "omnis-tour-resume"
const RESUME_TTL_MS = 30 * 60 * 1000

export interface TourResume {
  stop: number
  /** 안내를 시작한 화면 — 끝나면 이리로 돌려보낸다 */
  from: string
}

export function saveTourResume(resume: TourResume) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...resume, at: Date.now() }))
  } catch {
    // 저장소가 막혀 있으면(사파리 사생활 보호 등) 처음부터 다시 볼 뿐이다
  }
}

/**
 * 이어 갈 장면. 읽기만 한다 — 지우는 것은 clearTourResume(그린 뒤 effect 에서). 개발 모드의 StrictMode 는
 * useState 초기값 함수를 두 번 부르는데, 읽으며 지우면 두 번째 부름이 빈손이 된다
 */
export function peekTourResume(): TourResume | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<TourResume> & { at?: number }
    if (typeof value.stop !== "number" || typeof value.from !== "string") return null
    if (!value.at || Date.now() - value.at > RESUME_TTL_MS) return null
    // 설문 장면을 뺀 목록이면 마지막 번호가 하나 작다 — 넘치면 화면 쪽(SpotlightTour)이 마지막 장면으로 줄인다
    if (value.stop < 0 || value.stop >= TOUR_STOPS.length) return null
    return { stop: value.stop, from: value.from }
  } catch {
    return null
  }
}

/** 한 번 이어 갔으면 지운다 — 다음 접속 · 「다시 보기」 는 처음부터 */
export function clearTourResume() {
  try {
    sessionStorage.removeItem(RESUME_KEY)
  } catch {
    // 저장소가 막혀 있으면 애초에 적히지도 않았다
  }
}

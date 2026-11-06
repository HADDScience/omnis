import { largeUploadClientEnabled } from "@/lib/large-upload/rules"

/** 수집 안내 문구 — 처음 한 번 뜨는 알림과 마이 > 시스템이 같은 말을 한다 */
export const UI_METRICS_NOTICE = {
  title: "사용 기록 안내",
  summary: "화면이 바뀐 뒤 쓰기 어려워졌는지 보려고 사용 기록을 모읍니다. 대화 내용 · 파일 이름 · 방 이름은 모으지 않고, 개인 평가에 쓰지 않습니다.",
  collected: `사용자 ID, 동작 이름(메뉴 열기 · 단축키 · 첨부 실패 등), 숫자(방을 연 뒤 첫 전송까지 걸린 시간 · 오류 상태 코드${largeUploadClientEnabled ? " · 첨부 크기와 올리는 데 걸린 시간" : ""} · 알림을 받고 누르기까지 걸린 시간 · 검색 횟수), 경로 형태(/chat/:id), 배포 버전`,
  notCollected: "대화 내용, 파일 이름, 방 이름, 업무 이름, 검색어, 알림 내용",
  usage: "관리자만 배포별 · 사람별 · 주별로 보고, 화면을 고치고 카톡 → 옴니스 시범 운영을 판단하는 데만 씁니다. 개인 평가에 쓰지 않습니다.",
  retention: "사용 기록은 90일 뒤 지웁니다.",
} as const

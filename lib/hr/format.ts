// 지원서함 화면의 날짜 표기 — 서울 시각. 카운트다운이 아니라 날짜로 쓴다.
const closes = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
const received = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })

/** 「마감 2026. 11. 27. (금) 17:00」 — 모르면 「마감 미정」 */
export const closesLabel = (iso: string | null) => (iso ? `마감 ${closes.format(new Date(iso))}` : "마감 미정")
export const receivedLabel = (iso: string | null) => (iso ? received.format(new Date(iso)) : "")

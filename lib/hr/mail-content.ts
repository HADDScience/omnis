// 지원서 접수 메일 본문 — 지원자 접수 확인 · 회사 사본. prisma · 메일 발송을 들이지 않는다(단위 시험이 그대로 돈다).
//
// 지원자 메일에는 지원자가 쓴 칸을 요약해 돌려준다(첨부는 파일 이름만). 회사 사본(info@)은 최소한만 —
// 연락처 · 지원 동기 · 파일은 싣지 않는다. 메일함은 옴니스 지원서함보다 넓게 퍼지고 파기도 따라오지 않는다.
// 지원서함 상세 링크로 옴니스에서 보게 한다(채용 담당만 열린다).
import { interestLabel } from "./rules"

export const COMPANY_COPY_TO = "info@haddscience.com"
export const HR_SENDER_NAME = "하드사이언스 정우창"

export interface MailDraft {
  to: string
  subject: string
  text: string
}

export interface ApplicationForMail {
  id: string
  code: string
  jobSlug: string
  jobTitle: string
  lang: string
  receivedAt: Date
  name: string | null
  department: string | null
  studentId: string | null
  grade: string | null
  graduation: string | null
  phone: string | null
  email: string | null
  portfolioUrl: string | null
  interests: string[]
  motivation: string | null
  files: { slot: "RESUME" | "PORTFOLIO"; fileName: string | null }[]
}

/** 공고마다 메일에 적는 이름 · 일정. 없는 공고는 일정 단락을 뺀다(지어내지 않는다) */
interface JobMailNotes {
  short: { ko: string; en: string }
  schedule: { ko: string[]; en: string[] }
}
export const JOB_MAIL_NOTES: Record<string, JobMailNotes> = {
  "suwon-anchor-practicum-intern-2026-winter": {
    short: { ko: "현장실습 인턴", en: "practicum internship" },
    schedule: {
      ko: ["접수 마감: 2026년 11월 27일(금) 오후 5시", "면접: 2026년 12월 1일(화) 오전 11시, 랩스테이션 8층"],
      en: ["Applications close: Friday, November 27, 2026, 5:00 p.m. (KST)", "Interview: Tuesday, December 1, 2026, 11:00 a.m., Lab Station 8th floor"],
    },
  },
}

const KST = "Asia/Seoul"
const fmt = (d: Date, lang: "ko" | "en") =>
  new Intl.DateTimeFormat(lang === "en" ? "en-US" : "ko-KR", {
    timeZone: KST,
    year: "numeric",
    month: lang === "en" ? "short" : "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d) + (lang === "en" ? " (KST)" : "")

const langOf = (a: ApplicationForMail): "ko" | "en" => (a.lang === "en" ? "en" : "ko")
const line = (label: string, value: string | null | undefined) => (value ? `- ${label}: ${value}` : null)

/** 지원자 접수 확인 — 받는 사람은 지원서의 이메일. 국문 지원은 한국어, 영문 지원은 영어 */
export function applicantMail(a: ApplicationForMail): MailDraft {
  if (!a.email) throw new Error("지원서에 이메일이 없다")
  const lang = langOf(a)
  const notes = JOB_MAIL_NOTES[a.jobSlug]
  const fileName = (slot: "RESUME" | "PORTFOLIO") => a.files.find((f) => f.slot === slot)?.fileName ?? null
  const interests = a.interests.length ? a.interests.map((v) => interestLabel(v, lang)).join(", ") : null

  if (lang === "en") {
    const body = [
      `Dear ${a.name ?? "applicant"},`,
      "",
      `Thank you for applying to HADD Science. We have received your application.`,
      "",
      `- Application number: ${a.code}`,
      `- Position: ${a.jobTitle}`,
      `- Received: ${fmt(a.receivedAt, "en")}`,
      "",
      "What you submitted",
      ...[
        line("Name", a.name),
        line("Department", a.department),
        line("Student ID", a.studentId),
        line("Year", a.grade),
        line("Expected graduation", a.graduation),
        line("Phone", a.phone),
        line("Email", a.email),
        line("Areas of interest", interests),
        line("Portfolio link", a.portfolioUrl),
        line("Résumé file", fileName("RESUME")),
        line("Portfolio file", fileName("PORTFOLIO")),
      ].filter((l): l is string => l !== null),
      ...(a.motivation ? ["", "Motivation", a.motivation] : []),
      ...(notes ? ["", "Schedule", ...notes.schedule.en.map((s) => `- ${s}`)] : []),
      "",
      "If you have any questions, simply reply to this email.",
      "",
      "HADD Science",
      "Woochang Jeong",
    ]
    return { to: a.email, subject: `[HADD Science] Your application has been received (${a.code})`, text: body.join("\n") }
  }

  const body = [
    `${a.name ?? "지원자"}님, 하드사이언스에 지원해 주셔서 감사합니다.`,
    "지원서가 접수되었습니다.",
    "",
    `- 접수 번호: ${a.code}`,
    `- 공고: ${a.jobTitle}`,
    `- 접수 시각: ${fmt(a.receivedAt, "ko")}`,
    "",
    "작성하신 내용",
    ...[
      line("이름", a.name),
      line("학과", a.department),
      line("학번", a.studentId),
      line("학년", a.grade ? `${a.grade}학년` : null),
      line("졸업 예정", a.graduation),
      line("연락처", a.phone),
      line("이메일", a.email),
      line("관심 있는 일", interests),
      line("포트폴리오 링크", a.portfolioUrl),
      line("이력서 파일", fileName("RESUME")),
      line("포트폴리오 파일", fileName("PORTFOLIO")),
    ].filter((l): l is string => l !== null),
    ...(a.motivation ? ["", "지원 동기", a.motivation] : []),
    ...(notes ? ["", "일정", ...notes.schedule.ko.map((s) => `- ${s}`)] : []),
    "",
    "궁금한 점은 이 메일에 회신해 주세요.",
    "",
    "하드사이언스 정우창 드림",
  ]
  const what = notes?.short.ko ?? "채용"
  return { to: a.email, subject: `[하드사이언스] ${what} 지원서가 접수되었습니다 (${a.code})`, text: body.join("\n") }
}

/** 회사 사본 — 최소한만. 연락처 · 지원 동기 · 파일은 싣지 않는다 */
export function companyCopyMail(a: ApplicationForMail, omnisOrigin: string): MailDraft {
  const link = `${omnisOrigin.replace(/\/+$/, "")}/hr/applications/${a.id}`
  const body = [
    "홈페이지로 새 지원서가 접수되었습니다.",
    "",
    `- 접수 번호: ${a.code}`,
    `- 이름: ${a.name ?? "-"}`,
    `- 학과: ${a.department ?? "-"}`,
    `- 공고: ${a.jobTitle}`,
    `- 접수 시각: ${fmt(a.receivedAt, "ko")}`,
    "",
    `옴니스 지원서함에서 보기(채용 담당만 열립니다): ${link}`,
    "",
    "연락처 · 지원 동기 · 첨부 파일은 개인정보라 메일에 싣지 않습니다. 옴니스에서 확인해 주세요.",
  ]
  return { to: COMPANY_COPY_TO, subject: `[채용] 새 지원서 ${a.code} — ${a.name ?? "이름 없음"}`, text: body.join("\n") }
}

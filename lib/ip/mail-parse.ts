/**
 * 붙여넣은 메일 본문에서 커뮤니케이션 기록 필드를 뽑아낸다.
 *
 * Gmail 과 네이버웍스 양쪽의 복사 형식을 모두 받는다. OAuth 가 필요 없어서
 * 어떤 메일 서비스를 쓰든 동작하는 것이 이 방식의 장점이다.
 * 완벽한 파싱을 노리지 않고 "폼을 미리 채워 손이 덜 가게" 하는 것이 목적이다.
 */

export interface ParsedMail {
  date: string | null
  from: string | null
  to: string | null
  subject: string | null
  body: string
  attachments: string[]
}

const FROM_KEYS = ["보낸사람", "보낸 사람", "발신자", "From", "FROM"]
const TO_KEYS = ["받는사람", "받는 사람", "수신자", "To", "TO"]
const SUBJECT_KEYS = ["제목", "Subject", "SUBJECT"]
const DATE_KEYS = ["날짜", "보낸날짜", "보낸 날짜", "Date", "DATE"]

/** "이주철 <jcpatent@daum.net>" → "이주철" */
function personName(raw: string): string {
  const trimmed = raw.trim().replace(/^"|"$/g, "")
  const angle = trimmed.indexOf("<")
  if (angle > 0) return trimmed.slice(0, angle).trim().replace(/^"|"$/g, "")
  // 이름 없이 주소만 있으면 로컬파트를 쓴다.
  if (trimmed.includes("@")) return trimmed.split("@")[0]
  return trimmed
}

/** 여러 수신자 중 첫 번째만 쓴다 (기록은 대표 1인이면 충분) */
function firstPerson(raw: string): string {
  const parts = raw.split(/[,;]/)
  return personName(parts[0] ?? raw)
}

/**
 * 한국어/영문 날짜 표기를 YYYY-MM-DD 로.
 * "2026년 7월 24일", "2026. 7. 24.", "2026-07-24", "Jul 24, 2026" 등.
 */
export function parseDate(raw: string): string | null {
  const pad = (n: string | number) => String(n).padStart(2, "0")

  const ko = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(raw)
  if (ko) return `${ko[1]}-${pad(ko[2])}-${pad(ko[3])}`

  const dotted = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/.exec(raw)
  if (dotted) return `${dotted[1]}-${pad(dotted[2])}-${pad(dotted[3])}`

  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  }
  const en = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(raw)
  if (en) {
    const m = months[en[1].toLowerCase()]
    if (m) return `${en[3]}-${pad(m)}-${pad(en[2])}`
  }

  return null
}

/**
 * 파일명처럼 보이는 토큰 (확장자 기준).
 * "ADHEAL 등록가능성.pdf" 처럼 공백이 들어간 이름이 흔해서 내부 공백을 허용한다.
 */
const ATTACHMENT_RE =
  /[가-힣A-Za-z0-9_][가-힣A-Za-z0-9 _.()\-]*\.(pdf|hwpx?|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|txt|csv)\b/gi

export function parseMail(text: string): ParsedMail {
  const lines = text.replace(/\r\n/g, "\n").split("\n")

  const result: ParsedMail = {
    date: null,
    from: null,
    to: null,
    subject: null,
    body: "",
    attachments: [],
  }

  const consumed = new Set<number>()

  lines.forEach((line, i) => {
    const m = /^\s*([^:：]{1,12})\s*[:：]\s*(.+)$/.exec(line)
    if (!m) return
    const key = m[1].trim()
    const rest = m[2].trim()

    if (!result.from && FROM_KEYS.includes(key)) {
      result.from = firstPerson(rest)
      consumed.add(i)
    } else if (!result.to && TO_KEYS.includes(key)) {
      result.to = firstPerson(rest)
      consumed.add(i)
    } else if (!result.subject && SUBJECT_KEYS.includes(key)) {
      result.subject = rest
      consumed.add(i)
    } else if (!result.date && DATE_KEYS.includes(key)) {
      result.date = parseDate(rest)
      consumed.add(i)
    }
  })

  // 헤더 라벨이 없는 Gmail 복사 형식: 첫 줄이 "이름 <메일>", 둘째 줄이 날짜.
  if (!result.from) {
    const idx = lines.findIndex((l) => /<[^>]+@[^>]+>/.test(l))
    if (idx >= 0) {
      result.from = personName(lines[idx])
      consumed.add(idx)
    }
  }
  if (!result.date) {
    for (let i = 0; i < lines.length; i++) {
      if (consumed.has(i)) continue
      const d = parseDate(lines[i])
      if (d) {
        result.date = d
        consumed.add(i)
        break
      }
    }
  }

  result.attachments = [...new Set(text.match(ATTACHMENT_RE) ?? [])]

  result.body = lines
    .filter((_, i) => !consumed.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // 제목을 못 찾았으면 본문 첫 줄을 제목 후보로 쓴다.
  if (!result.subject) {
    const first = result.body.split("\n").find((l) => l.trim().length > 0)
    if (first && first.length <= 120) result.subject = first.trim()
  }

  return result
}

/** Gmail 스레드 원문 딥링크에서 스레드 ID 를 뽑는다 */
export function extractThreadId(input: string): string | null {
  const m = /[#/]([0-9a-f]{16,})/i.exec(input.trim())
  if (m) return m[1]
  if (/^[0-9a-f]{16,}$/i.test(input.trim())) return input.trim()
  return null
}

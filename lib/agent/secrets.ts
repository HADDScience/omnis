// 비밀 옮김 막기 — 쓰기 제안의 본문에 비밀번호 · 인증 정보 · 개인 식별번호로 보이는 것이 있으면 실행하지 않는다.
// 순수 모듈(prisma 없음). 모델과 무관하게 코드로 막는다 — 시험: lib/agent/secrets.test.ts
//
// 왜: 운영 채팅에는 공용 PC · 게스트 와이파이 비밀번호 글이 그대로 남아 있다(작업지시자 결정 — 지우지 않는다).
// 0단계 벤치에서 gemini-3.5-flash-lite 가 두 번 다 그 비밀번호를 지식 카드 본문에 넣으려 했다.
// 채팅에 있는 것은 그 자리에 두되, 에이전트가 카드 · 기록 · 다른 방으로 옮기지 못하게 한다.
//
// 거짓 양성보다 놓치는 쪽이 비싸다. 다만 「비밀번호 재설정 안내」 처럼 값이 없는 말은 걸지 않는다 —
// 열쇠말 뒤에 값처럼 생긴 것(숫자 · 영문 · 기호가 섞인 4자 이상)이 올 때만 건다.

export type SecretKind = "password" | "credential" | "personal_id"

export interface SecretHit {
  kind: SecretKind
  /** 카드에 보일 이유 */
  reason: string
  /** 가린 일부 — 「ha••••」 */
  masked: string
}

export const SECRET_KIND_LABEL: Record<SecretKind, string> = {
  password: "비밀번호",
  credential: "인증 정보",
  personal_id: "개인 식별번호",
}

function mask(v: string): string {
  const s = v.trim()
  if (s.length <= 2) return "••"
  return `${s.slice(0, 2)}${"•".repeat(Math.min(s.length - 2, 6))}`
}

/** 값처럼 생긴 것 — 공백 없이 4자 이상, 숫자나 라틴 문자나 기호가 하나 이상 */
const VALUE = String.raw`([^\s"'“”‘’,，。]{4,})`
const looksLikeValue = (v: string) => /[0-9A-Za-z!@#$%^&*_+=~.\-]/.test(v) && !/^(입니다|이에요|예요|변경|재설정|초기화|분실|확인|요청|안내|공유|관리|설정|정책)/.test(v)

const PASSWORD_WORDS = String.raw`(?:비밀\s*번호|비번|패스워드|암호|password|passwd|passcode|pass\s*word|\bpw\b|\bpwd\b|wi-?fi\s*(?:비번|pw|key)|와이파이\s*(?:비번|비밀번호|암호|키))`
// 열쇠말 + (선택) 조사 · 구분자 + 값. 「비밀번호는 1234」 「PW: hadd!2024」 「와이파이 비번 haddguest」
const PASSWORD_RE = new RegExp(String.raw`${PASSWORD_WORDS}\s*(?:은|는|이|가|을|를|도|:|=|：|->|→)?\s*(?:[은는이가]\s*)?${VALUE}`, "giu")

const CREDENTIAL_RES: { re: RegExp; reason: string }[] = [
  { re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, reason: "API 키(sk-…)" },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g, reason: "Google API 키(AIza…)" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, reason: "GitHub 토큰" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, reason: "Slack 토큰" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, reason: "AWS 액세스 키" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, reason: "개인 키(PRIVATE KEY)" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, reason: "JWT 토큰" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, reason: "Bearer 토큰" },
  { re: /\bhadd_[A-Za-z0-9]{16,}/g, reason: "Omnis MCP 토큰(hadd_…)" },
  { re: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/g, reason: "비밀번호가 든 DB 주소" },
]

// 인증번호 · OTP · 토큰 · 시크릿 · API 키 열쇠말 + 값
const CREDENTIAL_WORDS = String.raw`(?:인증\s*(?:번호|코드)|OTP|오티피|보안\s*코드|api\s*key|api\s*키|secret|시크릿|토큰|token|액세스\s*키|access\s*key)`
const CREDENTIAL_KV_RE = new RegExp(String.raw`${CREDENTIAL_WORDS}\s*(?:은|는|이|가|:|=|：)?\s*(?:[은는이가]\s*)?${VALUE}`, "giu")

/** 주민등록번호 · 외국인등록번호 — 앞 6자리가 날짜이고 뒤 첫 자리가 1~8 */
const RRN_RE = /(?<!\d)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\s?[-–]?\s?([1-8])\d{6}(?!\d)/g
/** 운전면허번호 11-22-333333-44 */
const DRIVER_RE = /(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g
/** 여권번호 M12345678 — 「여권」 이 근처에 있을 때만 */
const PASSPORT_RE = /여권[^\n]{0,12}?\b([MSRODG][0-9]{8}|[MSRODG][0-9]{3}[A-Z][0-9]{4})\b/g
/** 카드번호 — 16자리 + Luhn */
const CARD_RE = /(?<!\d)(\d{4})[ -]?(\d{4})[ -]?(\d{4})[ -]?(\d{4})(?!\d)/g

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** 글 하나에서 찾는다 */
export function findSecretsInText(text: string): SecretHit[] {
  return scan(text).map(({ kind, reason, value }) => ({ kind, reason, masked: mask(value) }))
}

/** 찾은 값을 가린 글 — 막힌 카드에 보일 때. 값 자체를 새 표(AgentStep.preview)에 옮겨 적지 않으려는 것 */
export function redactSecrets(text: string): string {
  let out = text
  for (const { value } of scan(text).sort((a, b) => b.value.length - a.value.length)) out = out.split(value).join(mask(value))
  return out
}

function scan(text: string): { kind: SecretKind; reason: string; value: string }[] {
  const hits: { kind: SecretKind; reason: string; value: string }[] = []
  const seen = new Set<string>()
  const push = (kind: SecretKind, reason: string, value: string) => {
    const key = `${kind}:${value}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ kind, reason, value })
  }

  for (const m of text.matchAll(PASSWORD_RE)) {
    if (looksLikeValue(m[1])) push("password", "비밀번호로 보이는 값", m[1])
  }
  for (const { re, reason } of CREDENTIAL_RES) {
    for (const m of text.matchAll(re)) push("credential", reason, m[0])
  }
  for (const m of text.matchAll(CREDENTIAL_KV_RE)) {
    if (looksLikeValue(m[1]) && /\d/.test(m[1])) push("credential", "인증번호 · 토큰으로 보이는 값", m[1])
  }
  for (const m of text.matchAll(RRN_RE)) push("personal_id", "주민등록번호 · 외국인등록번호로 보이는 값", m[0])
  for (const m of text.matchAll(DRIVER_RE)) push("personal_id", "운전면허번호로 보이는 값", m[0])
  for (const m of text.matchAll(PASSPORT_RE)) push("personal_id", "여권번호로 보이는 값", m[1])
  for (const m of text.matchAll(CARD_RE)) {
    const digits = m.slice(1, 5).join("")
    if (luhn(digits)) push("credential", "카드번호로 보이는 값", m[0])
  }
  return hits
}

/** 도구 입력 전체(중첩 객체 · 배열의 모든 글)를 훑는다 */
export function findSecrets(input: unknown): SecretHit[] {
  const texts: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === "string") texts.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(input)
  const all = texts.flatMap(findSecretsInText)
  const seen = new Set<string>()
  return all.filter((h) => {
    const k = `${h.kind}:${h.masked}:${h.reason}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 카드에 보일 한 문장. 없으면 null */
export function secretBlockReason(input: unknown): string | null {
  const hits = findSecrets(input)
  if (hits.length === 0) return null
  const parts = hits.slice(0, 3).map((h) => `${h.reason}(${h.masked})`)
  const more = hits.length > 3 ? ` 외 ${hits.length - 3}건` : ""
  return `${parts.join(" · ")}${more}이 들어 있어 실행하지 않습니다. 비밀번호 · 인증 정보 · 개인 식별번호는 채팅 밖으로 옮기지 않습니다.`
}

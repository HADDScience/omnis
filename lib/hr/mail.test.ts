// 지원서 접수 메일 — 본문 · 한 번만 · 실패 격리. 통과 사례와 거부되어야 하는 경우를 함께 둔다. 실행: pnpm test:unit
import { test } from "node:test"
import assert from "node:assert/strict"
import { COMPANY_COPY_TO, applicantMail, companyCopyMail, type ApplicationForMail } from "./mail-content"
import { failReason, hrFromHeader, hrSmtpConfig, sendApplicationMails, type HrSmtpConfig, type MailDeps } from "./mail"

const app: ApplicationForMail = {
  id: "11111111-2222-3333-4444-555555555555",
  code: "APP261125-003",
  jobSlug: "suwon-anchor-practicum-intern-2026-winter",
  jobTitle: "[수원대 앵커사업단x현장실습] Intern",
  lang: "ko",
  receivedAt: new Date("2026-11-25T01:30:00Z"), // 10:30 KST
  name: "시험 지원자",
  department: "데이터과학부",
  studentId: "20231234",
  grade: "3",
  graduation: "2028년 2월",
  phone: "010-1234-5678",
  email: "applicant@example.com",
  portfolioUrl: "",
  interests: ["ai-bio", "grants"],
  motivation: "바이오 데이터를 다뤄 보고 싶습니다.",
  files: [
    { slot: "RESUME", fileName: "시험이력서.pdf" },
    { slot: "PORTFOLIO", fileName: "작품집.pdf" },
  ],
}

test("지원자 메일(국문) — 번호 · 공고 · 시각 · 쓴 칸 · 파일 이름 · 일정 · 회신 안내", () => {
  const m = applicantMail(app)
  assert.equal(m.to, "applicant@example.com")
  assert.equal(m.subject, "[하드사이언스] 현장실습 인턴 지원서가 접수되었습니다 (APP261125-003)")
  for (const want of [
    "APP261125-003", "[수원대 앵커사업단x현장실습] Intern", "10:30", "시험 지원자", "데이터과학부", "3학년",
    "AI 기반 바이오 연구, 국가과제 · TIPS 같은 지원 서류 작성", "시험이력서.pdf", "작품집.pdf",
    "2026년 11월 27일(금) 오후 5시", "12월 1일(화) 오전 11시, 랩스테이션 8층", "이 메일에 회신",
  ]) assert.ok(m.text.includes(want), `본문에 「${want}」 가 없다`)
  assert.ok(!m.text.includes("포트폴리오 링크"), "빈 칸은 줄을 만들지 않는다")
})

test("지원자 메일(영문 지원) — 영어로", () => {
  const m = applicantMail({ ...app, lang: "en", jobTitle: "[Suwon Anchor x Practicum] Intern" })
  assert.equal(m.subject, "[HADD Science] Your application has been received (APP261125-003)")
  assert.ok(m.text.includes("Lab Station 8th floor"))
  assert.ok(m.text.includes("reply to this email"))
  assert.ok(m.text.includes("AI-driven bio research, Writing applications for national R&D programs and TIPS"), "관심 있는 일은 영문 라벨로")
  assert.ok(!/[가-힣]{4,}/.test(m.text.replace(/시험 지원자|데이터과학부|2028년 2월|바이오 데이터를 다뤄 보고 싶습니다\.|시험이력서|작품집/g, "")), "지원자가 쓴 칸 밖에 한국어 문장이 섞였다")
})

test("일정을 모르는 공고는 일정 단락을 빼고, 제목은 「채용」 으로", () => {
  const m = applicantMail({ ...app, jobSlug: "other-job" })
  assert.ok(!m.text.includes("랩스테이션"))
  assert.match(m.subject, /^\[하드사이언스\] 채용 지원서가 접수되었습니다/)
})

test("회사 사본 — 번호 · 이름 · 학과 · 공고 · 시각 · 지원서함 링크만, 연락처 · 동기 · 파일 · 이메일은 없다", () => {
  const m = companyCopyMail(app, "https://omnis.haddscience.com/")
  assert.equal(m.to, COMPANY_COPY_TO)
  assert.equal(m.subject, "[채용] 새 지원서 APP261125-003 — 시험 지원자")
  assert.ok(m.text.includes("https://omnis.haddscience.com/hr/applications/11111111-2222-3333-4444-555555555555"))
  for (const want of ["데이터과학부", "[수원대 앵커사업단x현장실습] Intern", "10:30"]) assert.ok(m.text.includes(want), want)
  // 거부 — 개인정보가 새면 안 된다
  for (const leak of ["010-1234-5678", "applicant@example.com", "바이오 데이터를", "시험이력서.pdf", "작품집.pdf", "20231234"]) {
    assert.ok(!m.text.includes(leak) && !m.subject.includes(leak), `회사 사본에 「${leak}」 가 들어갔다`)
  }
})

test("설정 — 계정 · 비밀번호가 없으면 건너뛰고, 운영에서는 흉내 서버 설정을 무시한다", () => {
  assert.equal(hrSmtpConfig({ HR_SMTP_USER: "a@b" }), null)
  assert.equal(hrSmtpConfig({ HR_SMTP_PASSWORD: "x" }), null)
  const local = hrSmtpConfig({ HR_SMTP_USER: "a@b", HR_SMTP_PASSWORD: "x", HR_SMTP_HOST: "127.0.0.1", HR_SMTP_PORT: "2525", HR_SMTP_INSECURE: "1" })
  assert.deepEqual(local && { host: local.host, port: local.port, insecure: local.insecure }, { host: "127.0.0.1", port: 2525, insecure: true })
  const prod = hrSmtpConfig({ VERCEL_ENV: "production", HR_SMTP_USER: "a@b", HR_SMTP_PASSWORD: "x", HR_SMTP_HOST: "127.0.0.1", HR_SMTP_PORT: "2525", HR_SMTP_INSECURE: "1" })
  assert.deepEqual(prod && { host: prod.host, port: prod.port, insecure: prod.insecure }, { host: "smtp.worksmobile.com", port: 587, insecure: false })
  assert.equal(hrFromHeader("jwoochang@haddscience.com"), '"하드사이언스 정우창" <jwoochang@haddscience.com>')
})

const cfg: HrSmtpConfig = { user: "sender@example.com", pass: "x", host: "h", port: 587, insecure: false }
function fakeDeps(over: Partial<MailDeps> = {}) {
  const sent: string[] = []
  const notes: string[] = []
  const claimed = new Set<string>()
  const deps: MailDeps = {
    config: cfg,
    claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    send: async (_c, m) => void sent.push(m.to),
    record: async (_id, note) => void notes.push(note),
    omnisOrigin: "https://omnis.haddscience.com",
    ...over,
  }
  return { deps, sent, notes }
}

test("한 번만 — 같은 지원서로 두 번 불러도 두 통만 나간다", async () => {
  const { deps, sent } = fakeDeps()
  assert.deepEqual(await sendApplicationMails(app, deps), { applicant: "sent", company: "sent" })
  assert.deepEqual(await sendApplicationMails(app, deps), { skipped: "already" })
  assert.deepEqual(sent, ["applicant@example.com", COMPANY_COPY_TO])
})

test("설정이 없으면 표시도 잡지 않고 건너뛴다(나중에 넣어도 다음 지원서부터 간다)", async () => {
  let claims = 0
  const { deps, sent } = fakeDeps({ config: null, claim: async () => (claims++, true) })
  assert.deepEqual(await sendApplicationMails(app, deps), { skipped: "unconfigured" })
  assert.equal(claims, 0)
  assert.equal(sent.length, 0)
})

test("실패 격리 — 지원자 메일이 실패해도 회사 사본은 가고, 실패는 주소를 가린 채 기록된다", async () => {
  const sent: string[] = []
  const { deps, notes } = fakeDeps({
    send: async (_c, m) => {
      if (m.to === "applicant@example.com") throw new Error("550 5.1.1 <applicant@example.com>: Recipient address rejected")
      sent.push(m.to)
    },
  })
  const out = await sendApplicationMails(app, deps)
  assert.deepEqual(out, { applicant: "failed", company: "sent" })
  assert.deepEqual(sent, [COMPANY_COPY_TO])
  assert.equal(notes.length, 2)
  assert.match(notes[0], /^접수 확인 메일\(지원자\) 실패: 550 5\.1\.1 <<주소>>/)
  assert.ok(!notes.join(" ").includes("applicant@example.com"), "기록에 받는 주소가 남았다")
})

test("실패 격리 — 기록이 실패해도 던지지 않는다", async () => {
  const { deps } = fakeDeps({ send: async () => { throw new Error("timeout") }, record: async () => { throw new Error("db down") } })
  assert.deepEqual(await sendApplicationMails(app, deps), { applicant: "failed", company: "failed" })
})

test("실패 까닭 — 주소 모양은 가린다", () => {
  assert.equal(failReason(new Error("a@b.com bounced; c.d@e.kr too")), "<주소> bounced; <주소> too")
})

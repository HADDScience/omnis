/** 메일 보내는 길 고르기 — 웍스 SMTP > Resend > 없음, 시험 outbox 는 운영에서 안 켜진다. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { chooseMailTransport, fromHeader } from "./mailer"

const works = { WORKS_SMTP_USER: "u@haddscience.com", WORKS_SMTP_PASS: "p", WORKS_SMTP_FROM: "u@haddscience.com" }
const resend = { RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "a@x.dev" }

test("웍스 SMTP 세 값이 다 있으면 웍스", () => {
  assert.equal(chooseMailTransport({ ...works, ...resend }), "works-smtp")
})
test("웍스 값이 하나라도 없으면 Resend", () => {
  assert.equal(chooseMailTransport({ ...works, WORKS_SMTP_PASS: "", ...resend }), "resend")
  assert.equal(chooseMailTransport({ WORKS_SMTP_USER: "u", WORKS_SMTP_FROM: "f", ...resend }), "resend")
})
test("둘 다 없으면 보내지 않는다", () => {
  assert.equal(chooseMailTransport({}), "none")
  assert.equal(chooseMailTransport({ RESEND_API_KEY: "k" }), "none")
})
test("시험 outbox 는 운영 배포에서 켜지지 않는다", () => {
  assert.equal(chooseMailTransport({ MAIL_OUTBOX_DIR: "/tmp/x", ...works }), "outbox")
  assert.equal(chooseMailTransport({ MAIL_OUTBOX_DIR: "/tmp/x", VERCEL_ENV: "production", ...works }), "works-smtp")
})
test("보낸 사람 표시 이름은 옴니스", () => {
  assert.equal(fromHeader("a@haddscience.com"), '"옴니스" <a@haddscience.com>')
  assert.equal(fromHeader("Omnis <a@haddscience.com>"), '"옴니스" <a@haddscience.com>')
})

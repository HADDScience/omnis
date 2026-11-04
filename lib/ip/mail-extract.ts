/**
 * 메일 한 통에서 "무엇을 바꿔야 하는지"를 뽑아낸다.
 *
 * 커뮤니케이션 기록만 만드는 것이 아니라, 본문에 드러난 사실(출원번호·등록번호·
 * 등록가능성·상태 전이)을 관련 상표/특허 건의 변경 제안으로 만든다.
 * 실제 업무 기록이라 자동 반영하지 않고, 사용자가 검토해 고른 것만 적용한다.
 */

import { parseMail, parseDate, type ParsedMail } from "@/lib/ip/mail-parse"
import type { Communication, Patent, Trademark } from "@/lib/ip/types"

export interface EntityRef {
  kind: "trademark" | "patent"
  id: string
  label: string
  /** 무엇을 근거로 이 건이라고 판단했는지 (사용자에게 보여준다) */
  reason: string
}

export type Proposal =
  | {
      type: "field"
      key: string
      entity: EntityRef
      field: "regNo" | "appNo" | "date" | "status" | "probability"
      label: string
      before: string
      after: string
      /** 적용할 실제 값 */
      value: string | number | null
    }
  | {
      type: "note"
      key: string
      entity: EntityRef
      label: string
      text: string
    }
  | {
      type: "action"
      key: string
      entity: EntityRef | null
      label: string
      todo: string
      priority: "높음" | "보통" | "낮음"
    }

export interface Extraction {
  mail: ParsedMail
  /** 메일에서 찾은 관련 건 */
  entities: EntityRef[]
  proposals: Proposal[]
  /** 메일 본문에서 뽑은 원시 값 (디버깅/설명용) */
  found: {
    appNos: string[]
    regNos: string[]
    caseNos: string[]
    probability: number | null
    statusHint: string | null
  }
}

// ---------------------------------------------------------------------------
// 본문에서 값 뽑기
// ---------------------------------------------------------------------------

/** 10-2024-0173279 / 40-2025-0124087 형태의 출원번호 */
const APP_NO_RE = /\b\d{2}-\d{4}-\d{7}\b/g
/** 10-2877163 / 40-2359918 형태의 등록번호 */
const REG_NO_RE = /\b\d{2}-\d{7}\b/g
/** PJC260674 형태의 사건번호 */
const CASE_NO_RE = /\bPJC\d{4,}\b/gi

const uniq = (xs: string[]) => [...new Set(xs)]

/**
 * 검토의견 메일에는 우리 건이 아닌 **선행상표·인용례**의 번호와 거절 사실이 함께 나온다.
 * 예: "선행 거절사례 '에드힐/ADD Heal'(40-2024-0148020, 제29류)는 ... 거절되었습니다"
 * 이런 문장에서 값을 끌어오면 남의 번호를 우리 건에 박아 넣게 되므로 통째로 제외한다.
 */
const REFERENCE_CONTEXT =
  /선행|거절\s*사례|인용|선등록|기등록|참고|타사|유사\s*상표|검색식|검색\s*결과/

/** 문장 단위로 쪼개되, 참고문맥 문장은 걸러낸다. */
function ownSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !REFERENCE_CONTEXT.test(s))
}

/** 우리 건에 대한 서술만 남긴 본문 */
function ownText(text: string): string {
  return ownSentences(text).join("\n")
}

function findProbability(text: string): number | null {
  // "등록가능성은 60% 이상", "등록가능성 40%", "거절가능성도 40%"
  const m =
    /등록\s*가능성[^0-9%]{0,20}(\d{1,3})\s*%/.exec(text) ??
    /(\d{1,3})\s*%[^.]{0,10}등록\s*가능/.exec(text)
  if (!m) return null
  const v = Number(m[1])
  return v >= 0 && v <= 100 ? v : null
}

/** 상태 전이를 암시하는 표현 */
const STATUS_HINTS: { re: RegExp; trademark?: string; patent?: string; label: string }[] = [
  { re: /거절\s*결정|거절되었|거절이\s*확정/, trademark: "거절결정", label: "거절결정 언급" },
  { re: /등록\s*결정|등록되었|등록증|등록을\s*완료/, trademark: "등록완료", patent: "등록", label: "등록 언급" },
  { re: /출원\s*완료|출원하였|출원을\s*완료|출원番|출원번호[는가:\s]/, trademark: "출원준비", patent: "출원", label: "출원 언급" },
  { re: /검토의견|등록\s*가능성/, trademark: "검토중", label: "검토의견 언급" },
]

function findStatusHint(
  text: string,
  kind: "trademark" | "patent"
): { status: string; label: string } | null {
  for (const h of STATUS_HINTS) {
    if (!h.re.test(text)) continue
    const status = kind === "trademark" ? h.trademark : h.patent
    if (status) return { status, label: h.label }
  }
  return null
}

/** 회신·송부 요청이 있으면 미결 액션 후보로 본다 */
const ACTION_HINTS = [
  { re: /회신\s*(부탁|요청|바랍)/, label: "회신 요청" },
  { re: /송부\s*(부탁|요청|바랍)/, label: "자료 송부 요청" },
  { re: /확인\s*(부탁|요청|바랍)/, label: "확인 요청" },
  { re: /제출\s*(부탁|요청|바랍)/, label: "제출 요청" },
  { re: /의견제출통지서/, label: "의견제출통지서 대응" },
]

// ---------------------------------------------------------------------------
// 건 매칭
// ---------------------------------------------------------------------------

/** 짧거나 흔한 이름은 오탐이 나므로 최소 길이를 둔다 */
const MIN_NAME_LEN = 3

function matchTrademarks(text: string, trademarks: Trademark[]): EntityRef[] {
  const lower = text.toLowerCase()
  const refs: EntityRef[] = []

  for (const t of trademarks) {
    const reasons: string[] = []

    for (const key of [t.name, t.nameKo].filter(Boolean)) {
      const k = String(key).trim()
      if (k.length < MIN_NAME_LEN) continue
      if (lower.includes(k.toLowerCase())) reasons.push(`이름 "${k}" 언급`)
    }
    if (t.regNo && text.includes(t.regNo)) reasons.push(`번호 ${t.regNo} 일치`)

    if (reasons.length > 0) {
      refs.push({
        kind: "trademark",
        id: t.id,
        label: t.name,
        reason: reasons[0],
      })
    }
  }
  return refs
}

function matchPatents(text: string, patents: Patent[]): EntityRef[] {
  const lower = text.toLowerCase()
  const refs: EntityRef[] = []

  for (const p of patents) {
    const reasons: string[] = []

    for (const num of [p.appNo, p.regNo]) {
      if (!num) continue
      // "사건번호: PJC260674" 처럼 접두어가 붙어 있어도 숫자 토큰으로 비교한다.
      const tokens = num.match(/[A-Z]{2,}\d{4,}|\d{2}-\d{4}-\d{7}|\d{2}-\d{7}/gi) ?? []
      for (const tok of tokens) {
        if (lower.includes(tok.toLowerCase())) reasons.push(`번호 ${tok} 일치`)
      }
    }

    // 명칭이 길어 통째로는 잘 안 맞으므로 앞부분 특징어로 본다.
    const head = p.title.slice(0, 12)
    if (head.length >= MIN_NAME_LEN && lower.includes(head.toLowerCase())) {
      reasons.push(`명칭 "${head}…" 언급`)
    }

    if (reasons.length > 0) {
      refs.push({ kind: "patent", id: p.id, label: p.title, reason: reasons[0] })
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// 제안 만들기
// ---------------------------------------------------------------------------

const show = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v)

export function extract(
  raw: string,
  trademarks: Trademark[],
  patents: Patent[]
): Extraction {
  const mail = parseMail(raw)
  const text = raw
  // 번호·상태처럼 건에 직접 반영되는 값은 참고문맥을 뺀 본문에서만 뽑는다.
  const own = ownText(raw)

  const found = {
    appNos: uniq(own.match(APP_NO_RE) ?? []),
    regNos: uniq(own.match(REG_NO_RE) ?? []).filter(
      // 출원번호의 뒷부분이 등록번호처럼 잡히는 것을 걸러낸다.
      (r) => !(own.match(APP_NO_RE) ?? []).some((a) => a.includes(r))
    ),
    caseNos: uniq((own.match(CASE_NO_RE) ?? []).map((x) => x.toUpperCase())),
    probability: findProbability(own),
    statusHint: null as string | null,
  }

  // 건 매칭은 전체 본문에서 한다 (선행상표 문장에도 우리 상표명이 나올 수 있다).
  const entities = [
    ...matchTrademarks(text, trademarks),
    ...matchPatents(text, patents),
  ]

  const proposals: Proposal[] = []
  const mailDate = mail.date ?? parseDate(text)

  for (const ref of entities) {
    if (ref.kind === "trademark") {
      const t = trademarks.find((x) => x.id === ref.id)
      if (!t) continue

      // 등록/출원번호 — 아직 비어 있을 때만 제안한다.
      const num = found.regNos[0] ?? found.appNos[0] ?? null
      if (num && t.regNo !== num) {
        proposals.push({
          type: "field",
          key: `${ref.id}:regNo`,
          entity: ref,
          field: "regNo",
          label: "등록/출원번호",
          before: show(t.regNo),
          after: num,
          value: num,
        })
      }

      if (found.probability !== null && t.probability !== found.probability) {
        proposals.push({
          type: "field",
          key: `${ref.id}:probability`,
          entity: ref,
          field: "probability",
          label: "등록가능성",
          before: t.probability === null ? "—" : `${t.probability}%`,
          after: `${found.probability}%`,
          value: found.probability,
        })
      }

      const hint = findStatusHint(own, "trademark")
      if (hint && hint.status !== t.status) {
        proposals.push({
          type: "field",
          key: `${ref.id}:status`,
          entity: ref,
          field: "status",
          label: `상태 (${hint.label})`,
          before: t.status,
          after: hint.status,
          value: hint.status,
        })
      }

      if (mailDate && t.date !== mailDate) {
        proposals.push({
          type: "field",
          key: `${ref.id}:date`,
          entity: ref,
          field: "date",
          label: "기준일",
          before: show(t.date),
          after: mailDate,
          value: mailDate,
        })
      }
    } else {
      const p = patents.find((x) => x.id === ref.id)
      if (!p) continue

      const appNo = found.appNos[0] ?? null
      if (appNo && p.appNo !== appNo) {
        proposals.push({
          type: "field",
          key: `${ref.id}:appNo`,
          entity: ref,
          field: "appNo",
          label: "출원번호",
          before: show(p.appNo),
          after: appNo,
          value: appNo,
        })
      }

      const regNo = found.regNos[0] ?? null
      if (regNo && p.regNo !== regNo) {
        proposals.push({
          type: "field",
          key: `${ref.id}:regNo`,
          entity: ref,
          field: "regNo",
          label: "등록번호",
          before: show(p.regNo),
          after: regNo,
          value: regNo,
        })
      }

      const hint = findStatusHint(own, "patent")
      if (hint && hint.status !== p.status) {
        proposals.push({
          type: "field",
          key: `${ref.id}:status`,
          entity: ref,
          field: "status",
          label: `상태 (${hint.label})`,
          before: p.status,
          after: hint.status,
          value: hint.status,
        })
      }

      if (mailDate && p.date !== mailDate) {
        proposals.push({
          type: "field",
          key: `${ref.id}:date`,
          entity: ref,
          field: "date",
          label: "기준일",
          before: show(p.date),
          after: mailDate,
          value: mailDate,
        })
      }
    }

    // 메일 요지를 비고에 덧붙이는 제안
    const summary = (mail.subject ?? "").trim()
    if (summary) {
      proposals.push({
        type: "note",
        key: `${ref.id}:note`,
        entity: ref,
        label: "비고에 덧붙이기",
        text: `${mailDate ?? ""} ${summary}`.trim(),
      })
    }
  }

  // 요청사항이 있으면 미결 액션 제안
  for (const h of ACTION_HINTS) {
    if (!h.re.test(own)) continue
    const first = entities[0] ?? null
    proposals.push({
      type: "action",
      key: `action:${h.label}`,
      entity: first,
      label: `미결 액션 생성 — ${h.label}`,
      todo: mail.subject ? `${h.label}: ${mail.subject}` : h.label,
      priority: "높음",
    })
    break // 하나면 충분하다
  }

  return { mail, entities, proposals, found }
}

/** 추출 결과로 커뮤니케이션 기록 초안을 만든다 */
export function toCommunication(
  e: Extraction,
  today: string,
  fallbackTarget: Communication["target"] = "상표"
): Communication {
  const target: Communication["target"] =
    e.entities.some((x) => x.kind === "patent") ? "특허" : fallbackTarget

  return {
    id: "",
    date: e.mail.date ?? today,
    // 우리 쪽 사람이 보낸 것이 아니면 수신으로 본다.
    dir: /정우창|하드사이언스|HADD/i.test(e.mail.from ?? "") ? "발신" : "수신",
    from: e.mail.from ?? "",
    to: e.mail.to ?? "",
    target,
    subject: e.mail.subject ?? "",
    body: e.mail.body,
    attachments: e.mail.attachments,
    followUp: "",
    open: e.proposals.some((p) => p.type === "action"),
    threadId: null,
    links: e.entities.map((x) => ({ kind: x.kind, id: x.id })),
  }
}

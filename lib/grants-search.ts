// 국가과제 검색 — 우리 결정 · 과제 후보(공고) 모두. 화면(아카이브 › 국가과제)과 도구(list_grant_decisions · search_grant_notices 의 q)가 같이 쓴다.
//
// 규칙: 한글 부분 일치, 띄어쓰기 무시(찾는 글 · 대상 글 모두 공백을 뺀다), 여러 낱말은 모두 들어 있어야(AND), 대소문자 무시.
// 대상: 제목 · 기관(부처 · 전문기관) · 사업명(제출 과제명 · 이어진 공고 이름) · 메모 · 사유 · 담당 이름 · 공고 판정 근거(본문 요약 · 인용) ·
// 가점 항목 이름 · 첨부 파일 이름 · 분야 · 지역. 결정은 이어진 공고(externalKey · noticeLinks)의 글까지, 공고는 그 공고를 올린 결정의 글까지 본다.
//
// 서버에서 SQL 하나로 찾는다(공고 873건 · 결정 51건, 색인 없이 순차로 수 ms). 색인 · 마이그레이션은 두지 않았다.
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"

/** 찾는 말 → 낱말들. NFC · 소문자 · 공백으로 나눈다. 최대 8개, 낱말마다 50자 */
export function searchTerms(q: unknown): string[] {
  if (typeof q !== "string") return []
  const out: string[] = []
  for (const w of q.normalize("NFC").toLowerCase().split(/\s+/)) {
    const t = w.trim().slice(0, 50)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= 8) break
  }
  return out
}

/** LIKE 패턴 — % _ \ 는 글자 그대로 */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** 대상 글을 비교 모양으로 — 시험 · 클라이언트 쪽 대조용(SQL 은 같은 일을 regexp_replace · lower 로 한다) */
export const squashForSearch = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, "")

/** 낱말이 모두 들어 있는가(AND) — SQL 과 같은 규칙의 순수 판정 */
export const matchesAll = (haystack: string, terms: string[]) => {
  const h = squashForSearch(haystack)
  return terms.every((t) => h.includes(squashForSearch(t)))
}

const arr = (col: string) => `(CASE WHEN jsonb_typeof(${col}) = 'array' THEN ${col} ELSE '[]'::jsonb END)`
const pluck = (col: string, ...keys: string[]) =>
  `(SELECT string_agg(concat_ws(' ', ${keys.map((k) => `e->>'${k}'`).join(", ")}), ' ') FROM jsonb_array_elements(${arr(col)}) e)`

/** 공고 하나의 글 — n 은 "GrantNotice" 별칭 */
const NOTICE_TEXT = (n: string) => `concat_ws(' ',
  ${n}.title, ${n}.ministry, ${n}.agency, ${n}."deadlineRaw",
  ${pluck(`${n}."reasonsSole"`, "claim", "quote")},
  ${pluck(`${n}."reasonsCorp"`, "claim", "quote")},
  ${pluck(`${n}."bonusItems"`, "label")},
  ${pluck(`${n}.attachments`, "name")},
  array_to_string(${n}.fields, ' '), array_to_string(${n}."regionDetail", ' ')
)`

/** 결정 하나의 글(이어진 공고 제외) — d 는 "GrantDecision" 별칭 */
const DECISION_TEXT = (d: string) => `concat_ws(' ',
  ${d}.title, ${d}."submittedTitle", ${d}."statusRaw", ${d}.note, ${d}."stageReason", ${d}.amount, ${d}."nasFolder",
  (SELECT string_agg(u.name, ' ') FROM "GrantDecisionOwner" o JOIN "User" u ON u.id = o."userId" WHERE o."decisionId" = ${d}.id),
  ${pluck(`${d}."noticeLinks"`, "title")}
)`

const squashSql = (expr: string) => `regexp_replace(lower(${expr}), '\\s+', '', 'g')`

function whereAll(terms: string[]) {
  return Prisma.join(
    terms.map((t) => Prisma.sql`h.t LIKE ${likePattern(squashForSearch(t))} ESCAPE '\\'`),
    " AND "
  )
}

/** 결정 id — 결정 글 + 이어진 공고(올린 공고 · noticeLinks 의 export_key) 글 */
export async function searchDecisionIds(terms: string[]): Promise<string[]> {
  if (!terms.length) return []
  const hay = Prisma.raw(`
    SELECT d.id, ${squashSql(`concat_ws(' ', ${DECISION_TEXT("d")},
      (SELECT string_agg(${NOTICE_TEXT("n")}, ' ') FROM "GrantNotice" n
        WHERE n."externalKey" = d."externalKey"
           OR n."externalKey" IN (SELECT e->>'export_key' FROM jsonb_array_elements(${arr(`d."noticeLinks"`)}) e)))`)} AS t
    FROM "GrantDecision" d`)
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`WITH h AS (${hay}) SELECT h.id FROM h WHERE ${whereAll(terms)}`)
  return rows.map((r) => r.id)
}

/** 공고 id — 공고 글 + 그 공고를 올리거나 이은 결정의 글 */
export async function searchNoticeIds(terms: string[]): Promise<string[]> {
  if (!terms.length) return []
  const hay = Prisma.raw(`
    SELECT n.id, ${squashSql(`concat_ws(' ', ${NOTICE_TEXT("n")},
      (SELECT string_agg(${DECISION_TEXT("d")}, ' ') FROM "GrantDecision" d
        WHERE d."externalKey" = n."externalKey"
           OR ${arr(`d."noticeLinks"`)} @> jsonb_build_array(jsonb_build_object('export_key', n."externalKey"))))`)} AS t
    FROM "GrantNotice" n`)
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`WITH h AS (${hay}) SELECT h.id FROM h WHERE ${whereAll(terms)}`)
  return rows.map((r) => r.id)
}

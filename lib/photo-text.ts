// 사진 설명의 글 쪽 — 프롬프트 · 출력 해석 · 가림 · 색인 글. 순수 모듈(prisma 없음).
// 앱(gpt, lib/photo-describe.ts)과 이 맥의 일괄 · 카톡 이식(claude 구독, scripts/photo-backfill.ts)이 같이 쓴다 —
// 어느 길로 들어온 사진이든 같은 모양으로 검색되게.
// 시험: lib/photo-text.test.ts · 계획: mydocs/plans/2026-10-29-photo-search.md
import { PhotoDescriptionSchema, type PhotoDescription } from "@/lib/schemas/photo"

export interface PhotoContext {
  /** 사진이 붙은 업무 이름 */
  task: string | null
  /** 앞뒤 대화. 사진 자리는 `<<이 사진>>` 이 든 줄 */
  lines: string[]
}

// 업무로 공유된 사진이라 연락처 · 계좌 · 비밀번호도 옮긴다(작업지시자 결정 2026-10-29).
// 주민등록번호 · 카드번호만 가린다 — 회사 정보가 아니라 개인 정보라서.
const PROMPT = `사내 업무 채팅에 올라온 사진 한 장을 검색 색인에 넣을 글로 옮긴다. 나중에 사람들이 이 글을 검색해 사진을 찾는다.

아래 JSON 하나만 출력한다. 코드블록·설명을 붙이지 않는다.

{
  "종류": "문서 | 포스터 | 화면캡처 | 슬라이드 | 제품·로고 | 행사·사람 | 장소·장비 | 손글씨 | 기타 중 하나",
  "설명": "무엇이 찍혔는지 2~4문장. 사진에 보이는 것만.",
  "사진속글자": "사진에 보이는 주요 글자를 그대로 옮긴다. 제목·기관명·제품명·날짜·숫자 위주, 300자 이내. 없으면 빈 문자열.",
  "업무": "앞뒤 대화로 본 이 사진의 용도 한 문장. 대화와 관계가 안 보이면 빈 문자열.",
  "검색어": ["사람들이 이 사진을 찾을 때 칠 만한 말 5개"]
}

규칙:
1. 사진에 보이지 않는 것을 쓰지 않는다. 대화에만 나온 내용을 사진에 있다고 쓰지 않는다 — 대화에서 온 정보는 "업무"에만 쓴다.
2. 사람 이름은 사진에 글자로 보이거나 대화에서 분명할 때만 쓴다. 얼굴만 보고 누구인지 추측하지 않는다.
3. 업무로 공유된 사진이다. 전화번호·이메일·계좌번호·비밀번호·와이파이 정보도 사람들이 찾을 수 있게 글자 그대로 옮기고, 무엇의 번호·비밀번호인지 설명과 검색어에 함께 쓴다(예: "박○○ 전화번호", "연구실 와이파이 비밀번호"). 주민등록번호와 카드번호만 옮기지 않고 "[가림]" 으로 쓴다.
4. 한국어로 쓴다. 영문 제품명·기관명은 원문 그대로 두고, 검색어에는 한글 읽기도 하나 넣는다(예: ADD GEL → 애드젤).`

export function photoPrompt(ctx: PhotoContext): string {
  return `${PROMPT}

이 사진이 붙은 업무: ${ctx.task ?? "(없음)"}

사진 앞뒤 대화 (<<이 사진>> 자리에 사진이 올라왔다):
${ctx.lines.join("\n")}`
}

/** 모델 출력 → 설명. 코드블록으로 감싸 오거나 앞뒤에 말을 붙여도 첫 `{` ~ 마지막 `}` 를 읽는다 */
export function parsePhotoDescription(text: string): PhotoDescription | null {
  const s = text.indexOf("{")
  const e = text.lastIndexOf("}")
  if (s < 0 || e <= s) return null
  try {
    const r = PhotoDescriptionSchema.safeParse(JSON.parse(text.slice(s, e + 1)))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

// ─── 가림 — 모델이 놓쳐도 코드로 한 번 더 ───────────────────────────────
// 실험에서 gemini-3.5-flash-lite 는 한 칸에서 가리고 다른 칸에 그대로 적었다. 칸마다가 아니라 글 전체에 건다.

/** 주민등록번호 — 앞 6자리가 날짜로 말이 되고 뒤 첫 자리가 1~8 */
const RRN_RE = /(?<!\d)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\s?-?\s?[1-8]\d{6}(?!\d)/g
/** 카드번호 — 4·4·4·4(구분자 - 또는 공백 또는 없음). 룬 검사를 통과할 때만 — 같은 길이의 계좌번호를 가리지 않게 */
const CARD_RE = /(?<!\d)\d{4}([ -]?)\d{4}\1\d{4}\1\d{4}(?!\d)/g

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

export function maskPersonalIds(text: string): string {
  return text
    .replace(RRN_RE, "[가림]")
    .replace(CARD_RE, (m) => (luhn(m.replace(/\D/g, "")) ? "[가림]" : m))
}

/** File.description 에 저장하는 글 — 검색 색인 청크의 본문이 된다. 가림까지 끝낸 것 */
export function photoIndexText(d: PhotoDescription): string {
  const lines = [
    d.종류 && `종류: ${d.종류}`,
    d.설명 && `설명: ${d.설명}`,
    d.사진속글자 && `사진 속 글자: ${d.사진속글자}`,
    d.업무 && `용도: ${d.업무}`,
    d.검색어.length > 0 && `검색어: ${d.검색어.join(", ")}`,
  ].filter((x): x is string => !!x)
  return maskPersonalIds(lines.join("\n"))
}

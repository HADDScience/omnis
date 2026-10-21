/**
 * 칼럼 초안의 이미지 제안 — 검토용. 이미지를 만들지는 않는다.
 *
 * 초안을 만들 때 Gemini 가 글 맨 앞(썸네일용) 하나와 소제목마다 하나씩 낸다.
 * 사람은 이걸 보고 사진을 구하거나, 영문 프롬프트를 복사해 ChatGPT·Gemini 에서 직접 그린다.
 *
 * 저장은 `ColumnDraft.imageSuggestions`(Json, null = 제안 없음 — 2026-10-21 이전 초안).
 * 본문 블록(`blocks`)에 넣지 않는 이유:
 *   - 블록은 사이트 PostBlock 그대로이고 게시 때 WebsitePost 로 간다. 블록 종류를 늘리면 공개 스키마가 바뀐다.
 *   - 기존 「게시 전에 지우라는 안내 상자」(quote 블록)는 남아 있으면 검토 요청을 막는다.
 *     제안은 대표님 검토 때도 보여야 하므로 그 방식을 쓸 수 없다.
 * 게시(`publishInput`)는 blocks 만 읽으므로 제안은 WebsitePost 에 닿지 않는다.
 *
 * 소제목과의 연결은 `heading`(만들 때의 소제목 글자)과 `n`(몇 번째 소제목인지)으로 한다.
 * 편집기는 글자가 같은 소제목을 먼저 찾고, 없으면 n 번째 소제목에 붙인다 — 소제목을 고쳐 써도,
 * 순서를 바꿔도 대개 제자리를 찾는다.
 */
import { z } from "zod"

export const ImageSuggestionSchema = z.object({
  id: z.string().min(1).max(40),
  /** lead = 글 맨 앞(썸네일). heading = 소제목 아래 */
  target: z.enum(["lead", "heading"]),
  /** target=heading 일 때 만들 때의 소제목 글자 */
  heading: z.string().max(2_000).optional(), // 소제목 블록 한도(website.ts short)와 같게
  /** target=heading 일 때 몇 번째 소제목인지(0부터) */
  n: z.number().int().min(0).max(100).optional(),
  /** 어떤 사진·그림이 어울리는지 한두 문장 */
  idea: z.string().max(2_000),
  /** 어디서 구할지 1~3개 */
  sources: z.array(z.string().max(500)).max(5),
  /** AI 이미지 생성 프롬프트(영문) */
  prompt: z.string().max(4_000),
  /** 사람이 사진을 넣은 뒤 「완료」로 접은 것 */
  done: z.boolean().optional(),
})
export type ImageSuggestion = z.infer<typeof ImageSuggestionSchema>

export const ImageSuggestionsSchema = z.array(ImageSuggestionSchema).max(30)

/** 프롬프트에 붙이는 지시. 출력 형식은 draft.ts 의 JSON 예시와 함께 읽힌다. */
export const IMAGE_SUGGEST_INSTRUCTIONS = `이미지 제안(검토용, 게시되지 않는다):
- leadImage 에 글 맨 앞(목록 썸네일)용 제안 하나, sections 의 각 항목 image 에 그 소제목 단락용 제안 하나를 쓴다.
- idea: 이 단락에 어울리는 사진·그림을 한두 문장(한국어). 근거 기사에 없는 사실을 그림에 담지 않는다.
  그림에는 글자가 들어가지 않으므로 「인포그래픽」「도표」「그래프」라고 부르지 않는다 — 「일러스트」「장면」이라고 쓴다.
- sources: 이미지를 어디서 구할지 1~3개(한국어). 아래 같은 일반 경로만 쓴다. 특정 사진이 어딘가에 있다고 지어내지 않는다.
  · 「회사 제품 사진(NAS 61. HADD 디자인 / 09. 하드사이언스 사진)」 — 하드사이언스 제품·연구 장면이 어울릴 때만
  · 「정책브리핑·식약처 등 정부 보도자료 사진(공공누리 유형 확인)」 — 정부 발표가 근거일 때
  · 「AI 생성 이미지(아래 프롬프트) — 출처에 'AI 생성 이미지'로 표기」
  · 근거 기사 사진을 떠올렸다면 「근거 기사 [n] 의 사진은 언론사 저작물이라 쓰지 않는다」고 적는다
- prompt: 영어로 쓴 AI 이미지 생성 프롬프트 한 단락.
  · idea 와 같은 장면이어야 한다. idea 에 적은 대상·배경·관계(예: 배양 용기, 계통도, 비교)를 prompt 에 빠짐없이 영어로 옮긴다.
    사람은 idea 를 읽고 prompt 를 복사한다 — 둘이 다르면 「설명과 다른 그림」이 나온다.
  · 대상을 실제 생김새로 묘사한다. 특히 하드사이언스가 다루는 것은 정확히:
    오가노이드 = 속이 빈 내강(lumen)을 둘러싼 상피세포 층, 바깥으로 돋아난 출아(budding) 구조가 있는 수백 µm 크기의 3D 세포 덩어리(비눗방울 뭉치가 아니다).
    배양 = 웰 플레이트(well plate)나 페트리 접시 안, 투명한 하이드로젤 돔(dome) 속에서 자란다.
    계통도·분화 = 한 세포에서 갈라지는 가지 도식(lineage diagram)으로, 식물 나무 모양이 아니다.
  · 구도는 제안마다 다르게 한다. 같은 글 안에서 반복하지 않는다:
    leadImage 만 왼쪽 1/3 을 비운 구도("left third kept empty as clean background for a title added later"),
    소제목 그림은 화면을 채우되 단락 성격에 맞춰 고른다 — 단면도(cross-section), 둘을 나란히 놓은 비교(side-by-side), 현미경 사진풍(microscopy-style), 실험실 장면(lab bench scene), 위에서 본 시점(top-down) 등.
  · 공통 톤: 16:9 landscape, white to pale sky-blue background, blue and navy palette, clean scientific 3D illustration, soft lighting, professional.
  · 실존 인물·실제 로고·브랜드명·글자·숫자를 그림에 넣지 않는다(프롬프트에 "no text, no letters, no logos, no real people"을 넣는다).
    HADD 로고는 사람이 나중에 실제 파일로 합성하므로 프롬프트에 넣지 않는다.`

interface RawImage {
  idea?: unknown
  sources?: unknown
  prompt?: unknown
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

function one(raw: unknown, base: Pick<ImageSuggestion, "id" | "target" | "heading" | "n">): ImageSuggestion | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as RawImage
  const idea = str(r.idea)
  const prompt = str(r.prompt)
  const sources = (Array.isArray(r.sources) ? r.sources : typeof r.sources === "string" ? [r.sources] : [])
    .map(str)
    .filter(Boolean)
    .slice(0, 3)
  if (!idea && !prompt) return null
  const parsed = ImageSuggestionSchema.safeParse({ ...base, idea, sources, prompt })
  return parsed.success ? parsed.data : null
}

/**
 * 모델 응답에서 제안만 뽑는다. 모양이 틀린 제안은 버리고 초안은 살린다 — 제안이 없다고
 * 초안 전체를 다시 만들게 하면 Gemini 를 한 번 더 부르게 된다.
 */
export function toImageSuggestions(raw: { leadImage?: unknown; sections?: { heading?: unknown; image?: unknown }[] }): ImageSuggestion[] {
  const out: ImageSuggestion[] = []
  const lead = one(raw.leadImage, { id: "lead", target: "lead" })
  if (lead) out.push(lead)
  let n = 0
  for (const sec of Array.isArray(raw.sections) ? raw.sections : []) {
    const heading = str(sec?.heading)
    if (!heading) continue // toBlocks 도 소제목 없는 섹션에는 heading 블록을 만들지 않는다
    const s = one(sec.image, { id: `h${n}`, target: "heading", heading, n })
    if (s) out.push(s)
    n++
  }
  return out
}

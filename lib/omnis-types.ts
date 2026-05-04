// ─── 옴니스 카드 섹션 타입 ─────────────────────────────

export interface TextSection {
  id: string
  type: "text"
  title: string
  body: string
}

export interface TableSection {
  id: string
  type: "table"
  title: string
  headers: string[]
  rows: string[][]
}

export type KeyValueType = "text" | "date" | "email" | "url" | "person"

export const KEYVALUE_TYPE_LABELS: Record<KeyValueType, string> = {
  text: "텍스트",
  date: "날짜",
  email: "이메일",
  url: "링크",
  person: "사람",
}

export interface KeyValuePair {
  key: string
  value: string
  valueType?: KeyValueType
}

export interface KeyValueSection {
  id: string
  type: "keyvalue"
  title: string
  pairs: KeyValuePair[]
}

export interface FilesSection {
  id: string
  type: "files"
  title: string
  fileIds: string[]
}

export interface LinksSection {
  id: string
  type: "links"
  title: string
  cardIds: string[]
}

export type Section =
  | TextSection
  | TableSection
  | KeyValueSection
  | FilesSection
  | LinksSection

export type SectionType = Section["type"]

export interface CardContent {
  status?: string
  sections: Section[]
  /** @deprecated 하위 호환용 — 마이그레이션 전 카드 */
  text?: string
}

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  text: "텍스트",
  table: "테이블",
  keyvalue: "키-값",
  files: "첨부파일",
  links: "관련 카드",
}

export function createEmptySection(type: SectionType, title = ""): Section {
  const id = crypto.randomUUID()
  switch (type) {
    case "text":
      return { id, type, title, body: "" }
    case "table":
      return { id, type, title, headers: ["항목", "내용"], rows: [["", ""]] }
    case "keyvalue":
      return { id, type, title, pairs: [{ key: "", value: "" }] }
    case "files":
      return { id, type, title, fileIds: [] }
    case "links":
      return { id, type, title, cardIds: [] }
  }
}

/** 기존 text-only content를 sections 형식으로 변환 */
export function migrateContent(content: unknown): CardContent {
  if (!content || typeof content !== "object") {
    return { sections: [] }
  }
  const obj = content as Record<string, unknown>

  // 이미 sections가 있으면 그대로 반환
  if (Array.isArray(obj.sections)) {
    return obj as unknown as CardContent
  }

  // 기존 text-only 카드 → text 섹션으로 변환
  const sections: Section[] = []
  if (typeof obj.text === "string" && obj.text.trim()) {
    sections.push({
      id: crypto.randomUUID(),
      type: "text",
      title: "내용",
      body: obj.text,
    })
  }

  return {
    status: typeof obj.status === "string" ? obj.status : undefined,
    sections,
  }
}

// ─── 카드 생성 템플릿 ────────────────────────────────────

export interface CardTemplate {
  name: string
  icon: string
  sections: Record<string, unknown>[]
}

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    name: "빈 카드",
    icon: "📄",
    sections: [{ type: "text", title: "내용", body: "" }],
  },
  {
    name: "기업 프로필",
    icon: "🏢",
    sections: [
      { type: "keyvalue", title: "기본정보", pairs: [
        { key: "설립일", value: "" }, { key: "대표자", value: "" },
        { key: "소재지", value: "" }, { key: "사업자등록번호", value: "" },
        { key: "업종", value: "" }, { key: "연락처", value: "" },
      ]},
      { type: "text", title: "회사 소개", body: "" },
      { type: "files", title: "증빙서류", fileIds: [] },
    ],
  },
  {
    name: "재무 현황",
    icon: "📊",
    sections: [
      { type: "table", title: "연도별 실적", headers: ["연도", "매출(백만원)", "영업이익", "직원수"], rows: [["", "", "", ""]] },
      { type: "files", title: "재무제표", fileIds: [] },
    ],
  },
  {
    name: "인력 카드",
    icon: "👤",
    sections: [
      { type: "keyvalue", title: "인적사항", pairs: [
        { key: "이름", value: "" }, { key: "직급", value: "" },
        { key: "전공", value: "" }, { key: "학력", value: "" },
        { key: "입사일", value: "" },
      ]},
      { type: "table", title: "보유 자격", headers: ["자격명", "취득일", "발급기관"], rows: [["", "", ""]] },
      { type: "table", title: "경력사항", headers: ["기간", "기관", "직위", "업무내용"], rows: [["", "", "", ""]] },
      { type: "text", title: "주요 성과", body: "" },
    ],
  },
  {
    name: "인증/특허",
    icon: "📜",
    sections: [
      { type: "keyvalue", title: "기본정보", pairs: [
        { key: "인증/특허명", value: "" }, { key: "번호", value: "" },
        { key: "기관", value: "" }, { key: "취득/출원일", value: "" },
        { key: "유효기간", value: "" }, { key: "상태", value: "" },
      ]},
      { type: "text", title: "설명", body: "" },
      { type: "files", title: "인증서/등록증", fileIds: [] },
    ],
  },
  {
    name: "목록 (테이블)",
    icon: "📋",
    sections: [
      { type: "table", title: "목록", headers: ["항목", "내용", "비고"], rows: [["", "", ""]] },
    ],
  },
]

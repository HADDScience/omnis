// 지식 카드 분류 — 엄격 모드.
//
// 카드는 이 목록 안에서만 만든다. 어느 분류에도 맞지 않는 지식은 제안 단계에서 버린다.
// 「기타」 같은 열린 분류를 두지 않는 것이 이 방식의 핵심이다 (2026-10-02 작업지시자 결정).
// 분류 없이 자유롭게 뽑는 방식은 이 방식으로 운영 경험이 쌓인 뒤에 검토한다 —
// 그때는 detectKnowledge 에 이 목록 대신 다른 범위를 넘기면 된다.
//
// DB 의 OmnisCategory 행은 마이그레이션 20261002000000_knowledge_categories 가 맞춘다.
// 여기 이름과 DB 이름이 어긋나면 그 분류의 제안은 만들어지지 않는다 (proposeOne).
//
// 배경: mydocs/plans/2026-09-30-record-proposals-and-card-categories.md

export interface KnowledgeCategory {
  name: string
  icon: string
  sortOrder: number
  /** 이 분류에 담는 것 — 추출 프롬프트에 그대로 들어간다 */
  scope: string
}

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  { name: "기업정보", icon: "🏢", sortOrder: 1, scope: "회사 개요, 공식 자료(기업현황카드 등)의 정본 위치, 거래·협업 조건 중 반복 적용되는 것" },
  { name: "인력현황", icon: "👥", sortOrder: 2, scope: "누가 어떤 영역을 맡는지, 직함·역할 분담" },
  { name: "지식재산권", icon: "📜", sortOrder: 3, scope: "상표·특허를 왜 그렇게 정했는지 (이름 결정 경위, 출원 방침). 건별 번호·상태 목록은 담지 않는다" },
  { name: "회사 연혁·실적", icon: "🏆", sortOrder: 4, scope: "주요 실적을 설명하는 서술과 그 맥락. 날짜별 목록은 연혁 표가 정본이라 담지 않는다" },
  { name: "제품·기술", icon: "🧪", sortOrder: 5, scope: "제품·기술 설명, 사양, 실험 프로토콜, 제품명·문구·표기 규칙(패키지 문구, 영문 표기, 로고 사용)" },
  { name: "업무 절차", icon: "🗂️", sortOrder: 6, scope: "반복되는 절차 — 발주·인쇄·견적·승인 순서, 파일을 어디 두는지" },
]

export const KNOWLEDGE_CATEGORY_NAMES = KNOWLEDGE_CATEGORIES.map((c) => c.name)

/** 모델이 돌려준 분류 이름을 목록의 이름으로 맞춘다. 목록에 없으면 null — 그 주제는 버린다 */
export function matchCategory(name: unknown): string | null {
  if (typeof name !== "string") return null
  const n = name.replace(/\s/g, "")
  return KNOWLEDGE_CATEGORY_NAMES.find((c) => c.replace(/\s/g, "") === n) ?? null
}

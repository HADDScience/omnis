/**
 * 홈페이지 문의의 값과 그 한국어 이름.
 *
 * `lib/website-inquiry.ts` 에서 갈라 두었다 — 그쪽은 prisma 를 import 해서 클라이언트
 * 컴포넌트가 못 가져온다. 검토 화면이 필요한 것은 이름표뿐이다.
 */

/**
 * 사이트 `content/ko.ts` 의 `contact.form.topicOptions` 가 원본이다.
 * 여기 없는 값은 접수 단계에서 400 으로 돌려보낸다 — 사이트의 select 가 이미 값을 묶고
 * 있어서, 모르는 값이 온다는 것은 배포 순서가 어긋났다는 뜻이다.
 * **늘릴 때는 Omnis 를 먼저 배포한다.**
 */
export const INQUIRY_TOPICS = {
  sample: "샘플 요청",
  pricing: "견적 문의",
  technical: "기술 문의",
  partnership: "협업 제안",
  etc: "기타",
} as const

export type InquiryTopic = keyof typeof INQUIRY_TOPICS

/** 모르는 값이 들어와 있으면 지어내지 않고 원문을 그대로 보여 준다. */
export function topicLabel(topic: string): string {
  return INQUIRY_TOPICS[topic as InquiryTopic] ?? topic
}

export const INQUIRY_STATUS_LABEL = {
  NEW: "검토 대기",
  ACCEPTED: "승인",
  REJECTED: "반려",
  SPAM: "스팸",
} as const

// ─── 문의를 어떻게 넘길 것인가 ─────────────────────────────

/**
 * 승인할 때 무엇을 만들 것인가.
 *
 * `none` 이 있는 이유: 기술 문의·협업 제안은 견적도 샘플도 아니다. 그런 문의에 억지로
 * 문서를 만들면 빈 견적이 장부에 쌓인다. 기관·담당자만 CRM 에 넣고, 문서는 담당자가
 * 필요할 때 만든다.
 */
export const INQUIRY_OUTCOMES = {
  quote: { label: "견적으로 만들기", done: "견적을 만들었어요. 품목을 채워 주세요." },
  sample: { label: "샘플요청으로 만들기", done: "샘플요청을 만들었어요. 보낼 제품을 골라 주세요." },
  none: { label: "기관·담당자만 등록", done: "기관·담당자를 등록했어요." },
} as const

export type InquiryOutcome = keyof typeof INQUIRY_OUTCOMES

/**
 * 문의 유형이 기본값을 고른다. 사람이 바꿀 수 있다 — 추천이지 강제가 아니다.
 *
 * 기술 문의·협업 제안·기타는 `none` 이다. 무엇이 맞는지 문의만 보고는 알 수 없어서,
 * 모르면 만들지 않는 쪽을 기본으로 둔다.
 */
export const DEFAULT_OUTCOME: Record<string, InquiryOutcome> = {
  sample: "sample",
  pricing: "quote",
  technical: "none",
  partnership: "none",
  etc: "none",
}

export function defaultOutcome(topic: string): InquiryOutcome {
  return DEFAULT_OUTCOME[topic] ?? "none"
}

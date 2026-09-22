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

// 옴니스 계정이 없는 사람의 글 — 카톡 이식 전용(이식 도구: import-tools/rooms-config.ts).
//
// ExternalSpeaker 는 이름 · 소속 · 직급만 가진다. 로그인 · 멘션 · 담당 지정 · 알림 대상이 아니다.
// ChatMessage.authorId 는 필수라 시스템 계정(lib/system-user.ts)을 두고 externalSpeakerId 로 실제 말한 사람을 가리킨다.
// 화면은 author 를 그대로 그리므로, 내려보내기 전에 이 파일이 author 를 바꿔 준다. 그러지 않으면 옴니스 글로 그려진다.
// prisma 없음 — 단위 시험이 DB 없이 돈다.

export interface ExternalSpeakerFields {
  id: string
  name: string
  org: string | null
  title: string | null
}

export const EXTERNAL_SPEAKER_SELECT = { select: { id: true, name: true, org: true, title: true } } as const

/** 화면에 보이는 이름 — 「이름 · 소속 · 직급」. 모르는 칸은 뺀다 */
export function externalSpeakerLabel(s: Pick<ExternalSpeakerFields, "name" | "org" | "title">): string {
  return [s.name, s.org, s.title].map((x) => x?.trim()).filter(Boolean).join(" · ")
}

/** 메시지 작성자. 외부 발화자 글이면 시스템 계정 대신 그 사람으로 — id 는 어떤 User.id 와도 겹치지 않는다 */
export function displayAuthor<A extends { id: string; name: string }>(
  author: A,
  external: ExternalSpeakerFields | null | undefined,
): A | { id: string; name: string } {
  return external ? { id: `external:${external.id}`, name: externalSpeakerLabel(external) } : author
}

/** 업무 스레드를 읽는 쪽 조건 — 카드는 전원이 본다. 외부 발화자 글은 카드에 연결되지 않지만, 연결돼도 내보내지 않는다 */
export const NOT_EXTERNAL_WHERE = { externalSpeakerId: null } as const

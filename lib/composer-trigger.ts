// 입력칸의 자동완성 — 커서 앞 글자를 보고 어떤 목록을 띄울지 정한다. 순수 함수 — 시험: lib/composer-trigger.test.ts
//
// 사람 · 전사 · 업무 방만 부른다. 옴니스 방은 이 함수를 부르지 않는다 — 거기서 친 `/업무` · `@이름` · `#업무` 는 옴니스에게 가는
// 그냥 글이고, 업무 재구성(lib/chat-post.ts)으로 가지 않는다.

export type ComposerTriggerKind = "command" | "task" | "user"

export interface ComposerTrigger {
  kind: ComposerTriggerKind
  query: string
  /** 접두사(/ · # · @)가 놓인 자리 */
  start: number
}

export function composerTrigger(textBeforeCursor: string, options: { commands: boolean }): ComposerTrigger | null {
  // 명령은 맨 앞에서만 — 문장 중간의 "/"는 명령이 아니라 그냥 슬래시다.
  const slash = options.commands ? textBeforeCursor.match(/^\/([^\s]*)$/) : null
  if (slash) return { kind: "command", query: slash[1], start: 0 }
  const hash = textBeforeCursor.match(/#([^\s#@]*)$/)
  if (hash) return { kind: "task", query: hash[1], start: textBeforeCursor.length - hash[0].length }
  const at = textBeforeCursor.match(/@([^\s#@]*)$/)
  if (at) return { kind: "user", query: at[1], start: textBeforeCursor.length - at[0].length }
  return null
}

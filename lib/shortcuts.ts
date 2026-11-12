// 키보드 단축키 — 무엇이 있고 어떤 키를 받아 주는지. 순수 함수 — 시험: lib/shortcuts.test.ts
//
// 키 하나로 동작하던 단축키(D · C)는 글을 잘못 친 손에 화면이 바뀌어 없앴다(2026-11-03 작업지시자). 이제 조합키가 필수다.
// 키는 e.code(자판의 자리)로 잰다 — 한글 입력 중의 ㅊ, 맥 Option 조합의 특수문자도 같은 키로 잡힌다.
// `Mod` 는 맥의 ⌘, 그 밖의 Ctrl 이다.

// ⌘K 검색 창(commandPalette)은 2026-11-06 걷었다 — 저장돼 있던 키는 sanitizeShortcuts 가 버린다
export type ShortcutAction = "panelSearch" | "togglePanel" | "toggleTheme"

export interface ShortcutDefinition {
  id: ShortcutAction
  label: string
  /** 기본 키 */
  combo: string
  /**
   * 입력칸 안에서도 받는가. 글을 쓰다가 바로 찾는 대화 패널 검색만 받는다(규칙: ux-rules 전체 검색).
   * 테마 · 패널은 입력칸에서 동작하지 않는다.
   */
  inInput: boolean
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: "panelSearch", label: "대화 패널에서 전체 검색", combo: "Mod+Shift+KeyF", inInput: true },
  { id: "togglePanel", label: "대화 패널 열기 · 닫기", combo: "Alt+Shift+KeyC", inInput: false },
  { id: "toggleTheme", label: "라이트 · 다크 바꾸기", combo: "Alt+Shift+KeyD", inInput: false },
]

export type ShortcutMap = Record<ShortcutAction, string>

export const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.combo])) as ShortcutMap

/** 눌린 키에서 필요한 것만 — KeyboardEvent 를 그대로 넘길 수 있다 */
export interface KeyLike {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** 눌린 키를 저장 모양(`Mod+Shift+KeyF`)으로. 조합키만 눌렸거나 자리를 모르면 null */
export function comboFromEvent(e: KeyLike): string | null {
  if (!e.code || /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(e.code)) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push("Mod")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  parts.push(e.code)
  return parts.join("+")
}

export function matchesCombo(e: KeyLike, combo: string): boolean {
  return comboFromEvent(e) === combo
}

const ACCEPTED_KEY = /^(Key[A-Z]|Digit[0-9])$/

/** 브라우저 · 운영체제 · 편집이 이미 쓰는 키. 페이지가 가로채지 못하거나, 가로채면 기본 동작이 사라진다 */
const RESERVED: Record<string, string> = {}
const reserve = (prefix: string, keys: string, what: string) => {
  for (const key of keys.split(" ")) {
    RESERVED[`${prefix}+${/^\d$/.test(key) ? `Digit${key}` : `Key${key}`}`] = what
  }
}
reserve("Mod", "A", "전체 선택")
reserve("Mod", "C", "복사")
reserve("Mod", "V", "붙여넣기")
reserve("Mod", "X", "잘라내기")
reserve("Mod", "Z Y", "실행 취소 · 다시 실행")
reserve("Mod+Shift", "Z", "다시 실행")
reserve("Mod+Shift", "V", "서식 없이 붙여넣기")
reserve("Mod", "T N W Q", "탭 · 창 다루기")
reserve("Mod+Shift", "T N W", "탭 · 창 다루기")
reserve("Mod", "R", "새로고침")
reserve("Mod+Shift", "R", "새로고침")
reserve("Mod", "L", "주소창")
reserve("Mod", "D", "북마크")
reserve("Mod+Shift", "D B O", "북마크")
reserve("Mod", "F G", "페이지 찾기")
reserve("Mod+Shift", "G", "페이지 찾기")
reserve("Mod", "P", "인쇄")
reserve("Mod+Shift", "P", "인쇄")
reserve("Mod", "S O E U J H M I", "브라우저 기능")
reserve("Mod+Shift", "A J M Y", "브라우저 기능")
reserve("Mod+Shift", "I C", "개발자 도구")
reserve("Mod+Alt", "I J C U", "개발자 도구")
reserve("Mod", "1 2 3 4 5 6 7 8 9 0", "탭 옮기기")
reserve("Mod+Shift", "3 4 5", "화면 캡처")
reserve("Alt", "D F E", "주소창 · 브라우저 메뉴")
reserve("Alt+Shift", "T B A I N", "브라우저 기능")

/**
 * 이 조합을 쓸 수 있는가. 쓸 수 있으면 null, 없으면 화면에 보일 이유.
 * action 은 바꾸려는 단축키 — 자기 자신과 겹치는 것은 겹침이 아니다.
 */
export function shortcutProblem(combo: string, action: ShortcutAction, current: ShortcutMap): string | null {
  const parts = combo.split("+")
  const key = parts.at(-1) ?? ""
  if (!parts.includes("Mod") && !parts.includes("Alt")) {
    return "⌘(Ctrl) 이나 ⌥(Alt) 를 함께 눌러 주세요. 키 하나 · Shift 만으로는 쓸 수 없습니다"
  }
  if (!ACCEPTED_KEY.test(key)) return "글자나 숫자 키를 함께 눌러 주세요"
  const taken = SHORTCUTS.find((s) => s.id !== action && current[s.id] === combo)
  if (taken) return `「${taken.label}」 이 이미 쓰는 키입니다`
  const reserved = RESERVED[combo]
  if (reserved) return `브라우저 · 시스템 단축키(${reserved})와 겹칩니다`
  return null
}

/**
 * 저장해 둔 값을 믿지 않는다 — 손으로 고쳤거나 옛 규칙으로 저장됐어도 쓸 수 있는 키만 남긴다.
 * 못 쓰는 항목은 기본값으로 돌아가고, 기본값이 다른 항목과 겹치면 그 항목도 기본값으로 돌린다.
 */
export function sanitizeShortcuts(raw: unknown): ShortcutMap {
  const next: ShortcutMap = { ...DEFAULT_SHORTCUTS }
  if (typeof raw !== "object" || raw === null) return next
  const saved = raw as Record<string, unknown>
  for (const { id } of SHORTCUTS) {
    const combo = saved[id]
    if (typeof combo === "string" && shortcutProblem(combo, id, next) === null) next[id] = combo
  }
  // 앞에서 바꾼 키가 뒤 항목의 기본값을 빼앗았으면, 빼앗은 쪽을 되돌린다
  for (const { id, combo } of SHORTCUTS) {
    if (next[id] === combo) continue
    if (SHORTCUTS.some((s) => s.id !== id && next[s.id] === next[id])) next[id] = combo
  }
  return next
}

/** 화면에 보일 글자 — 맥은 ⌘⌥⇧, 그 밖은 Ctrl+Alt+Shift */
export function formatCombo(combo: string, mac: boolean): string {
  const parts = combo.split("+")
  const key = (parts.at(-1) ?? "").replace(/^Key|^Digit/, "")
  const has = (m: string) => parts.includes(m)
  if (mac) return `${has("Mod") ? "⌘" : ""}${has("Alt") ? "⌥" : ""}${has("Shift") ? "⇧" : ""}${key}`
  return [has("Mod") && "Ctrl", has("Alt") && "Alt", has("Shift") && "Shift", key].filter(Boolean).join("+")
}

/**
 * 바꿀 수 없는 키 — 화면마다 정해져 있다. 마이 > 일반의 안내 표가 이 목록을 그대로 보인다(키보드가 있는 기기만).
 * 키를 바꾸거나 새로 만들면 여기도 고친다. 출처는 각 줄의 파일이다.
 */
export interface FixedKey {
  /** 어디서 */
  where: string
  /** 누르는 키 — Mod 는 맥 ⌘, 그 밖의 Ctrl. 함께 누르는 조합이다 */
  keys: string[]
  /** keys 가 조합이 아니라 「둘 중 하나」 다(↑ / ↓) */
  either?: true
  what: string
}

export const FIXED_KEYS: readonly FixedKey[] = [
  // components/chat/room-composer.tsx · lib/enter-to-send.ts — 폰은 Enter 가 줄바꿈
  { where: "채팅 입력창", keys: ["Enter"], what: "보내기" },
  { where: "채팅 입력창", keys: ["Shift", "Enter"], what: "줄바꿈" },
  // components/chat/message-input.tsx handleListKeys — @ 사람 · / 명령 · # 업무 목록
  { where: "@ · / · # 목록", keys: ["↑", "↓"], either: true, what: "항목 고르기" },
  { where: "@ · / · # 목록", keys: ["Enter"], what: "넣기 (Tab 도 같다)" },
  { where: "@ · / · # 목록", keys: ["Esc"], what: "목록 닫기" },
  // components/chat/message-list.tsx — 말풍선 자리에서 고치기
  { where: "내 글 고치기", keys: ["Enter"], what: "저장" },
  { where: "내 글 고치기", keys: ["Esc"], what: "취소" },
  // components/chat/chat-search.tsx
  { where: "대화 검색", keys: ["Enter"], what: "이전 결과" },
  { where: "대화 검색", keys: ["Shift", "Enter"], what: "다음 결과" },
  { where: "대화 검색", keys: ["Esc"], what: "검색 닫기" },
  // components/messenger/room-list.tsx
  { where: "대화 목록", keys: ["Esc"], what: "검색어 지우기" },
  { where: "대화 목록", keys: ["Shift", "F10"], what: "방 메뉴 열기 (메뉴 키도 같다)" },
  // components/photo-viewer/photo-viewer.tsx
  { where: "사진 크게 보기", keys: ["←", "→"], either: true, what: "이전 · 다음 사진" },
  { where: "사진 크게 보기", keys: ["Esc"], what: "닫기" },
  { where: "사진 크게 보기", keys: ["Ctrl", "휠"], what: "확대 · 축소 (트랙패드 두 손가락 벌리기)" },
  // components/ip/progress-form.tsx
  { where: "지식재산권 진행 기록", keys: ["Mod", "Enter"], what: "저장" },
]

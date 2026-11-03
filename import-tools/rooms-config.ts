// 어느 카톡 방을 어떻게 옮기는가 — KAKAO_DATA_DIR/import-config.json. 저장소가 공개라 방 이름 · 사람 이름을 코드에 두지 않는다.
//
// {
//   "rooms": {
//     "<카톡 방 이름>": { "id": "...", "name": "옴니스 방 이름", "kind": "COMPANY" | "GROUP", "members": ["계정 이름"], "sync": true },
//     "<1:1 카톡 방 이름>": { "name": "표시용", "kind": "DM", "dm": ["계정 이름", "계정 이름"] }
//   },
//   "speakers": { "<카톡 표시명>": "계정 이름" },
//   "externals": { "<카톡 표시명>": { "name": "이름", "org": "소속", "title": "직급" } }
// }
//
// structure: 분류 · 구조화 · 카드 연결을 하는가. 기본은 전사방만 true — 업무 카드는 전원이 보므로 참여자 전용 방은 켜지 않는다.
// copiesFrom: 손으로 옮긴 사본을 자기 방 말고 어느 방에서도 찾을지(방 id). 나뉘기 전에 사본이 다른 방에 들어간 방만 쓴다.
// sync: kakao-sync.py 가 --room 없이 돌 때 받는 방.
// prisma 없음 — 단위 시험이 DB 없이 돈다.
import { createHash } from "crypto"
import { existsSync, readFileSync } from "fs"

export type ImportRoomKind = "COMPANY" | "GROUP" | "DM"

export interface ImportRoom {
  /** 옴니스 방 id. DM 은 dmKey 로 찾으므로 없다 */
  id?: string
  name: string
  kind: ImportRoomKind
  /** 단톡방 참여자의 옴니스 정식 이름 */
  members?: string[]
  /** 1:1 두 사람의 옴니스 정식 이름. 둘 다 계정이 있어야 한다 */
  dm?: [string, string]
  structure?: boolean
  copiesFrom?: string[]
  sync?: boolean
}

export interface ExternalDef { name: string; org?: string | null; title?: string | null }

export interface ImportConfig {
  rooms: Record<string, ImportRoom>
  speakers: Record<string, string>
  externals: Record<string, ExternalDef>
}

export const EMPTY_CONFIG: ImportConfig = { rooms: {}, speakers: {}, externals: {} }

export function parseImportConfig(raw: unknown): ImportConfig {
  const c = (raw ?? {}) as Partial<ImportConfig>
  const rooms = c.rooms ?? {}
  const speakers = c.speakers ?? {}
  const externals = c.externals ?? {}
  for (const [key, r] of Object.entries(rooms)) {
    if (!r.name?.trim()) throw new Error(`방 ${key}: name 이 없다`)
    if (!["COMPANY", "GROUP", "DM"].includes(r.kind)) throw new Error(`방 ${key}: kind 는 COMPANY · GROUP · DM`)
    if (r.kind === "DM") {
      if (r.id) throw new Error(`방 ${key}: DM 은 dmKey 로 찾으므로 id 를 주지 않는다`)
      if (r.dm?.length !== 2 || r.dm[0] === r.dm[1]) throw new Error(`방 ${key}: DM 에는 서로 다른 두 사람(dm)이 필요하다`)
      if (r.structure) throw new Error(`방 ${key}: 1:1 은 업무 카드를 만들지 않는다`)
    } else if (!r.id?.trim()) throw new Error(`방 ${key}: id 가 없다`)
    if (r.kind === "COMPANY" && r.members?.length) throw new Error(`방 ${key}: 전사방에는 참여자가 없다`)
    if (r.kind !== "DM" && r.dm) throw new Error(`방 ${key}: dm 은 DM 방에만`)
  }
  for (const [key, e] of Object.entries(externals)) {
    if (!e.name?.trim()) throw new Error(`외부 발화자 ${key}: name 이 없다`)
    if (speakers[key]) throw new Error(`${key}: 계정(speakers)과 외부 발화자(externals)에 함께 있다`)
  }
  return { rooms, speakers, externals }
}

/** 파일이 없으면 빈 설정 — 옮길 방이 없다는 뜻이고, 저장소만 받은 사람도 시험을 돌릴 수 있다 */
export function loadImportConfig(path: string): ImportConfig {
  return existsSync(path) ? parseImportConfig(JSON.parse(readFileSync(path, "utf8"))) : EMPTY_CONFIG
}

export const structureEnabled = (room: ImportRoom) => room.structure ?? room.kind === "COMPANY"

/** 같은 사람이면 같은 id — 이식을 다시 돌려도 행이 늘지 않는다 */
export const externalSpeakerIdOf = (e: ExternalDef) =>
  `ext-${createHash("sha1").update(`${e.name.trim()}|${e.org?.trim() ?? ""}`).digest("hex").slice(0, 16)}`

export const plannedDmRoomId = (dmKey: string) => `kakao-dm-${createHash("sha1").update(dmKey).digest("hex").slice(0, 16)}`

export type SpeakerTarget = { type: "user"; name: string } | { type: "external"; def: ExternalDef } | null

/** 이 줄을 누구 글로 넣는가. 외부 발화자는 전사방에 넣지 않는다 — 전사방 글은 전원이 읽고 색인된다 */
export function speakerTarget(room: ImportRoom, display: string, config: Pick<ImportConfig, "speakers" | "externals">): SpeakerTarget {
  const name = config.speakers[display]
  if (name) return { type: "user", name }
  const def = config.externals[display]
  return def && room.kind !== "COMPANY" ? { type: "external", def } : null
}

/**
 * 이식 파일의 File.privateToUserId — lib/file-access.ts 규칙.
 * 참여자 전용 방의 글이면 작성자. 업무 카드에 연결된 글이어도 같다 — 글은 카드에 보여도 첨부는 그 방 사람만 본다.
 */
export function importedFilePrivateTo(msg: { authorId: string; room: { kind: string } }): string | null {
  return msg.room.kind !== "COMPANY" ? msg.authorId : null
}

/** 사본을 찾을 방 — 기본은 자기 방만. 다른 방의 같은 말과 짝이 맞으면 원본이 빠진다 */
export const copyRoomIds = (roomId: string, room: ImportRoom) => [roomId, ...(room.copiesFrom ?? [])]

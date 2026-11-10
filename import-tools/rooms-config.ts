// 어느 카톡 방을 어떻게 옮기는가 — KAKAO_DATA_DIR/import-config.json. 저장소가 공개라 방 이름 · 사람 이름을 코드에 두지 않는다.
//
// {
//   "rooms": {
//     "<카톡 방 이름>": { "id": "...", "name": "옴니스 방 이름", "kind": "COMPANY" | "GROUP", "members": ["계정 이름"], "sync": true },
//     "<1:1 카톡 방 이름>": { "name": "표시용", "kind": "DM", "dm": ["계정 이름", "계정 이름"] }
//   },
//   "me": "내 계정 이름",
//   "syncFolder": "<카톡 채팅 폴더 이름>",
//   "speakers": { "<카톡 표시명>": "계정 이름" },
//   "externals": { "<카톡 표시명>": { "name": "이름", "org": "소속", "title": "직급" } },
//   "renames": { "<바뀐 카톡 표시명>": "<처음 쓰던 표시명>" }
// }
//
// structure: 분류 · 구조화 · 카드 연결을 하는가. 기본은 전사방만 true — 업무 카드는 전원이 보므로 참여자 전용 방은 켜지 않는다.
// copiesFrom: 손으로 옮긴 사본을 자기 방 말고 어느 방에서도 찾을지(방 id). 나뉘기 전에 사본이 다른 방에 들어간 방만 쓴다.
// sync: syncFolder 가 없을 때 kakao-sync.py 가 --room 없이 받는 방.
// syncFolder: kakao-sync.py 가 실행마다 이 폴더의 방을 전부 옮긴다. 처음 보는 방은 registerRoom 이 설정에 더한다.
// auto: registerRoom 이 관리하는 방 — 새 발화자가 나오면 참여자 · 외부 발화자로 더한다. 없으면 설정을 건드리지 않는다.
// listName: 채팅 목록의 이름이 방 키와 다를 때. 이름 없는 단체방은 CSV 이름이 모두 같아 이것으로 가른다.
// renames: 카톡 표시명이 바뀌었을 때 CSV · 휴대폰 txt 를 읽자마자 처음 이름으로 되돌린다(보낸 사람 · 본문의 멘션 · 초대 줄).
//   메시지 키(sourceId)와 마스터 줄 키에 표시명이 들어가므로, 되돌리지 않으면 이미 넣은 글이 새 글로 다시 들어간다.
//   방 이름이 바뀐 것은 listName 으로 잇는다.
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
  auto?: boolean
  listName?: string
}

export interface ExternalDef { name: string; org?: string | null; title?: string | null }

export interface ImportConfig {
  rooms: Record<string, ImportRoom>
  speakers: Record<string, string>
  externals: Record<string, ExternalDef>
  me?: string
  syncFolder?: string
  /** 바뀐 표시명 → 처음 쓰던 표시명 */
  renames?: Record<string, string>
}

export const EMPTY_CONFIG: ImportConfig = { rooms: {}, speakers: {}, externals: {}, renames: {} }

export function parseImportConfig(raw: unknown): ImportConfig {
  const c = (raw ?? {}) as Partial<ImportConfig>
  const rooms = c.rooms ?? {}
  const speakers = c.speakers ?? {}
  const externals = c.externals ?? {}
  const renames = c.renames ?? {}
  for (const [now, was] of Object.entries(renames)) {
    if (typeof was !== "string" || !now.trim() || !was.trim() || now === was) throw new Error(`renames ${now}: 바뀐 이름과 처음 이름이 둘 다 있고 달라야 한다`)
    if (renames[was] !== undefined) throw new Error(`renames ${now}: 처음 이름 ${was} 가 다시 바뀐 이름으로 있다 — 한 단계로 적는다`)
  }
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
  return { rooms, speakers, externals, me: c.me, syncFolder: c.syncFolder, renames }
}

/**
 * 바뀐 표시명을 처음 이름으로 되돌린다. 보낸 사람은 통째로 같을 때만, 본문은 이름이 나오는 곳 전부(멘션 · 초대 줄).
 * 긴 이름부터 바꿔 한 이름이 다른 이름의 일부일 때도 겹쳐 바뀌지 않게 한다.
 */
export function restoreNames<T extends { u: string; m: string }>(row: T, renames: Record<string, string> = {}): T {
  const pairs = Object.entries(renames).sort((a, b) => b[0].length - a[0].length)
  if (pairs.length === 0) return row
  let m = row.m
  for (const [now, was] of pairs) if (m.includes(now)) m = m.split(now).join(was)
  const u = renames[row.u] ?? row.u
  return u === row.u && m === row.m ? row : { ...row, u, m }
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

export const autoRoomId = (key: string) => `kakao-auto-${createHash("sha1").update(key).digest("hex").slice(0, 16)}`

/** 카톡 표시명 → 계정 이름. 외부 발화자로 정한 사람은 계정으로 보지 않는다. 등록된 매핑 → 이름이 같은 계정 → 첫 낱말이 계정 이름(「이름 직함」). 없으면 null */
export function accountOf(display: string, config: Pick<ImportConfig, "speakers" | "externals">, accounts: string[]): string | null {
  if (config.externals[display]) return null
  const mapped = config.speakers[display]
  if (mapped) return mapped
  if (accounts.includes(display)) return display
  const first = display.trim().split(/\s+/)[0]
  return accounts.includes(first) ? first : null
}

export interface RegisterResult {
  newRoom: boolean
  newExternals: string[]
  newMembers: string[]
}

/**
 * 처음 보는 방을 CSV 발화자로 등록한다. config 를 그 자리에서 고친다.
 * 참여자 전용 — 분류 · 카드를 켜지 않고(structure 없음) 전사방으로 만들지 않는다. 손으로 정한 방(auto 없음)은 건드리지 않는다.
 * 1:1 은 방 이름이 상대 표시명이고 발화자가 나와 그 사람뿐이며 상대 계정이 있을 때만이다 — 틀리면 단톡방 글이 1:1 에 섞인다.
 * 그 밖에는 모두 단톡방이다. 나는 말이 없어도 참여자다.
 */
export function registerRoom(config: ImportConfig, key: string, displays: string[], accounts: string[]): RegisterResult {
  const room = config.rooms[key]
  const out: RegisterResult = { newRoom: false, newExternals: [], newMembers: [] }
  if (room && !room.auto) return out
  if (!config.me) throw new Error("import-config.json 에 me(내 계정 이름)가 없다")
  const me = config.me

  const who = displays.map((display) => ({ display, account: accountOf(display, config, accounts) }))
  for (const { display, account } of who) {
    if (account) {
      if (!config.speakers[display]) config.speakers[display] = account
    } else if (!config.externals[display]) {
      config.externals[display] = { name: display, org: null, title: null }
      out.newExternals.push(display)
    }
  }
  const accountsHere = [...new Set(who.flatMap((w) => (w.account ? [w.account] : [])))]

  if (room) {
    if (room.kind === "GROUP") {
      out.newMembers = accountsHere.filter((a) => !room.members?.includes(a))
      if (out.newMembers.length > 0) room.members = [...(room.members ?? []), ...out.newMembers]
    }
    return out
  }

  out.newRoom = true
  const others = who.filter((w) => w.account !== me)
  const peer = others.length === 1 && others[0].display === key ? others[0].account : null
  if (peer) {
    config.rooms[key] = { name: peer, kind: "DM", dm: [me, peer], auto: true }
    return out
  }
  const members = [...new Set([me, ...accountsHere])]
  // 이름 없는 단체방의 목록 이름은 표시명을 쉼표로 이은 것이다 — 참여자 이름으로 부른다
  const unnamed = key.includes(", ")
  const names = [...members, ...who.filter((w) => !w.account).map((w) => w.display)].sort((a, b) => a.localeCompare(b, "ko"))
  config.rooms[key] = { id: autoRoomId(key), name: unnamed ? names.join(", ") : key, kind: "GROUP", members, auto: true }
  return out
}

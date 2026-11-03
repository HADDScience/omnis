// 0단계(--auto-rooms) — 처음 보는 방을 CSV 발화자로 설정에 더한다. 규칙은 rooms-config.ts registerRoom.
// --dry 면 이번 실행의 설정에만 더하고 파일에 쓰지 않는다.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "fs"
import { DATA_DIR, IMPORT_CONFIG, parseKakaoCsv, prisma } from "../kakao-common"
import { registerRoom, type RegisterResult } from "../rooms-config"
import { SYSTEM_USER_ID } from "../../lib/system-user"

export async function registerAutoRooms(csvPaths: string[], opts: { dry: boolean }): Promise<(RegisterResult & { room: string })[]> {
  const accounts = (await prisma.user.findMany({ where: { id: { not: SYSTEM_USER_ID } }, select: { name: true } })).map((u) => u.name)
  const out: (RegisterResult & { room: string })[] = []
  for (const path of csvPaths) {
    const rows = parseKakaoCsv(path)
    const room = rows[0]?.room
    if (!room) continue
    const result = registerRoom(IMPORT_CONFIG, room, [...new Set(rows.map((r) => r.u))], accounts)
    out.push({ room, ...result })
    if (result.newRoom) {
      const r = IMPORT_CONFIG.rooms[room]
      console.log(`  새 방 등록: ${room} → ${r.kind} · 참여자 ${(r.members ?? r.dm ?? []).join(", ")}`)
    }
    if (result.newMembers.length) console.log(`  ${room}: 참여자 추가 ${result.newMembers.join(", ")}`)
    if (result.newExternals.length) console.log(`  ${room}: 새 외부 발화자 ${result.newExternals.join(", ")} (소속 · 직급 빈칸)`)
  }
  const changed = out.some((r) => r.newRoom || r.newExternals.length || r.newMembers.length)
  if (changed && !opts.dry) saveConfig()
  return out
}

/** 쓰다 끊겨도 설정이 깨지지 않게 바꿔치기한다. 도구가 모르는 칸은 그대로 둔다 */
function saveConfig() {
  const path = `${DATA_DIR}/import-config.json`
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  const { rooms, speakers, externals } = IMPORT_CONFIG
  writeFileSync(`${path}.tmp`, JSON.stringify({ ...raw, rooms, speakers, externals }, null, 2), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  chmodSync(path, 0o600)
}

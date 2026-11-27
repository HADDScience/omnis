/**
 * 공고 첨부 상태 들이기 — 수집기가 원문에서 확인한 첨부 있음 · 없음 · 확인 불가(omnis_keys.json)와
 * 받은 첨부를 읽었는지(SQLite attachments)를 GrantNotice.attStatus · attCheckedAt · attNote · attFiles 에 적는다.
 * 근거: ~/work/omnis-reports/gov-grants/attachments-full-261127.md
 *
 *   pnpm tsx scripts/import-grant-attachment-status.ts [--data ~/work/gov-grants-data]
 *        [--keys <omnis_keys.json>] [--dry] [--prod]
 *
 * 멱등: 같은 입력이면 같은 값을 다시 쓴다. 모델을 부르지 않는다. 운영 DB 는 --prod 가 있어야 쓴다(승인 뒤).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { prisma } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import { isAttStatus, reasonOf, summarizeAtt } from "@/lib/grant-attachments"
import { defaultDataDir, openCollector } from "./_collector"

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const dataDir = (opt("data") ?? defaultDataDir()).replace(/^~/, os.homedir())
const keysFile = (opt("keys") ?? path.join(dataDir, "attachments-verify-261127/omnis_keys.json")).replace(/^~/, os.homedir())
const dry = flag("dry")

const host = new URL(process.env.DATABASE_URL ?? "postgres://x@localhost/x").hostname
console.log(`대상 DB: ${host}${dry ? " (저장 안 함)" : ""} · 수집기: ${dataDir}`)
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !flag("prod")) {
  console.error("로컬 DB 가 아니다 — 운영에 쓰려면 승인 뒤 --prod 를 붙인다. 멈춤.")
  process.exit(1)
}

type KeyItem = { status: string; checked_at: string | null; members: { notice_id: number; status: string; note: string | null }[] }
const items = (JSON.parse(fs.readFileSync(keysFile, "utf8")) as { items: Record<string, KeyItem> }).items
const collector = openCollector(dataDir)

const notices = await prisma.grantNotice.findMany({ select: { id: true, externalKey: true } })
const tally = { present: 0, none: 0, unknown: 0, missing: 0, unreadableNotices: 0, files: 0, unreadFiles: 0 }
const writes: Prisma.PrismaPromise<unknown>[] = []
for (const n of notices) {
  const it = items[n.externalKey]
  if (!it || !isAttStatus(it.status)) {
    tally.missing++
    continue
  }
  tally[it.status]++
  const ids = it.members?.length ? it.members.map((m) => m.notice_id) : collector.memberIds(n.externalKey)
  const files =
    it.status === "present"
      ? summarizeAtt(collector.attachmentRows(ids).map((r) => ({ name: r.name, reason: reasonOf(r) })))
      : { total: 0, items: [] }
  tally.files += files.total
  tally.unreadFiles += files.items.length
  if (files.items.length) tally.unreadableNotices++
  // 「없음」 근거 · 「확인 불가」 이유 — 구성 공고의 note 를 겹치지 않게 잇는다
  const note =
    it.status === "present" ? null : [...new Set(it.members.filter((m) => m.status === it.status && m.note).map((m) => m.note!))].join(" · ") || null
  if (!dry)
    writes.push(
      prisma.grantNotice.update({
        where: { id: n.id },
        data: {
          attStatus: it.status,
          attCheckedAt: it.checked_at ? new Date(it.checked_at) : null,
          attNote: note?.slice(0, 500) ?? null,
          attFiles: files as unknown as Prisma.InputJsonValue,
        },
      })
    )
}
// 50건씩 나눠 보낸다 — 대화형 트랜잭션 5초 함정을 피해 배치 트랜잭션으로
for (let i = 0; i < writes.length; i += 50) await prisma.$transaction(writes.slice(i, i + 50))
console.log(
  `끝 — 공고 ${notices.length} · 있음 ${tally.present} · 없음 ${tally.none} · 확인 불가 ${tally.unknown} · 상태 파일에 없음 ${tally.missing}` +
    ` · 첨부 ${tally.files}개 중 다 읽지 못한 것 ${tally.unreadFiles}개(공고 ${tally.unreadableNotices}건)${dry ? " · 저장 안 함" : ` · 적음 ${writes.length}`}`
)
collector.close()
await prisma.$disconnect()

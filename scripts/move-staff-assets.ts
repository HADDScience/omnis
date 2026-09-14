/**
 * 서명 · 직인을 첨부파일 폴더(files/staff/…)에서 권한이 좁은 폴더(08. 개인정보/옴니스 서명·직인)로 옮긴다.
 *
 *   npx tsx scripts/move-staff-assets.ts           # dry-run: 옮길 것만 보여 준다
 *   npx tsx scripts/move-staff-assets.ts --apply   # 옮긴다
 *
 * 한 장씩: 예전 파일 읽기 → 새 폴더에 쓰기 → 새 파일을 다시 읽어 md5 대조 → DB 키 바꾸기 → 예전 파일 지우기.
 * 대조가 틀리면 그 장에서 멈춘다(DB 는 예전 키 그대로). 앱은 두 키를 모두 읽으므로 옮기는 중에도 복사가 된다.
 * 다 옮긴 뒤 비어 버린 staff/<id> · staff 폴더만 지운다.
 *
 * 운영에 돌릴 때는 DATABASE_URL · SYNOLOGY_WEBDAV_BASE_PATH(운영 files) 를 운영으로 덮는다.
 * 대상 폴더는 SYNOLOGY_STAFF_ASSETS_PATH, 없으면 lib/staff-assets 의 운영 경로.
 */
import "dotenv/config"
import { createHash } from "crypto"
import { Readable } from "stream"
import { prisma } from "@/lib/db"
import { dav, davUrl, deleteObject, getObject } from "@/lib/storage"
import { getStaffAsset, isLegacyStaffKey, putStaffAsset, sniffImage, staffAssetKey, staffAssetRoot } from "@/lib/staff-assets"

const APPLY = process.argv.includes("--apply")
const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex")

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of body) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

async function childCount(absolutePath: string): Promise<number | null> {
  const res = await dav("PROPFIND", davUrl(absolutePath), undefined, undefined, { Depth: "1" })
  const body = (await readAll(res.body)).toString("utf8")
  if (res.status === 404) return null
  return Math.max(0, (body.match(/<(?:[a-zA-Z]+:)?response[\s>]/g) ?? []).length - 1)
}

async function main() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() db`)[0].db
  const filesBase = (process.env.SYNOLOGY_WEBDAV_BASE_PATH ?? "").replace(/\/+$/, "")
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} · DB ${db} · 예전 폴더 ${filesBase}/staff · 새 폴더 ${staffAssetRoot()}`)

  const legacy = await prisma.staffAsset.findMany({
    where: { objectKey: { startsWith: "staff/" } },
    select: { id: true, staffId: true, kind: true, objectKey: true, size: true, staff: { select: { name: true } } },
  })
  console.log(`옮길 것 ${legacy.length}장`)
  if (!APPLY) {
    for (const a of legacy) console.log(`  ${a.staff.name} ${a.kind} ${a.objectKey} (${a.size}B)`)
    return
  }

  const emptiedDirs = new Set<string>()
  for (const a of legacy) {
    const buf = await readAll((await getObject(a.objectKey)).body)
    const image = sniffImage(buf)
    if (!image) throw new Error(`이미지가 아니다 — 멈춤: ${a.objectKey}`)
    const key = staffAssetKey(a.staffId, a.kind, buf, image.ext)
    await putStaffAsset(key, buf, image.mimeType)
    const check = await readAll((await getStaffAsset(key)).body)
    if (md5(check) !== md5(buf)) throw new Error(`새 파일 대조 실패 — 멈춤(DB 는 예전 키): ${a.staff.name} ${key}`)
    await prisma.staffAsset.update({ where: { id: a.id }, data: { objectKey: key, mimeType: image.mimeType } })
    await deleteObject(a.objectKey)
    emptiedDirs.add(a.objectKey.split("/").slice(0, -1).join("/"))
    console.log(`  ✓ ${a.staff.name} ${a.kind} → ${key} (md5 일치 · 예전 파일 삭제)`)
  }

  for (const dir of [...emptiedDirs, "staff"]) {
    const n = await childCount(`${filesBase}/${dir}`)
    if (n === 0) {
      const res = await dav("DELETE", davUrl(`${filesBase}/${dir}`))
      res.body.resume()
      console.log(`  빈 폴더 삭제 ${dir} → HTTP ${res.status}`)
    } else if (n !== null) console.log(`  폴더 남김 ${dir} (안에 ${n}개)`)
  }

  const left = await prisma.staffAsset.count({ where: { objectKey: { startsWith: "staff/" } } })
  const all = await prisma.staffAsset.findMany({ select: { objectKey: true } })
  console.log(`끝 · 예전 키 남은 행 ${left} · 새 폴더 행 ${all.filter((x) => !isLegacyStaffKey(x.objectKey)).length}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

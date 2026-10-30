// 로컬 DB에서만 실행. 사진 실물·외부 모델·임베딩 API 없이 범위와 재실행을 확인한다.
import "dotenv/config"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const url = new URL(process.env.DATABASE_URL!)
if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("로컬 DB만 허용")
console.log(`대상: ${url.hostname}:${url.port}${url.pathname}`)
const { prisma, ROOMS, messageSourceId } = await import("../import-tools/kakao-common")
const { prisma: appDb } = await import("../lib/db")
const { describeImportedPhotos } = await import("../import-tools/steps/photos")
const { savePhotoDescription } = await import("../lib/photo-describe")
const dir = mkdtempSync(join(tmpdir(), "photo-import-test-"))
const roomIds: string[] = [], messageIds: string[] = [], fileIds: string[] = []
try {
  const user = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })
  for (const kind of ["COMPANY", "DM"] as const) {
    roomIds.push((await prisma.chatRoom.create({ data: { name: "사진 이식 검증", kind, createdById: user.id } })).id)
  }
  const room = Object.keys(ROOMS)[0]
  const rows = Array.from({ length: 5 }, (_, i) => ({ t: `2026-10-30 10:00:0${i}`, u: "검증", m: `${dir}-${i}` }))
  const csv = join(dir, `KakaoTalk_Chat_${room}_2026-10-30-10-00-00.csv`)
  writeFileSync(csv, "Date,User,Message\n" + rows.slice(0, 4).map((m) => `${m.t},${m.u},${m.m}`).join("\n"))
  for (let i = 0; i < rows.length; i++) {
    const m = await prisma.chatMessage.create({ data: {
      roomId: roomIds[i === 1 ? 1 : 0], authorId: user.id, content: "Photo",
      sourceId: messageSourceId(room, rows[i]), ...(i === 2 ? { deletedAt: new Date() } : {}),
    } })
    messageIds.push(m.id)
    fileIds.push((await prisma.file.create({ data: { messageId: m.id, name: "fixture.png", path: "/fixture", size: 1, mimeType: i === 3 ? "application/pdf" : "image/png" } })).id)
  }
  const selected = await describeImportedPhotos([csv], { dry: true, workers: 3 })
  assert.deepEqual(selected, [fileIds[0]])
  assert.equal(await prisma.file.count({ where: { id: { in: fileIds }, describedAt: { not: null } } }), 0)
  console.log("✓ dry: 이번 CSV 전사방 사진만 선택 · DM/삭제/비사진/다른 CSV 제외 · 저장 없음")

  assert.equal(await savePhotoDescription(fileIds[0], "invalid", "test", undefined, { embed: false }), false)
  assert.equal((await prisma.file.findUniqueOrThrow({ where: { id: fileIds[0] } })).describedAt, null)
  const text = JSON.stringify({ 종류: "기타", 설명: "시험용 사진", 사진속글자: "", 업무: "", 검색어: ["검증"] })
  assert.equal(await savePhotoDescription(fileIds[0], text, "test", undefined, { embed: false }), true)
  assert.equal(await prisma.embeddingChunk.count({ where: { source: "PHOTO", sourceId: fileIds[0] } }), 0)
  console.log("✓ 잘못된 JSON 저장 거부 · 설명 저장 시 임베딩 생략")

  assert.deepEqual(await describeImportedPhotos([csv], { dry: false, workers: 3 }), [fileIds[0]])
  assert.equal(await prisma.file.count({ where: { id: { in: fileIds.slice(1) }, describedAt: { not: null } } }), 0)
  console.log("✓ 재실행: 설명 완료 사진은 NAS/Claude 호출 없이 건너뛰고 색인 대상 ID를 유지")
} finally {
  await prisma.file.deleteMany({ where: { id: { in: fileIds } } })
  await prisma.chatMessage.deleteMany({ where: { id: { in: messageIds } } })
  await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } })
  await prisma.$disconnect()
  await appDb.$disconnect()
  rmSync(dir, { recursive: true, force: true })
}

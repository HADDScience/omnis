import assert from "node:assert/strict"
import { test } from "node:test"
import { copyRoomIds, externalSpeakerIdOf, importedFilePrivateTo, parseImportConfig, speakerTarget, structureEnabled } from "../import-tools/rooms-config"
import { canSeeFile } from "./file-access"

const cfg = { speakers: { "직원A 표시명": "직원A" }, externals: { "외부B 표시명": { name: "외부B", org: "예시기관", title: "연구원" } } }
const group = { id: "r1", name: "방", kind: "GROUP" as const, members: ["직원A"] }
const company = { id: "r2", name: "전사", kind: "COMPANY" as const }

test("참여자 전용 방은 기본으로 업무 카드를 만들지 않는다", () => {
  assert.equal(structureEnabled(group), false)
  assert.equal(structureEnabled({ name: "1:1", kind: "DM", dm: ["a", "b"] }), false)
  assert.equal(structureEnabled(company), true)
  assert.equal(structureEnabled({ ...group, structure: true }), true)
})

test("외부 발화자는 참여자 전용 방에만 들어간다", () => {
  assert.deepEqual(speakerTarget(group, "외부B 표시명", cfg), { type: "external", def: cfg.externals["외부B 표시명"] })
  assert.equal(speakerTarget(company, "외부B 표시명", cfg), null)
  assert.deepEqual(speakerTarget(company, "직원A 표시명", cfg), { type: "user", name: "직원A" })
  assert.equal(speakerTarget(group, "모르는 사람", cfg), null)
})

test("외부 발화자 id 는 다시 돌려도 같고 사람마다 다르다", () => {
  const a = externalSpeakerIdOf({ name: "외부B", org: "예시기관" })
  assert.equal(a, externalSpeakerIdOf({ name: " 외부B ", org: "예시기관 ", title: "직급이 바뀌어도" }))
  assert.notEqual(a, externalSpeakerIdOf({ name: "외부B", org: "다른 기관" }))
})

test("잘못된 설정은 거부한다", () => {
  const bad = (rooms: unknown, rest = {}) => () => parseImportConfig({ rooms, ...rest })
  assert.throws(bad({ a: { name: "x", kind: "GROUP" } }), /id/)
  assert.throws(bad({ a: { id: "x", name: "x", kind: "TASK" } }), /kind/)
  assert.throws(bad({ a: { name: "x", kind: "DM", dm: ["같음", "같음"] } }), /두 사람/)
  assert.throws(bad({ a: { id: "i", name: "x", kind: "DM", dm: ["a", "b"] } }), /dmKey/)
  assert.throws(bad({ a: { name: "x", kind: "DM", dm: ["a", "b"], structure: true } }), /카드/)
  assert.throws(bad({ a: { id: "i", name: "x", kind: "COMPANY", members: ["a"] } }), /참여자/)
  assert.throws(bad({}, { speakers: { 갑: "갑" }, externals: { 갑: { name: "갑" } } }), /함께/)
  assert.throws(bad({}, { externals: { 갑: {} } }), /name/)
})

test("이식 파일 — 참여자 전용 방 글이면 비참여자가 못 본다", () => {
  const msg = { authorId: "system", taskId: null, room: { kind: "GROUP" } }
  const row = { privateToUserId: importedFilePrivateTo(msg), messageId: "m", roomMemberIds: ["u1"] }
  assert.equal(canSeeFile(row, "u1"), true)
  assert.equal(canSeeFile(row, "u2"), false)
})

test("이식 파일 — 전사방 · 카드에 연결된 글의 파일은 공개", () => {
  assert.equal(importedFilePrivateTo({ authorId: "u", taskId: null, room: { kind: "COMPANY" } }), null)
  assert.equal(importedFilePrivateTo({ authorId: "u", taskId: "t", room: { kind: "GROUP" } }), null)
})

test("사본은 자기 방에서만 찾고, 지정한 방만 더한다", () => {
  assert.deepEqual(copyRoomIds("r1", group), ["r1"])
  assert.deepEqual(copyRoomIds("r1", { ...group, copiesFrom: ["r2"] }), ["r1", "r2"])
})

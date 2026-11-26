/** 공고별 면접 정보 — 칸 규칙 · 보이는 글 · 충돌 확인 · 도구 글 풀기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { JobMetaPatchSchema } from "@/lib/schemas/hr-job"
import { emptyMeta, metaLines, parseSlotText, readSlots, slotLabel, staleMetaFields, type JobMeta } from "./job-meta"

const meta = (over: Partial<JobMeta> = {}): JobMeta => ({ ...emptyMeta("fake-job-2099"), ...over })

test("칸 규칙 — 받는 것", () => {
  const r = JobMetaPatchSchema.parse({
    slots: [{ date: "2099-01-05", time: "11:00", minutesEach: 10 }, { date: "2099-01-06", time: "09:30" }],
    place: "  가상시 시험로 1  ",
    mode: "VIDEO",
    videoUrl: "https://meet.example.invalid/abc",
    memo: "",
  })
  assert.equal(r.place, "가상시 시험로 1")
  assert.equal(r.memo, null)
  assert.equal(r.slots?.length, 2)
  // 빈 글 · null 은 지운다
  assert.deepEqual(JobMetaPatchSchema.parse({ mode: "", videoUrl: null }), { mode: null, videoUrl: null })
})

test("칸 규칙 — 거부되어야 하는 것", () => {
  for (const bad of [
    { slots: [{ date: "2099-02-30", time: "11:00" }] }, // 없는 날짜
    { slots: [{ date: "2099-01-05", time: "25:00" }] }, // 없는 시각
    { slots: [{ date: "2099-01-05", time: "11:00", minutesEach: 0 }] },
    { slots: [{ date: "2099-01-05", time: "11:00", minutesEach: 1.5 }] },
    { mode: "PHONE" },
    { videoUrl: "http://meet.example.invalid" }, // https 만
    { videoUrl: "javascript:alert(1)" },
    { place: "가".repeat(301) },
    { unknown: "x" }, // 모르는 칸
  ]) {
    assert.equal(JobMetaPatchSchema.safeParse(bad).success, false, JSON.stringify(bad))
  }
})

test("보이는 글 — 요일 · 한 사람 시간, 빈 칸은 줄째 뺀다", () => {
  assert.equal(slotLabel({ date: "2026-12-01", time: "11:00", minutesEach: 10 }), "2026-12-01(화) 11:00 · 10분씩")
  assert.deepEqual(metaLines(null), [])
  assert.deepEqual(metaLines(meta()), [])
  assert.deepEqual(metaLines(meta({ place: "시험센터", mode: "IN_PERSON" })), [
    { label: "면접 장소", value: "시험센터" },
    { label: "면접 방식", value: "대면" },
  ])
  assert.deepEqual(metaLines(meta({ mode: "VIDEO", videoUrl: "https://meet.example.invalid/x" }))[0], { label: "면접 방식", value: "화상 · https://meet.example.invalid/x" })
})

test("DB JSON — 모양이 틀린 줄은 버리고 날짜순으로", () => {
  assert.deepEqual(
    readSlots([{ date: "2099-01-06", time: "09:00" }, { nope: 1 }, { date: "2099-01-05", time: "11:00" }]).map((s) => s.date),
    ["2099-01-05", "2099-01-06"],
  )
  assert.deepEqual(readSlots("x"), [])
})

test("충돌 확인 — 본 값과 지금 값이 다른 칸만, expect 가 없으면 없음", () => {
  const now = meta({ place: "A", slots: [{ date: "2099-01-05", time: "11:00" }] })
  assert.deepEqual(staleMetaFields(undefined, now), [])
  assert.deepEqual(staleMetaFields({ place: " A " }, now), [])
  assert.deepEqual(staleMetaFields({ place: "B" }, now), ["place"])
  assert.deepEqual(staleMetaFields({ slots: [{ date: "2099-01-05", time: "11:00" }] }, now), [])
  assert.deepEqual(staleMetaFields({ slots: [] }, now), ["slots"])
  assert.deepEqual(staleMetaFields({ memo: "" }, now), [])
})

test("도구 글 풀기 — 일시 · 한 사람 시간, 틀리면 이유", () => {
  assert.deepEqual(parseSlotText("2099-01-05 11:00"), { slot: { date: "2099-01-05", time: "11:00" } })
  assert.deepEqual(parseSlotText("2099-01-05 9:30 10분씩"), { slot: { date: "2099-01-05", time: "09:30", minutesEach: 10 } })
  assert.ok("error" in parseSlotText("12월 1일 11시"))
  assert.ok("error" in parseSlotText("2099-13-01 11:00"))
})

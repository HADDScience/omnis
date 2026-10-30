/** 옴니스 답의 사진 묶음. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"

import { albumPhotos, albumRows, citedNumbers } from "./photo-album"

test("줄 나누기 — 3장 줄을 기본으로, 1장만 남는 줄은 만들지 않는다", () => {
  assert.deepEqual(albumRows(0), [])
  assert.deepEqual(albumRows(1), [1])
  assert.deepEqual(albumRows(2), [2])
  assert.deepEqual(albumRows(3), [3])
  assert.deepEqual(albumRows(4), [2, 2])
  assert.deepEqual(albumRows(5), [3, 2])
  assert.deepEqual(albumRows(6), [3, 3])
  assert.deepEqual(albumRows(7), [3, 2, 2])
  assert.deepEqual(albumRows(8), [3, 3, 2])
  assert.deepEqual(albumRows(10), [3, 3, 2, 2])
  for (let n = 1; n <= 30; n++) {
    const rows = albumRows(n)
    assert.equal(rows.reduce((a, b) => a + b, 0), n)
    if (n > 1) assert.ok(rows.every((r) => r >= 2), `${n}장에 1장 줄`)
  }
})

test("각주 번호 — 묶음 · 범위를 펼치고, 범위 밖 괄호는 버린다", () => {
  assert.deepEqual([...citedNumbers("부스 사진입니다 [1, 3-5]. 근거 [7]", 8)].sort(), [1, 3, 4, 5, 7])
  assert.deepEqual([...citedNumbers("2024-2025 [2024-2025] 기간 [9]", 8)], [])
})

test("묶음 사진 — 답이 가리킨 사진만, 출처 순서대로", () => {
  const sources = [
    { id: "a", source: "PHOTO" },
    { id: "b", source: "TASK" },
    { id: "c", source: "PHOTO" },
    { id: "d", source: "PHOTO" },
  ]
  const got = albumPhotos("행사 부스 사진입니다 [4, 1, 2]", sources)
  assert.deepEqual(got.map((g) => [g.photo.id, g.num]), [["a", 1], ["d", 4]])
  assert.deepEqual(albumPhotos("관련 내용을 찾지 못했습니다.", sources), [])
})

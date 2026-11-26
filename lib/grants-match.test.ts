/** 국가과제 ↔ NAS 폴더 이름 맞추기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  confidentFolder,
  grantNameSimilarity,
  normalizeGrantName,
  rankFolders,
} from "./grants-match"

const folders = [
  "탈락_참_(260306) 26 중소기업 연구인력지원사업",
  "불참_(260814) 2026년 IP(지식재산) 디딤돌 프로그램 창업자 후속지원 대상자 모집공고",
  "탈락_참_(260403) 2026년 바이오헬스산업 기술평가-사업화연계 지원사업",
  "(261015) 2026 광교 바이오허브 랩 스테이션 특화 프로그램 지원(2기) 추가",
  "참_(260917) 모두의 창업",
  "불참_(260515)_모두의 창업",
].map((name) => ({ name, path: `/HADD Science/(2026) 예비 지원과제/${name}` }))

test("이름 다듬기 — 진행 표시 · 날짜 · 연도 · 기호를 뗀다", () => {
  assert.equal(
    normalizeGrantName("탈락_참_(260306) 26 중소기업 연구인력지원사업"),
    "중소기업연구인력지원사업"
  )
  assert.equal(
    normalizeGrantName("2026년 바이오헬스산업 기술평가-사업화연계 지원사업"),
    "바이오헬스산업기술평가사업화연계지원사업"
  )
})

test("같은 사업은 높게, 다른 사업은 낮게", () => {
  assert.ok(
    grantNameSimilarity(
      "2026년 바이오헬스산업 기술평가-사업화연계 지원사업",
      folders[2].name
    ) > 0.9
  )
  assert.ok(
    grantNameSimilarity(
      "2026년 광교 바이오허브 랩 스테이션 특화 프로그램",
      folders[3].name
    ) > 0.6
  )
  assert.ok(
    grantNameSimilarity(
      "2026년 바이오헬스산업 기술평가-사업화연계 지원사업",
      folders[0].name
    ) < 0.5
  )
})

test("자동 연결 — 확실할 때만, 같은 이름 둘이면 비운다", () => {
  const r = rankFolders("중소기업 연구인력지원 - 신진채용", folders, [
    "2026년 중소기업 연구인력지원사업 공고",
  ])
  assert.equal(confidentFolder(r)?.name, folders[0].name)
  // 모두의 창업 폴더가 둘(참 · 불참) — 어느 쪽인지 사람이 고른다
  assert.equal(confidentFolder(rankFolders("모두의 창업", folders)), null)
  assert.equal(
    confidentFolder(rankFolders("ESG지원 (화성상공회의소)", folders)),
    null
  )
})

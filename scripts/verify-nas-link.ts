/**
 * NAS 파일 연결 · 오류 이슈 검증 (2026-09-17)
 *
 *   BASE=http://localhost:3002 npx tsx --env-file=.env scripts/verify-nas-link.ts
 *
 * [1] 경로 다듬기 — 받아야 할 모양과 거부해야 할 모양
 * [2] 공개 이슈에 사람 이름·파일명·NAS 경로가 새지 않는가, 같은 오류가 같은 지문인가
 * [3] GitHub 이슈 — 없으면 열고, 열린 게 있으면 댓글 (fetch 를 가로채 실제 저장소에는 쓰지 않는다)
 * [4] 실제 NAS — 파일 정보 · 폴더/없는 파일 거부 · 연결 파일을 끝까지 읽기
 * [5] HTTP (BASE 가 떠 있을 때) — 연결 → 메시지에 붙이기 → 거부 경로 → 오류 보고
 *
 * NAS 는 읽기만 한다. 만든 사용자 · 파일 행 · 메시지는 끝나면 지운다.
 */
import { hashSync } from "bcryptjs"
import { prisma } from "../lib/db"
import { normalizeNasPath, statNasFile, listDirectory } from "../lib/nas"
import { nasLinkPath, nasPathOf } from "../lib/file-source"
import { openFileObject } from "../lib/file-object"
import { fileIssue, issueFingerprint, redactForPublic } from "../lib/github-issue"

const BASE = process.env.BASE ?? "http://localhost:3002"
const PW = "nas-link-test-only"
const DIR = "/HADD Science/99. 각종 발표 자료s/0. 회사 홍보 자료_외부 배포용/회사홍보자료 배너&포스터"
const SMALL = `${DIR}/260916_G-SUMMIT 족자_3.pdf` // 6.4MB — 업로드로는 막히던 파일
const BIG = `${DIR}/260916_G-SUMMIT 족자.ai` // 194MB

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function login(name: string, password: string): Promise<string[]> {
  const jar: string[] = []
  const take = (h: Headers) => { for (const c of h.getSetCookie?.() ?? []) jar.push(c.split(";")[0]) }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); take(csrfRes.headers)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken, name, password, callbackUrl: `${BASE}/dashboard` }), redirect: "manual",
  }); take(res.headers)
  return jar
}

async function main() {
  console.log("\n[1] 경로 다듬기")
  check("윈도우 드라이브", normalizeNasPath("Z:\\HADD Science\\a\\b.pdf") === "/HADD Science/a/b.pdf")
  check("맥 /Volumes", normalizeNasPath("/Volumes/HADD Science/a/b.pdf") === "/HADD Science/a/b.pdf")
  check("맥 ~/NAS", normalizeNasPath("~/NAS/HADD Science/a/b.pdf") === "/HADD Science/a/b.pdf")
  check("맥 /Users/이름/NAS", normalizeNasPath("/Users/jeong-uchang/NAS/HADD Science/a/b.pdf") === "/HADD Science/a/b.pdf")
  check("거부: .. 로 탈출", normalizeNasPath("/HADD Science/../etc/passwd") === null)
  check("거부: 마운트 경로 안의 ..", normalizeNasPath("/Volumes/HADD Science/../x") === null)
  check("거부: 다른 공유폴더", normalizeNasPath("/homes/admin/a.pdf") === null)
  check("거부: 다른 공유폴더 안의 같은 이름 폴더", normalizeNasPath("/homes/HADD Science/a.pdf") === null)
  check("거부: 공유폴더 없는 마운트", normalizeNasPath("/Volumes/Other/a.pdf") === null)
  const link = nasLinkPath(SMALL)
  check("링크 path 왕복", nasPathOf(link) === SMALL, link)
  check("올린 파일 path 는 NAS 가 아니다", nasPathOf("/api/files/abc/raw") === null)

  console.log("\n[2] 공개 이슈 다듬기 · 지문")
  const a = "「족자_3.pdf」 을 올리지 못했습니다"
  const b = "「주간보고.hwp」 을 올리지 못했습니다"
  check("파일명이 빠진다", !redactForPublic(a).includes("족자"), redactForPublic(a))
  check("다른 파일, 같은 오류 → 같은 지문", issueFingerprint("upload_failed", redactForPublic(a), "500") === issueFingerprint("upload_failed", redactForPublic(b), "500"))
  check("다른 상태 → 다른 지문", issueFingerprint("upload_failed", redactForPublic(a), "500") !== issueFingerprint("upload_failed", redactForPublic(a), "413"))
  const nasErr = `NAS 에서 파일을 찾지 못했습니다 — ${SMALL}`
  check("NAS 경로 · 설명 꼬리가 빠진다", redactForPublic(nasErr) === "NAS 에서 파일을 찾지 못했습니다", redactForPublic(nasErr))
  check("UUID 가 :id 로", redactForPublic("/tasks/46091728-1a69-4fa8-9fb8-0a6056e7cc0d") === "/tasks/:id")

  console.log("\n[3] GitHub 이슈 (fetch 가로채기)")
  const realFetch = globalThis.fetch
  const calls: { method: string; url: string; body?: string }[] = []
  let openIssues: { number: number; html_url: string; body: string }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined })
    if (url.includes("/issues?state=open")) return new Response(JSON.stringify(openIssues), { status: 200 })
    if (url.endsWith("/comments")) return new Response("{}", { status: 201 })
    return new Response(JSON.stringify({ html_url: "https://github.com/x/y/issues/9" }), { status: 201 })
  }) as typeof fetch
  process.env.GITHUB_ISSUE_TOKEN = "test"
  try {
    const opened = await fileIssue({ fingerprint: "abc123", title: "t", body: "b", comment: "c" })
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"))
    check("열린 이슈가 없으면 새로 연다", opened.filed === "opened" && !!create)
    check("새 이슈 본문에 표식", !!create?.body?.includes("<!-- omnis-auto:abc123 -->"))
    calls.length = 0
    openIssues = [{ number: 7, html_url: "https://github.com/x/y/issues/7", body: "<!-- omnis-auto:abc123 -->\nb" }]
    const commented = await fileIssue({ fingerprint: "abc123", title: "t", body: "b", comment: "c" })
    check("열린 이슈가 있으면 댓글", commented.filed === "commented" && calls.some((c) => c.url.endsWith("/issues/7/comments")))
    check("댓글일 때 새 이슈를 열지 않는다", !calls.some((c) => c.method === "POST" && c.url.endsWith("/issues")))
    delete process.env.GITHUB_ISSUE_TOKEN
    const skipped = await fileIssue({ fingerprint: "abc123", title: "t", body: "b", comment: "c" })
    check("토큰이 없으면 건너뛴다", skipped.filed === false && skipped.reason === "unconfigured")
  } finally {
    globalThis.fetch = realFetch
    delete process.env.GITHUB_ISSUE_TOKEN
  }

  console.log("\n[4] 실제 NAS (읽기만)")
  const small = await statNasFile(SMALL)
  check(`파일 정보 — ${small?.size}B`, !!small && (small.size ?? 0) > 4 * 1024 * 1024)
  const big = await statNasFile(BIG)
  check(`194MB 파일도 내용 없이 정보만 — ${big?.size}B`, !!big && (big.size ?? 0) > 100 * 1024 * 1024)
  const listed = await listDirectory(DIR)
  check(`& 가 든 폴더를 연다 — ${listed?.length ?? "null"}건`, !!listed && listed.length > 0)
  check("목록에 크기가 보인다", !!listed?.some((e) => !e.isDir && (e.size ?? 0) > 0))
  check("목록의 경로로 다시 연다", !!listed && (await statNasFile(listed.find((e) => !e.isDir)!.path)) !== null)
  check("거부: 폴더", (await statNasFile(DIR)) === null)
  check("거부: 없는 파일", (await statNasFile(`${DIR}/없는파일-${Date.now()}.pdf`)) === null)
  const t0 = Date.now()
  const obj = await openFileObject({ id: "x", name: "족자_3.pdf", path: nasLinkPath(SMALL) })
  let bytes = 0
  for await (const c of obj.body) bytes += (c as Buffer).length
  check(`연결 파일을 끝까지 읽는다 — ${bytes}B · ${Date.now() - t0}ms`, bytes === small?.size)
  let threw = ""
  await openFileObject({ id: "x", name: "a", path: nasLinkPath("/homes/admin/secret.txt") }).catch((e: Error) => { threw = e.message })
  check("거부: DB 에 공유폴더 밖 경로가 들어 있어도 읽지 않는다", threw.includes("찾지 못했습니다"), threw)

  const alive = await fetch(`${BASE}/api/auth/csrf`).then((r) => r.ok).catch(() => false)
  if (!alive) {
    console.log(`\n[5] HTTP — ${BASE} 가 떠 있지 않아 건너뜀`)
  } else {
    console.log(`\n[5] HTTP — ${BASE}`)
    const user = await prisma.user.upsert({
      where: { name: "__nas_link__" }, update: { passwordHash: hashSync(PW, 10), isActive: true },
      create: { name: "__nas_link__", passwordHash: hashSync(PW, 10), role: "MEMBER" }, select: { id: true },
    })
    const fileIds: string[] = []
    let messageId: string | null = null
    try {
      const cookie = (await login("__nas_link__", PW)).join("; ")
      const post = (path: string, body: unknown) =>
        fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) })

      const stat = await fetch(`${BASE}/api/nas?path=${encodeURIComponent(BIG)}&stat=1`, { headers: { cookie } })
      const statBody = await stat.json().catch(() => null)
      check("stat=1 은 194MB 파일을 JSON 정보로만", stat.ok && statBody?.kind === "file" && statBody?.size === big?.size, JSON.stringify(statBody))

      const res = await post("/api/files/nas", { path: `Z:${SMALL.replace(/\//g, "\\")}` })
      const rec = await res.json()
      if (rec?.id) fileIds.push(rec.id)
      check("연결 → 201 · path 가 NAS 링크 · 크기 · pdf 타입", res.status === 201 && nasPathOf(rec.path) === SMALL && rec.size === small?.size && rec.mimeType === "application/pdf", JSON.stringify(rec))

      const open = await fetch(`${BASE}${rec.path}`, { headers: { cookie } })
      const openBytes = (await open.arrayBuffer()).byteLength
      check(`말풍선 링크로 연다 — ${openBytes}B`, open.ok && openBytes === small?.size)

      const msg = await post("/api/chat/messages", { roomId: "default-room", content: "완성했습니다 (NAS 연결 검증)", fileIds: [rec.id] })
      const m = await msg.json()
      messageId = m?.id ?? null
      check("메시지에 붙는다", msg.status === 201 && m?.files?.some((f: { id: string }) => f.id === rec.id), JSON.stringify(m?.files))

      for (const [name, path, want] of [
        ["거부: ..", "/HADD Science/../homes/admin/x", 400],
        ["거부: 다른 공유폴더", "/homes/admin/x.pdf", 400],
        ["거부: 폴더", DIR, 404],
        ["거부: 없는 파일", `${DIR}/없는파일.pdf`, 404],
      ] as const) {
        const r = await post("/api/files/nas", { path })
        const j = await r.json().catch(() => ({}))
        if (j?.id) fileIds.push(j.id)
        check(`${name} → ${want}`, r.status === want, `${r.status} ${JSON.stringify(j)}`)
      }
      const anon = await fetch(`${BASE}/api/files/nas`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: SMALL }) })
      check("거부: 로그인 없이 → 401", anon.status === 401)

      const rep = await post("/api/errors", { kind: "upload_too_large", message: "첨부 상한(4MB) 초과로 업로드를 막았다", size: 6469858, fileName: "족자_3.pdf", url: `${BASE}/tasks/46091728-1a69-4fa8-9fb8-0a6056e7cc0d` })
      const repBody = await rep.json()
      check("오류 보고를 받는다", rep.ok && repBody.ok === true, JSON.stringify(repBody))
      const dup = await (await post("/api/errors", { kind: "upload_too_large", message: "첨부 상한(4MB) 초과로 업로드를 막았다", size: 1, fileName: "다른.pdf" })).json()
      check("같은 사람 · 같은 오류는 30분 안에 다시 보내지 않는다", dup.reason === "중복", JSON.stringify(dup))
      const bad = await post("/api/errors", { kind: "nope", message: "x" })
      check("거부: 모르는 종류 → 400", bad.status === 400)
    } finally {
      // 메시지 색인은 응답 뒤에 따로 만들어진다 — 잠시 기다렸다 함께 지운다
      if (messageId) await new Promise((r) => setTimeout(r, 5000))
      if (messageId) await prisma.embeddingChunk.deleteMany({ where: { source: "CHAT_MESSAGE", sourceId: messageId } })
      if (messageId) await prisma.file.updateMany({ where: { messageId }, data: { messageId: null } })
      if (messageId) await prisma.chatMention.deleteMany({ where: { messageId } }).catch(() => {})
      if (messageId) await prisma.chatMessage.delete({ where: { id: messageId } }).catch(() => {})
      if (fileIds.length) await prisma.file.deleteMany({ where: { id: { in: fileIds } } })
      await prisma.activityLog.deleteMany({ where: { userId: user.id } }).catch(() => {})
      await prisma.user.delete({ where: { id: user.id } }).catch((e) => console.log("  (사용자 정리 실패)", e.message))
    }
  }

  console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

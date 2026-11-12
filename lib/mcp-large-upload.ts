// MCP 업로드 링크로 큰 파일(4MB 초과) 올리기 — 화면의 R2 직접 업로드(lib/r2/upload.ts)와 같은 세션 · 서명 · 완료를 쓴다.
// 바이트는 셸에서 R2 로 바로 간다(함수 본문 4.5MB 한도를 지나지 않는다). 이 모듈은 세션 열기 · 조각 서명 · 완료만 한다.
//
//   1. POST {링크 주소}/upload/large?t=<업로드 링크>  {name, size, mimeType}  → {session, partBytes, parts, urls}
//   2. 조각마다 PUT urls[n]  (n = 1..parts, 각 partBytes, 마지막은 남은 만큼)
//   3. POST {링크 주소}/upload/large/complete?t=<업로드 링크>  {session}      → 파일 {id, name, size, …}
//
// 권한: 1 은 업로드 링크(10분, 사람 · 업무 · 참여자 전용 여부를 담은 서명). 3 은 세션 토큰(7일, 사람에 묶인 서명)으로 —
// 큰 파일은 10분을 넘겨 올라갈 수 있어 링크가 만료돼도 끝낼 수 있게 한다. 링크가 아직 살아 있으면 업무 첨부까지 건다.
import { prisma } from "@/lib/db"
import { MAX_UPLOAD_BYTES } from "@/lib/constants"
import { ATTACH_MAX_MB, partCount, UPLOAD_PART_BYTES } from "@/lib/large-upload/rules"
import { verifyUploadSession } from "@/lib/large-upload/session"
import { MAX_SIGN_PARTS } from "@/lib/r2/rules"
import { r2Config, r2UploadEnabled } from "@/lib/r2/server"
import { finalizeR2Upload, openR2Session, signR2Parts } from "@/lib/r2/upload"

export type LinkGrant = { userId: string; taskId: string | null; isPrivate: boolean }
type Reply = { status: number; body: Record<string, unknown> }

/** 서명할 조각 번호를 한 번에 보낼 수 있는 만큼씩 나눈다(서명 규칙의 상한 MAX_SIGN_PARTS) */
export function partBatches(parts: number, max = MAX_SIGN_PARTS): number[][] {
  const out: number[][] = []
  for (let start = 1; start <= parts; start += max) {
    out.push(Array.from({ length: Math.min(max, parts - start + 1) }, (_, i) => start + i))
  }
  return out
}

export async function openLargeViaLink(grant: LinkGrant, input: unknown): Promise<Reply> {
  if (!r2UploadEnabled()) return { status: 503, body: { error: `큰 파일 올리기가 지금 꺼져 있습니다. ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하로 나눠 올리세요.` } }
  const b = (input ?? {}) as { name?: unknown; size?: unknown; mimeType?: unknown }
  const name = typeof b.name === "string" ? b.name.trim() : ""
  const size = typeof b.size === "number" && Number.isInteger(b.size) ? b.size : NaN
  if (!name || !(size > 0)) return { status: 400, body: { error: "name(파일 이름) · size(바이트 수)를 JSON 으로 주세요." } }
  if (size <= MAX_UPLOAD_BYTES) return { status: 400, body: { error: `${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하 파일은 curl -F file=@경로 '<링크>' 한 줄로 올립니다.` } }
  const opened = await openR2Session({
    userId: grant.userId,
    name,
    size,
    mimeType: typeof b.mimeType === "string" ? b.mimeType.slice(0, 200) : "",
    isPrivate: grant.isPrivate,
  })
  if (!opened.ok) return { status: opened.status, body: { error: opened.error } }
  const upload = verifyUploadSession(opened.session)
  if (!upload) return { status: 500, body: { error: "세션을 열었지만 읽지 못했습니다. 다시 시도해 주세요." } }
  const parts = partCount(size, opened.partBytes)
  const urls: Record<number, string> = {}
  for (const batch of partBatches(parts)) {
    const signed = await signR2Parts(upload, batch)
    if (!signed.ok) return { status: signed.status, body: { error: signed.error } }
    Object.assign(urls, signed.urls)
  }
  return { status: 201, body: { session: opened.session, partBytes: opened.partBytes, parts, urls } }
}

export async function completeLargeViaLink(input: unknown, grant: LinkGrant | null): Promise<Reply> {
  if (!r2Config()) return { status: 404, body: { error: "없는 경로" } }
  const upload = verifyUploadSession(((input ?? {}) as { session?: unknown }).session)
  if (!upload || !upload.r2UploadId) return { status: 410, body: { error: "세션이 만료되었습니다. create_upload_link 로 다시 시작하세요." } }
  // 세션 토큰이 곧 자격이다 — 만든 뒤 계정이 닫혔으면 막는다(링크 검사와 같은 기준)
  const user = await prisma.user.findUnique({ where: { id: upload.userId }, select: { isActive: true } })
  if (!user?.isActive) return { status: 401, body: { error: "계정이 닫혔습니다." } }
  const done = await finalizeR2Upload(upload)
  if (!done.ok) return { status: done.status, body: { error: done.error } }
  // 업무 첨부 — 링크가 아직 살아 있고 같은 사람이며 공개 파일일 때만
  if (grant && grant.userId === upload.userId && grant.taskId && !upload.isPrivate) {
    await prisma.file.updateMany({ where: { id: done.file.id, taskId: null, privateToUserId: null }, data: { taskId: grant.taskId } })
  }
  return { status: 201, body: { ...done.file, next: `post_message 의 files 에 "${done.file.id}" 를 넣으면 첨부로 붙습니다.` } }
}

/** create_upload_link 응답에 붙이는 큰 파일 절차 — python3 표준 라이브러리만 쓴다(jq · 따로 깔 것 없음) */
export function largeUploadGuide(base: string, token: string, enabled = r2UploadEnabled()): string[] {
  const limit = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)
  if (!enabled) return [`■ ${limit}MB 초과 — 지금은 큰 파일 올리기가 꺼져 있어 올릴 수 없습니다. 나눠 올리거나 시놀로지에 두고 경로를 적어 주세요.`]
  return [
    `■ ${limit}MB 초과 ~ ${ATTACH_MAX_MB}MB — 조각(${UPLOAD_PART_BYTES / 1024 / 1024}MB)으로 나눠 저장소에 바로 올린다. 셸에서 그대로 실행:`,
    "```",
    `python3 - '<파일 경로>' <<'PY'`,
    `import json, mimetypes, os, sys, urllib.error, urllib.request`,
    `B, T = ${JSON.stringify(base)}, ${JSON.stringify(token)}`,
    `def call(url, body=None, data=None, method="POST"):`,
    `    req = urllib.request.Request(url, data=data if data is not None else json.dumps(body).encode(), method=method,`,
    `                                 headers={} if data is not None else {"content-type": "application/json"})`,
    `    try:`,
    `        with urllib.request.urlopen(req, timeout=600) as r: return r.read()`,
    `    except urllib.error.HTTPError as e: sys.exit(f"실패 {e.code}: {e.read().decode(errors='replace')}")`,
    `path = sys.argv[1]; size = os.path.getsize(path); name = os.path.basename(path)`,
    `o = json.loads(call(f"{B}/upload/large?t={T}", {"name": name, "size": size, "mimeType": mimetypes.guess_type(name)[0] or ""}))`,
    `with open(path, "rb") as f:`,
    `    for n in range(1, o["parts"] + 1):`,
    `        call(o["urls"][str(n)], data=f.read(o["partBytes"]), method="PUT"); print(f"조각 {n}/{o['parts']}", file=sys.stderr)`,
    `print(call(f"{B}/upload/large/complete?t={T}", {"session": o["session"]}).decode())`,
    `PY`,
    "```",
    "조각 서명 주소는 30분, 업로드 링크는 10분이다. 완료(complete)는 링크가 지나도 세션으로 끝난다(업무 첨부는 링크가 살아 있을 때만 걸린다).",
  ]
}

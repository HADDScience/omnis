// NAS 파일을 옴니스 첨부로 잇기 · 내가 볼 수 있는 최근 파일 — 화면(app/api/files/nas · app/api/files GET)과
// 도구(lib/tools/plan-files.ts)가 같이 부른다(#248). 라우트 안에 있던 것을 그대로 옮겼다.
import { prisma } from "@/lib/db"
import { normalizeNasPath, statNasFile, mimeTypeFromName } from "@/lib/nas"
import { nasLinkPath } from "@/lib/file-source"
import { visibleFileWhere } from "@/lib/file-access"

/** File.size 는 Int(32비트)다. 표시용이라 넘치면 상한으로 적는다. */
const INT_MAX = 2_147_483_647

export type LinkResult = { ok: true; file: Awaited<ReturnType<typeof prisma.file.create>> } | { ok: false; status: 400 | 404; error: string }

/** HADD Science 공유폴더 안의 파일만. private 이면 나만 보는 파일(사람 방에 붙일 것) */
export async function linkNasFile(userId: string, rawPath: string, isPrivate: boolean): Promise<LinkResult> {
  const path = normalizeNasPath(rawPath)
  if (!path) return { ok: false, status: 400, error: "HADD Science 공유폴더 안의 경로만 연결할 수 있습니다" }
  const entry = await statNasFile(path)
  if (!entry) return { ok: false, status: 404, error: `시놀로지에서 파일을 찾지 못했습니다 — ${path}` }
  const file = await prisma.file.create({
    data: {
      name: entry.name,
      path: nasLinkPath(path),
      size: Math.min(entry.size ?? 0, INT_MAX),
      mimeType: mimeTypeFromName(entry.name)?.split(";")[0] ?? "application/octet-stream",
      privateToUserId: isPrivate ? userId : null,
    },
  })
  return { ok: true, file }
}

/** 내가 볼 수 있는 최근 파일 50개 */
export function recentVisibleFiles(userId: string) {
  return prisma.file.findMany({
    where: visibleFileWhere(userId),
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, name: true, path: true, mimeType: true, size: true },
  })
}

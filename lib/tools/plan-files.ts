// 묶음 7(#248) 실행 — 파일 · NAS. 정의는 lib/tools/defs-files.ts. 화면과 같은 lib/nas · nas-link 함수를 부른다.
import type { Caller } from "@/lib/omnis-mcp"
import { listDirectory, normalizeNasPath, statNasFile } from "@/lib/nas"
import { linkNasFile, recentVisibleFiles } from "@/lib/nas-link"
import { IS_DEMO } from "@/lib/demo"
import { blocked, str, type Planner } from "./planned"
import type { FileReadName, FileWriteName } from "./defs-files"

const kb = (n: number | null) => (n === null ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`)

export async function runFileRead(name: FileReadName, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "list_files": {
      const rows = await recentVisibleFiles(caller.userId)
      if (rows.length === 0) return { text: "볼 수 있는 파일이 없습니다." }
      return { text: [`최근 파일 ${rows.length}개 — 내용은 read_file`, ...rows.map((f) => `- ${f.name} · ${kb(f.size)} · ${f.mimeType} · 파일 ${f.id}`)].join("\n") }
    }
    case "browse_nas": {
      const path = normalizeNasPath(str(args.path))
      if (!path) return { error: "열 수 없는 경로입니다 — HADD Science 공유폴더 안의 경로만 봅니다." }
      const entries = await listDirectory(path)
      if (entries) {
        return { text: [`폴더 ${path} — ${entries.length}개`, ...entries.slice(0, 200).map((e) => `- ${e.isDir ? "📁 " : ""}${e.name}${e.isDir ? "/" : ` · ${kb(e.size)}`}${e.modifiedAt ? ` · ${e.modifiedAt.slice(0, 10)}` : ""} · ${e.path}`), entries.length > 200 ? `… ${entries.length - 200}개 더` : null].filter(Boolean).join("\n") }
      }
      const entry = await statNasFile(path)
      if (!entry) return { error: `찾을 수 없습니다 — ${path}` }
      return { text: `파일 ${entry.path} · ${kb(entry.size)}${entry.modifiedAt ? ` · ${entry.modifiedAt.slice(0, 10)}` : ""} — 내용은 link_nas_file 로 이은 뒤 read_file` }
    }
  }
}

const planLink: Planner = async (args, caller) => {
  const T = "NAS 파일 잇기"
  if (IS_DEMO) return blocked(T, "", "시연용 사이트에서는 NAS 에 붙지 않습니다")
  const path = normalizeNasPath(str(args.path))
  if (!path) return blocked(T, str(args.path), "HADD Science 공유폴더 안의 경로만 연결할 수 있습니다")
  const entry = await statNasFile(path)
  if (!entry || entry.isDir) return blocked(T, path, entry?.isDir ? "폴더는 이을 수 없습니다 — 파일 경로를 주세요" : `시놀로지에서 파일을 찾지 못했습니다 — ${path}`)
  const isPrivate = args.private === true
  return {
    title: T, target: entry.path,
    changes: [{ label: "첨부", before: null, after: `${entry.name} · ${kb(entry.size)}${isPrivate ? " · 나만 보기" : ""}` }],
    risk: "파일을 복사하지 않고 옴니스 첨부로 잇습니다. 글에 붙이면 그 글을 볼 수 있는 사람이 내려받습니다.",
    run: async () => {
      const r = await linkNasFile(caller.userId, entry.path, isPrivate)
      return r.ok ? { ok: true, id: r.file.id, text: `이었습니다 · 파일 ${r.file.id}` } : { ok: false, error: r.error }
    },
  }
}

export const FILE_PLANNERS: Record<FileWriteName, Planner> = { link_nas_file: planLink }

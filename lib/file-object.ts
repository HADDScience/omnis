// 첨부 파일의 실물을 연다. 올린 파일이든 NAS 연결이든 읽는 곳은 이것만 부른다.
// 읽는 곳: /api/files/[id]/raw · MCP read_file · MCP 내려받기 링크
import { getObject, objectKeyFor, type DavResponse } from "@/lib/storage"
import { readFile, normalizeNasPath } from "@/lib/nas"
import { nasPathOf } from "@/lib/file-source"

export async function openFileObject(file: { id: string; name: string; path: string }): Promise<DavResponse> {
  const linked = nasPathOf(file.path)
  if (linked === null) return getObject(objectKeyFor(file.id, file.name))

  // 행을 만들 때 걸렀지만 DB 값을 그대로 NAS 로 보내지 않는다 — 공유폴더 밖으로 나가는 경로는 여기서도 막는다
  const path = normalizeNasPath(linked)
  const res = path ? await readFile(path) : null
  if (!res) throw new Error("NAS 에서 파일을 찾지 못했습니다 — 옮겨졌거나 지워졌을 수 있습니다")
  return res
}

// 첨부 파일이 어디에 있는가 — 화면과 서버가 같은 규칙으로 가른다.
//
// 첨부는 두 가지다(2026-09-17).
//   - 올린 파일: 옴니스 첨부 폴더에 사본이 있다. path = /api/files/{id}/raw
//   - NAS 파일 연결: 공용 NAS 에 이미 있는 파일을 가리키기만 한다. path = /api/nas?path=…
// 4MB 넘는 파일은 Vercel 을 지나 올릴 수 없어, NAS 에 있는 파일은 올리지 않고 잇는다.
// 스키마를 바꾸지 않으려고 path 모양으로 가른다 — 화면은 원래 path 로 링크를 그린다.

const NAS_LINK_PREFIX = "/api/nas?path="

/** NAS 경로(`/HADD Science/…`)를 첨부의 path 로 */
export function nasLinkPath(nasPath: string): string {
  return `${NAS_LINK_PREFIX}${encodeURIComponent(nasPath)}`
}

/** 첨부의 path 가 NAS 연결이면 그 NAS 경로, 올린 파일이면 null */
export function nasPathOf(filePath: string): string | null {
  if (!filePath.startsWith(NAS_LINK_PREFIX)) return null
  try {
    return decodeURIComponent(filePath.slice(NAS_LINK_PREFIX.length))
  } catch {
    return null
  }
}

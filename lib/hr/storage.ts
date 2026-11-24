// 채용 지원서 파일 저장소 — 첨부 폴더(옴니스 첨부파일/files)가 아니라 개인정보 폴더 아래 따로 둔다.
//   운영: /HADD Science/08. 개인정보/옴니스 채용 지원서
//   로컬: SYNOLOGY_HR_APPLICATIONS_PATH 로 _dev 하위 폴더를 가리킨다 (.env)
// 서명 · 직인(lib/staff-assets.ts)과 같은 방식이다. 옴니스는 NAS 에 한 계정으로 붙으므로, 사람이 이 폴더를
// 직접 여는 권한은 DSM 에서 채용 담당만으로 좁혀야 한다 — 코드는 폴더를 나눌 뿐이다.
import { deleteAt, existsAt, getAt, putAt, putRangeAt, statSizeAt, type DavResponse } from "@/lib/storage"

export const HR_APPLICATION_ROOT = "/HADD Science/08. 개인정보/옴니스 채용 지원서"
export const hrRoot = () => (process.env.SYNOLOGY_HR_APPLICATIONS_PATH || HR_APPLICATION_ROOT).replace(/\/+$/, "")
export const hrPath = (key: string) => `${hrRoot()}/${key}`

const README = `이 폴더는 옴니스가 홈페이지 채용 지원서의 이력서 · 포트폴리오를 두는 곳입니다.

- 파일 이름은 지원서 ID 입니다. 지원자 이름은 옴니스 지원서함(채용 담당만)에서 봅니다.
- 보관 기간이 지나면 옴니스가 매일 새벽 스스로 지웁니다(선발 종료 후 6개월, 늦어도 접수 후 12개월).
- 손으로 옮기거나 이름을 바꾸지 마세요. 옴니스가 찾지 못하고, 파기도 하지 못합니다.
`

let readmeReady = false
async function ensureReadme() {
  if (readmeReady) return
  const path = `${hrRoot()}/읽어주세요.txt`
  if (!(await existsAt(path))) await putAt(path, Buffer.from(README, "utf8"), "text/plain; charset=utf-8")
  readmeReady = true
}

/** 조각 하나 쓰기 — 상태 코드를 그대로(2xx 성공, 507 디스크 가득) */
export async function putApplicationPart(key: string, body: Buffer, start: number, total: number): Promise<number> {
  if (start === 0) await ensureReadme()
  return putRangeAt(hrPath(key), body, start, total)
}

export const applicationFileSize = (key: string) => statSizeAt(hrPath(key))
export const getApplicationFile = (key: string): Promise<DavResponse> => getAt(hrPath(key))
/** 파일과 지원서 폴더를 지운다. 이미 없으면 성공으로 본다 */
export async function deleteApplicationFiles(applicationId: string, keys: readonly string[]): Promise<void> {
  for (const key of keys) await deleteAt(hrPath(key))
  await deleteAt(hrPath(`${applicationId}/`))
}

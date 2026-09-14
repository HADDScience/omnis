// 서명 · 직인 이미지 저장소.
//
// 첨부파일 폴더(옴니스 첨부파일/files)가 아니라 권한이 좁은 NAS 폴더에 둔다 — 작업지시자 결정(2026-09-14).
//   운영: /HADD Science/08. 개인정보/옴니스 서명·직인
//   로컬: SYNOLOGY_STAFF_ASSETS_PATH 로 _dev 하위 폴더를 가리킨다 (.env)
// 옴니스는 NAS 에 한 계정으로 붙으므로, 폴더 권한은 DSM 에서 좁혀야 한다 — 코드는 폴더를 나눌 뿐이다.
//
// 키는 `<staffId>/<signature|seal>-<md5 12자>.<png|jpg>`. 같은 내용은 같은 키라 덮어쓰지 않는다.
// 예전 키 `staff/…` 는 첨부파일 폴더 아래에 있었다 — scripts/move-staff-assets.ts 로 옮기기 전 행을 읽으려고 남긴다.
import { createHash } from "crypto"
import { deleteAt, deleteObject, existsAt, getAt, getObject, putAt, type DavResponse } from "@/lib/storage"

export const STAFF_ASSET_ROOT = "/HADD Science/08. 개인정보/옴니스 서명·직인"
export const STAFF_ASSET_MAX_BYTES = 4 * 1024 * 1024

export const staffAssetRoot = () => (process.env.SYNOLOGY_STAFF_ASSETS_PATH || STAFF_ASSET_ROOT).replace(/\/+$/, "")
export const isLegacyStaffKey = (key: string) => key.startsWith("staff/")
export const staffAssetPath = (key: string) => `${staffAssetRoot()}/${key}`

export interface SniffedImage {
  mimeType: "image/png" | "image/jpeg"
  ext: "png" | "jpg"
  width: number | null
  height: number | null
}

/** 파일 앞 바이트로 형식과 크기를 읽는다 — 브라우저가 붙인 MIME 은 믿지 않는다 */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { mimeType: "image/png", ext: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      const len = buf.readUInt16BE(i + 2)
      // SOF0~SOF15 (DHT 0xC4 · JPG 0xC8 · DAC 0xCC 제외) 에 높이·너비가 있다
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: "image/jpeg", ext: "jpg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
    return { mimeType: "image/jpeg", ext: "jpg", width: null, height: null }
  }
  return null
}

export function staffAssetKey(staffId: string, kind: "SIGNATURE" | "SEAL", buf: Buffer, ext: "png" | "jpg"): string {
  const hash = createHash("md5").update(buf).digest("hex").slice(0, 12)
  return `${staffId}/${kind.toLowerCase()}-${hash}.${ext}`
}

const README = `════════════════════════════════════════════════════════════
  옴니스(Omnis) 서명 · 직인 보관함
════════════════════════════════════════════════════════════

이 폴더는 업무 관리 시스템 "옴니스"가 자동으로 만들고 관리합니다.
과제 서류 대리 작성에 쓰는 직원 서명과 직인 이미지가 들어 있습니다.

  옴니스에서는 관리자만 꺼낼 수 있고, 꺼낼 때마다 누가 · 언제 · 누구의 것을
  활동 기록에 남깁니다.

▌ 주의해 주세요

  ✗ 안에 있는 파일 · 폴더의 이름을 바꾸거나 옮기지 마세요
    (옴니스가 이 이름으로 파일을 찾습니다)
  ✗ 이 폴더의 NAS 권한을 넓히지 마세요 — 서명은 문서 위조에 쓰일 수 있습니다

  서명을 바꾸려면 옴니스 → HADD DB → 인력 화면의 「바꾸기」 를 쓰세요.

  관리자 : 정우창 (AI개발팀)
`

let readmeReady = false

/** 폴더 첫 사용 때 안내문을 둔다. 이미 있으면 건드리지 않는다(덮어쓰지 않는다) */
async function ensureReadme() {
  if (readmeReady) return
  const path = `${staffAssetRoot()}/읽어주세요.txt`
  if (!(await existsAt(path))) await putAt(path, Buffer.from(README, "utf8"), "text/plain; charset=utf-8")
  readmeReady = true
}

export async function putStaffAsset(key: string, buf: Buffer, mimeType: string): Promise<void> {
  await ensureReadme()
  const path = staffAssetPath(key)
  // 키에 내용 해시가 들어 있어 같은 키면 같은 파일이다 — 다시 쓰지 않는다
  if (await existsAt(path)) return
  await putAt(path, buf, mimeType)
}

export function getStaffAsset(key: string): Promise<DavResponse> {
  return isLegacyStaffKey(key) ? getObject(key) : getAt(staffAssetPath(key))
}

export function deleteStaffAsset(key: string): Promise<void> {
  return isLegacyStaffKey(key) ? deleteObject(key) : deleteAt(staffAssetPath(key))
}

// 옴니스 질문의 첨부를 연다 — 이미지는 줄여서 base64, 글 파일은 본문. 모양 · 자르기 · 비밀 가리기는 ./attachments.ts
import sharp from "sharp"
import * as XLSX from "xlsx"
import { extractText } from "unpdf"
import { openFileObject } from "@/lib/file-object"
import { ATTACH_IMAGE_SIDE, ATTACH_READ_MAX_BYTES, attachmentKind, type ReadAttachment } from "./attachments"

async function readAll(file: { id: string; name: string; path: string }): Promise<Buffer> {
  const res = await openFileObject(file)
  const chunks: Buffer[] = []
  for await (const c of res.body) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

/** 파일 하나를 모델이 읽을 모양으로. 실패해도 던지지 않는다 — 모델이 「읽지 못했다」 고 전한다 */
export async function readAttachment(file: { id: string; name: string; path: string; size: number; mimeType: string }): Promise<ReadAttachment> {
  const kind = attachmentKind(file.name, file.mimeType)
  if (kind === "other") return { name: file.name, kind, raw: null, note: "이 형식(워드 · 한글 등)은 본문을 읽지 못합니다. PDF · 텍스트 · 엑셀 · 이미지로 다시 붙여 달라고 안내하세요." }
  if (file.size > ATTACH_READ_MAX_BYTES) {
    const note = `${Math.round(file.size / 1024 / 1024)}MB 라 열지 않았습니다(상한 ${ATTACH_READ_MAX_BYTES / 1024 / 1024}MB).`
    return kind === "image" ? { name: file.name, kind, image: null, note } : { name: file.name, kind, raw: null, note }
  }
  try {
    const buf = await readAll(file)
    if (kind === "image") {
      // 사진 방향을 바로잡고 긴 변 1280 으로 줄인다(lib/photo-describe.ts 와 같다). gif 는 첫 장만
      const jpeg = await sharp(buf).rotate().resize(ATTACH_IMAGE_SIDE, ATTACH_IMAGE_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      return { name: file.name, kind, image: { base64: jpeg.toString("base64"), mediaType: "image/jpeg" } }
    }
    if (kind === "sheet") {
      const wb = XLSX.read(buf, { type: "buffer" })
      return { name: file.name, kind, raw: wb.SheetNames.map((s) => `## ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join("\n\n") }
    }
    if (kind === "pdf") {
      const { text, totalPages } = await extractText(new Uint8Array(buf), { mergePages: true })
      return { name: file.name, kind, raw: text ? `(${totalPages}쪽)\n${text}` : "" }
    }
    return { name: file.name, kind, raw: buf.toString("utf8") }
  } catch (err) {
    console.error("[agent] 첨부 읽기 실패", file.id, err)
    const note = "파일을 열지 못했습니다(시놀로지에서 옮겨졌거나 깨진 파일일 수 있습니다)."
    return kind === "image" ? { name: file.name, kind, image: null, note } : { name: file.name, kind, raw: null, note }
  }
}

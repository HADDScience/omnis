// 파일을 내보낼 때 붙이는 헤더. 파일을 내보내는 라우트는 전부 이것을 쓴다(lib/file-serving.test.ts 가 지킨다).
//
// 첨부의 Content-Type 은 올린 사람이 정한 값이다. 그대로 돌려주면 올린 내용이 옴니스 출처의 문서로
// 열릴 수 있으므로, 저장된 값은 아래 표를 찾는 열쇠로만 쓰고 응답에는 표의 값을 싣는다.
// 표에 있는 형식(내용이 실행되지 않는 이미지 · PDF · 영상 · 음성)만 그 자리에서 열고, 나머지는 전부 내려받게 한다.
// 화면도 같은 표로 미리보기 여부를 가른다 — 클라이언트가 가져가므로 서버 전용 모듈을 들이지 않는다.

const INLINE_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/x-png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
  "application/pdf": "application/pdf",
  "video/mp4": "video/mp4",
  "video/x-m4v": "video/mp4",
  "video/webm": "video/webm",
  "video/ogg": "video/ogg",
  "video/quicktime": "video/quicktime",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/ogg": "audio/ogg",
  "audio/mp4": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/aac",
  "audio/webm": "audio/webm",
  "audio/flac": "audio/flac",
  "audio/x-flac": "audio/flac",
}

/** 저장된 형식을 모를 때(비었거나 일반 바이너리)만 이름으로 찾는다. NAS 파일은 이름밖에 없다 */
const INLINE_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
}

const UNKNOWN_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"])

/** 그 자리에서 열어도 되는 형식이면 내보낼 Content-Type, 아니면 null */
export function safeInlineType(mimeType: string | null | undefined, name?: string): string | null {
  const stored = (mimeType ?? "").split(";")[0].trim().toLowerCase()
  if (!UNKNOWN_TYPES.has(stored)) return Object.hasOwn(INLINE_TYPES, stored) ? INLINE_TYPES[stored] : null
  const extension = name?.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  return Object.hasOwn(INLINE_TYPE_BY_EXTENSION, extension) ? INLINE_TYPE_BY_EXTENSION[extension] : null
}

export const NOSNIFF = { "X-Content-Type-Options": "nosniff" } as const

/** RFC 5987. encodeURIComponent 가 남겨 두는 ' ( ) * 까지 인코딩한다 */
function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * 파일 응답의 세 헤더. 캐시 · 길이 · CORS 는 라우트마다 달라 호출부가 더한다.
 * `attachment: true` 는 안전한 형식도 내려받게 할 때(내려받기 단추 · 셸용 링크).
 */
export function fileResponseHeaders(file: { mimeType?: string | null; name: string; attachment?: boolean }) {
  const inlineType = safeInlineType(file.mimeType, file.name)
  const disposition = inlineType && !file.attachment ? "inline" : "attachment"
  return {
    "Content-Type": inlineType ?? "application/octet-stream",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeFilename(file.name)}`,
    ...NOSNIFF,
  }
}

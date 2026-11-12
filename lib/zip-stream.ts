/**
 * 스트리밍 zip(무압축 STORE) — 브라우저에서 파일을 하나씩 받아 그대로 이어 붙인다. 서버에서 묶지 않는다
 * (Vercel 함수 응답 4.5MB 한도, 2026-11-12 방 서랍). 사진 · 동영상 · PDF 는 이미 압축돼 있어 deflate 이득이 작다.
 *
 * - 크기 · CRC 는 받기 전에 모르므로 각 항목 뒤에 데이터 기술자(일반 목적 비트 3)를 둔다
 * - 이름은 UTF-8(비트 11) — 한글 이름이 맥 · 윈도 기본 압축 풀기에서 그대로 보인다
 * - ZIP64 는 쓰지 않는다. 묶음은 1GB 로 나누므로(lib/room-drawer.ts DOWNLOAD_BATCH_BYTES) 4GB 오프셋에 닿지 않는다
 * 순수 모듈 — 브라우저 · Node 모두 돈다. 시험: zip-stream.test.ts(jszip 으로 다시 푼다)
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc ^ 0xffffffff
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** zip 안 경로(폴더는 /) */
  name: string
  /** 수정 시각 — zip 은 초 2 단위 · 지역 시각 */
  date: Date
  /** 바이트를 여는 함수 — 차례가 오면 부른다(미리 열면 서명 주소가 만료된다) */
  open: () => Promise<ReadableStream<Uint8Array>>
}

const MAX_ZIP32 = 0xffffffff

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

const enc = new TextEncoder()

function localHeader(nameBytes: Uint8Array, dt: { time: number; date: number }): Uint8Array {
  const b = new Uint8Array(30 + nameBytes.length)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x04034b50, true)
  v.setUint16(4, 20, true) // 풀 때 필요한 버전 2.0
  v.setUint16(6, 0x0808, true) // 비트 3(데이터 기술자) + 비트 11(UTF-8)
  v.setUint16(8, 0, true) // STORE
  v.setUint16(10, dt.time, true)
  v.setUint16(12, dt.date, true)
  // CRC · 크기는 0 — 데이터 기술자에 둔다
  v.setUint16(26, nameBytes.length, true)
  b.set(nameBytes, 30)
  return b
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const b = new Uint8Array(16)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x08074b50, true)
  v.setUint32(4, crc, true)
  v.setUint32(8, size, true)
  v.setUint32(12, size, true)
  return b
}

interface Written {
  nameBytes: Uint8Array
  dt: { time: number; date: number }
  crc: number
  size: number
  offset: number
}

function centralRecord(e: Written): Uint8Array {
  const b = new Uint8Array(46 + e.nameBytes.length)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x02014b50, true)
  v.setUint16(4, 0x0314, true) // 만든 버전 2.0 · 유닉스(권한 칸을 읽는다)
  v.setUint16(6, 20, true)
  v.setUint16(8, 0x0808, true)
  v.setUint16(10, 0, true)
  v.setUint16(12, e.dt.time, true)
  v.setUint16(14, e.dt.date, true)
  v.setUint32(16, e.crc, true)
  v.setUint32(20, e.size, true)
  v.setUint32(24, e.size, true)
  v.setUint16(28, e.nameBytes.length, true)
  v.setUint32(38, (0o100644 << 16) >>> 0, true) // 보통 파일 rw-r--r--
  v.setUint32(42, e.offset, true)
  b.set(e.nameBytes, 46)
  return b
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const b = new Uint8Array(22)
  const v = new DataView(b.buffer)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(8, count, true)
  v.setUint16(10, count, true)
  v.setUint32(12, cdSize, true)
  v.setUint32(16, cdOffset, true)
  return b
}

export interface ZipProgress {
  /** 끝낸 항목 수 */
  done: number
  /** 지금까지 zip 에 넣은 원본 바이트 */
  bytes: number
}

export class ZipEntryError extends Error {
  constructor(
    readonly entry: string,
    cause: unknown,
  ) {
    super(`${entry}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/**
 * 항목을 차례로 열어 zip 바이트를 흘려보낸다. 하나라도 못 받으면 그 항목은 건너뛰고 onSkip 을 부른다
 * (한 장 때문에 묶음 전체를 잃지 않는다). signal 로 멈추면 스트림이 오류로 끝난다.
 */
export function zipStream(
  entries: ZipEntry[],
  opts: { signal?: AbortSignal; onProgress?: (p: ZipProgress) => void; onSkip?: (name: string, error: unknown) => void } = {},
): ReadableStream<Uint8Array> {
  const written: Written[] = []
  let offset = 0
  let index = 0
  let bytes = 0
  let finished = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const push = (chunk: Uint8Array) => {
        controller.enqueue(chunk)
        offset += chunk.length
      }
      try {
        if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException("취소", "AbortError")
        // 건너뛴 항목 뒤에는 바로 다음 항목으로 — pull 이 아무것도 넣지 않고 끝나면 스트림이 다시 부르지 않는다
        while (index < entries.length) {
          const e = entries[index++]
          let stream: ReadableStream<Uint8Array>
          try {
            stream = await e.open()
          } catch (err) {
            if (opts.signal?.aborted) throw err
            opts.onSkip?.(e.name, err)
            continue
          }
          const nameBytes = enc.encode(e.name)
          const dt = dosTime(e.date)
          const start = offset
          push(localHeader(nameBytes, dt))
          let crc = 0
          let size = 0
          const reader = stream.getReader()
          try {
            for (;;) {
              if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException("취소", "AbortError")
              const { done, value } = await reader.read()
              if (done) break
              crc = crc32Update(crc, value)
              size += value.length
              bytes += value.length
              push(value)
              opts.onProgress?.({ done: written.length, bytes })
            }
          } catch (err) {
            // 받다가 끊긴 항목은 이미 일부를 흘렸다 — zip 이 깨지므로 묶음을 끝낸다
            throw new ZipEntryError(e.name, err)
          } finally {
            reader.releaseLock()
          }
          if (offset > MAX_ZIP32) throw new Error("묶음이 4GB 를 넘었습니다 — 나눠 받으세요")
          push(dataDescriptor(crc, size))
          written.push({ nameBytes, dt, crc, size, offset: start })
          opts.onProgress?.({ done: written.length, bytes })
          return
        }
        if (finished) return
        finished = true
        const cdOffset = offset
        for (const w of written) push(centralRecord(w))
        push(endRecord(written.length, offset - cdOffset, cdOffset))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

/** 문자열 하나를 항목으로 — 빠진파일.txt */
export function textEntry(name: string, text: string, date: Date): ZipEntry {
  return {
    name,
    date,
    open: async () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          // 메모장(윈도)이 UTF-8 로 열게 BOM 을 붙인다
          c.enqueue(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(text)]))
          c.close()
        },
      }),
  }
}

"use client"

/**
 * 최소한의 ZIP 작성기. xlsx 는 XML 파일을 담은 zip 이라 이것만 있으면 만들 수 있다.
 *
 * 압축하지 않고 그대로 담는다(STORE). 워크북이 수십 KB 규모라 압축 이득이 작고,
 * 그 대신 압축 라이브러리도 CompressionStream 도 필요 없어진다. Excel·Numbers·
 * LibreOffice 모두 무압축 zip 을 정상으로 읽는다.
 *
 * 타임스탬프는 1980-01-01 로 고정한다. 같은 데이터면 같은 바이트가 나와야
 * 내보내기 결과를 비교할 수 있다.
 */

export interface ZipEntry {
  /** zip 안에서의 경로. 예: `xl/worksheets/sheet1.xml` */
  path: string
  text: string
}

const DOS_TIME = 0 // 00:00:00
const DOS_DATE = 33 // 1980-01-01 → ((1980-1980)<<9)|(1<<5)|1

/** CRC-32 (IEEE 802.3). zip 헤더가 요구한다. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 리틀엔디언으로 쓰면서 커서를 옮기는 얇은 도우미. */
class Writer {
  private readonly view: DataView
  private offset = 0

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer)
  }

  get position(): number {
    return this.offset
  }

  u16(value: number): void {
    this.view.setUint16(this.offset, value, true)
    this.offset += 2
  }

  u32(value: number): void {
    this.view.setUint32(this.offset, value, true)
    this.offset += 4
  }

  raw(value: Uint8Array): void {
    this.bytes.set(value, this.offset)
    this.offset += value.length
  }
}

export function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.path)
    const data = encoder.encode(entry.text)
    return { name, data, crc: crc32(data) }
  })

  const LOCAL_HEADER = 30
  const CENTRAL_HEADER = 46
  const EOCD = 22

  const localSize = prepared.reduce(
    (sum, e) => sum + LOCAL_HEADER + e.name.length + e.data.length,
    0
  )
  const centralSize = prepared.reduce(
    (sum, e) => sum + CENTRAL_HEADER + e.name.length,
    0
  )

  const out = new Writer(new Uint8Array(localSize + centralSize + EOCD))
  const offsets: number[] = []

  // 로컬 헤더 + 데이터
  for (const entry of prepared) {
    offsets.push(out.position)
    out.u32(0x04034b50)
    out.u16(20) // 필요한 버전
    out.u16(0x0800) // 파일명이 UTF-8 임을 알린다 (한글 경로는 없지만 규약대로)
    out.u16(0) // 압축 방식 0 = STORE
    out.u16(DOS_TIME)
    out.u16(DOS_DATE)
    out.u32(entry.crc)
    out.u32(entry.data.length) // 압축 크기 = 원본 크기
    out.u32(entry.data.length)
    out.u16(entry.name.length)
    out.u16(0) // extra 없음
    out.raw(entry.name)
    out.raw(entry.data)
  }

  // 중앙 디렉터리
  const centralStart = out.position
  prepared.forEach((entry, i) => {
    out.u32(0x02014b50)
    out.u16(20) // 만든 버전
    out.u16(20) // 필요한 버전
    out.u16(0x0800)
    out.u16(0)
    out.u16(DOS_TIME)
    out.u16(DOS_DATE)
    out.u32(entry.crc)
    out.u32(entry.data.length)
    out.u32(entry.data.length)
    out.u16(entry.name.length)
    out.u16(0) // extra
    out.u16(0) // 주석
    out.u16(0) // 디스크 번호
    out.u16(0) // 내부 속성
    out.u32(0) // 외부 속성
    out.u32(offsets[i])
    out.raw(entry.name)
  })

  // 끝 레코드. 중앙 디렉터리 크기는 EOCD 를 쓰기 전에 재 둔다 — 쓰는 도중의
  // position 을 쓰면 EOCD 자신의 길이가 섞여 들어간다.
  const centralSizeWritten = out.position - centralStart
  out.u32(0x06054b50)
  out.u16(0)
  out.u16(0)
  out.u16(prepared.length)
  out.u16(prepared.length)
  out.u32(centralSizeWritten)
  out.u32(centralStart)
  out.u16(0)

  return out.bytes
}

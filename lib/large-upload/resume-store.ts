// 이어 올리기 표 — 기기의 IndexedDB. 토큰은 저장하지 않는다(세션 표로 새로 받는다).
// 저장소를 못 쓰는 환경(사생활 보호 등)에서는 재개만 없을 뿐 올리기는 된다.
export interface ResumeRecord {
  fingerprint: string
  name: string
  size: number
  session: string
  pathname: string
  uploadId: string
  key: string
  partBytes: number
  parts: { partNumber: number; etag: string }[]
  updatedAt: number
}

const DB_NAME = "omnis-large-upload"
const STORE = "uploads"

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "fingerprint" })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = act(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => {
        db.close()
        resolve(undefined)
      }
    } catch {
      db.close()
      resolve(undefined)
    }
  })
}

export const readResume = (fingerprint: string) => run<ResumeRecord | undefined>("readonly", (s) => s.get(fingerprint))
export const writeResume = (record: ResumeRecord) => run("readwrite", (s) => s.put(record))
export const deleteResume = (fingerprint: string) => run("readwrite", (s) => s.delete(fingerprint))
export const listResume = async () => (await run<ResumeRecord[]>("readonly", (s) => s.getAll())) ?? []

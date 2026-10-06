// 프로덕션(Neon) 주소로 바꿔 다는 일. kakao.ts 와 redact.ts 가 함께 쓴다.
// Prisma 는 만들어질 때 DATABASE_URL 을 읽으므로, kakao-common 을 불러오기 **전에** 불러야 한다.
import { existsSync, readFileSync } from "fs"

/** 운영 첨부 저장 위치 (NAS). 로컬 .env 는 `…/_dev/files` 다. */
export const PROD_ATTACHMENT_BASE = "/HADD Science/옴니스 첨부파일/files"

/** .env.production.local 의 Neon 주소로 바꿔 단다. 스냅샷 스크립트와 같은 파일을 읽는다. */
export function pointAtProd() {
  const f = ".env.production.local"
  if (!existsSync(f)) throw new Error(`${f} 이 없다 — vercel env pull 로 받으세요`)
  const env = Object.fromEntries(
    readFileSync(f, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")] }),
  )
  const url = env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL
  if (!url || !url.includes("neon.tech")) throw new Error("프로덕션 DB 주소가 Neon 이 아니다. 중단.")
  process.env.DATABASE_URL = url
  // 첨부·임베딩도 프로덕션의 NAS·Gemini 키를 쓴다.
  for (const k of ["SYNOLOGY_WEBDAV_URL", "SYNOLOGY_WEBDAV_USER", "SYNOLOGY_WEBDAV_PASSWORD", "SYNOLOGY_WEBDAV_BASE_PATH", "SYNOLOGY_TLS_FINGERPRINT", "GEMINI_API_KEY"]) {
    if (env[k]) process.env[k] = env[k]
  }
  // 첨부 저장 위치는 Vercel 에서 민감 변수라 .env.production.local 로 내려오지 않는다. 그러면 Prisma 가 읽어 둔
  // 로컬 .env 의 `_dev/files` 가 남아, 운영 DB 에 기록하면서 실물은 개발 폴더에 올린다 — 화면에서는 500.
  // 같은 사고가 세 번 났다(9/7 홈페이지 사진 · 9/14 서명 · 10/6 카톡 첨부 1,348개). 운영 경로로 못박는다.
  process.env.SYNOLOGY_WEBDAV_BASE_PATH = env.SYNOLOGY_WEBDAV_BASE_PATH || PROD_ATTACHMENT_BASE
  if (process.env.SYNOLOGY_WEBDAV_BASE_PATH.includes("_dev")) throw new Error("운영 대상인데 첨부 경로가 _dev 다. 중단.")
  return url.replace(/:\/\/[^@]+@/, "://***@").split("?")[0]
}

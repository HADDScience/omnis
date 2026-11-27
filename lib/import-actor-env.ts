// 부수 효과 모듈 — import 하는 순간 .env 를 읽고 DATABASE_URL 에 「쓴 쪽 = source」 를 단다.
// 이식 스크립트는 이것을 **prisma 를 들이는 어떤 import 보다 먼저** 둔다(lib/db 가 만들어질 때 주소를 읽는다).
//   import "@/lib/import-actor-env"
//   import { prisma } from "@/lib/db"
// 자세한 까닭: lib/import-actor.ts
import "dotenv/config"
import { applySourceActor } from "./import-actor"

const host = applySourceActor()
console.log(`쓴 쪽 표시: ${host} 연결에 omnis.actor_kind=source`)

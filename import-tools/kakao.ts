// 카카오톡 대화 이식 CLI — CSV 를 주면 옴니스까지 한 번에 간다.
//
//   npm run kakao -- ~/Downloads/KakaoTalk_Chat_*.csv
//   npm run kakao -- <csv> --media ~/Downloads/카톡첨부        첨부 실물도 붙인다 (그 CSV 의 방에만)
//   npm run kakao -- <csv...> --media DIR --media-room 방이름  CSV 가 여럿이면 첨부 폴더의 방을 정한다
//   npm run kakao -- <csv...> --dry                          쓰지 않고 무엇을 할지만 본다
//   npm run kakao -- <csv...> --target prod                  프로덕션(Neon)에 적용
//
// 단계: 수집 → 분류(Claude 병렬) → 메시지 → 구조화(Claude 순차) → 첨부 → 임베딩
// 모든 단계가 멱등이다. 같은 CSV 를 두 번 주면 두 번째는 아무것도 하지 않는다.
// 중간에 끊기면 다시 돌리면 이어진다 — 각 단계가 "아직 안 된 것" 만 고르기 때문이다.
//
// 원본 데이터(세션·분류·라운드 입출력)는 KAKAO_DATA_DIR (기본 ~/work/omnis-import) 에 쌓인다.
// 실제 사내 대화라 저장소에는 넣지 않는다.
import { existsSync } from "fs"
import { pointAtProd } from "./prod-env"

interface Args {
  csv: string[]; media: string | null; mediaRoom: string | null; dry: boolean; target: "local" | "prod"
  noEmbed: boolean; noStructure: boolean; workers: number; classifyModel: string; structureModel: string
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    csv: [], media: null, mediaRoom: null, dry: false, target: "local", noEmbed: false, noStructure: false,
    workers: 4, classifyModel: "sonnet", structureModel: "opus",
  }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--media") a.media = argv[++i]
    else if (v === "--media-room") a.mediaRoom = argv[++i]
    else if (v === "--dry") a.dry = true
    else if (v === "--target") a.target = argv[++i] === "prod" ? "prod" : "local"
    else if (v === "--no-embed") a.noEmbed = true
    else if (v === "--no-structure") a.noStructure = true
    else if (v === "--workers") a.workers = Number(argv[++i]) || 4
    else if (v === "--classify-model") a.classifyModel = argv[++i]
    else if (v === "--structure-model") a.structureModel = argv[++i]
    else if (v.startsWith("--")) throw new Error(`모르는 옵션: ${v}`)
    else a.csv.push(v)
  }
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.csv.length === 0) {
    console.log("사용법: npm run kakao -- <KakaoTalk_Chat_*.csv ...> [--media DIR [--media-room 방]] [--dry] [--target prod] [--no-embed] [--no-structure]")
    process.exit(1)
  }
  for (const f of args.csv) if (!existsSync(f)) throw new Error(`파일 없음: ${f}`)
  // 첨부 폴더는 한 방의 것이다. 시각으로 짝을 맞추므로 다른 방의 같은 시각 사진에 붙으면 안 된다.
  if (args.media && !args.mediaRoom && args.csv.length > 1) throw new Error("CSV 가 여럿이면 --media-room 으로 첨부 폴더의 방을 정하세요")

  const where = args.target === "prod" ? pointAtProd() : (process.env.DATABASE_URL ?? "(.env)").replace(/:\/\/[^@]+@/, "://***@")
  console.log(`대상 DB: ${args.target === "prod" ? "🔴 프로덕션" : "로컬"} ${where}${args.dry ? "  (--dry: 쓰지 않음)" : ""}\n`)

  // 환경변수를 정한 뒤에 불러야 Prisma 가 그 주소로 붙는다.
  const { prisma } = await import("./kakao-common")
  const { ingest } = await import("./steps/ingest")
  const { classify } = await import("./steps/classify")
  const { importMessages } = await import("./steps/messages")
  const { structure } = await import("./steps/structure")
  const { attachMedia } = await import("./steps/media")
  const { embed } = await import("./steps/embed")

  const t0 = Date.now()
  const step = (n: number, title: string) => console.log(`\n${n}/6 ${title}`)

  step(1, "수집 — CSV 읽기 · 세션 자르기")
  const { sessions, rooms } = ingest(args.csv)

  step(2, "분류 — 업무 / 정보공유 / 잡담 / 빈껍데기")
  const c = await classify(sessions, { model: args.classifyModel, workers: args.workers, dry: args.dry })

  step(3, "메시지 — 옴니스 채팅으로")
  await importMessages(sessions, { dry: args.dry })

  step(4, "구조화 — 업무 카드")
  if (args.noStructure) console.log("  --no-structure 로 건너뜀")
  else if (c.failed.length > 0 && !args.dry) console.log(`  분류 실패 ${c.failed.length}세션은 이번 라운드에 안 들어간다`)
  const s = args.noStructure ? { created: 0 } : await structure(sessions, { model: args.structureModel, dry: args.dry })

  step(5, "첨부 — 실물 파일 붙이기")
  const mediaRoom = args.mediaRoom ?? [...rooms.keys()][0]
  if (args.media) console.log(`  첨부 폴더의 방: ${mediaRoom}`)
  if (args.media) await attachMedia(sessions.filter((x) => x.room === mediaRoom), args.media, { dry: args.dry })
  else console.log("  --media 가 없어 건너뜀 (카톡 채팅방 서랍에서 저장한 폴더를 주면 붙는다)")

  step(6, "임베딩 — 옴니스 AI 색인")
  if (args.noEmbed) console.log("  --no-embed 로 건너뜀")
  else await embed({ dry: args.dry })

  const [msgs, tasks] = await Promise.all([
    prisma.chatMessage.count({ where: { sourceId: { startsWith: "kakao:" } } }),
    prisma.task.count({ where: { sourceId: { startsWith: "kakao-task:" } } }),
  ])
  console.log(`\n끝 — ${Math.round((Date.now() - t0) / 1000)}초 · 이식된 메시지 ${msgs}건 · 업무 카드 ${tasks}건 (이번에 +${s.created})`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("\n실패:", e instanceof Error ? e.message : e)
  process.exit(1)
})

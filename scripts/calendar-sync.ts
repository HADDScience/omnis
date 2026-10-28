/**
 * 웍스 캘린더를 지금 한 번 당긴다. 화면이 부르는 `POST /api/calendar/sync` 와 같은 함수다.
 *
 * 웍스에는 읽기 요청(PROPFIND · REPORT)만 보낸다. 쓰는 곳은 옴니스 DB 뿐이다.
 * 앱 비밀번호는 파일에 두지 않는다 — 실행할 때 키체인에서 환경변수로만 넘긴다:
 *
 *   CALDAV_HOME_URL=https://caldav.worksmobile.com/rl/…/calendar/ \
 *   CALDAV_USERNAME=jwoochang@haddscience.com \
 *   CALDAV_PASSWORD="$(security find-generic-password -s works-imap -a jwoochang@haddscience.com -w)" \
 *   CALDAV_CALENDARS="Hadd Science,대표님 일정,바이오아이코어 2026" \
 *   npx tsx scripts/calendar-sync.ts [--force]
 *
 * --force    ctag 가 같아도, 60초 안이어도 처음부터 다시 받는다(토큰 없이)
 *
 * localhost 가 아닌 DB 에는 `--prod` 를 붙여야 돈다. 운영 DB 에 잘못 붙는 사고가 있었다
 * (mydocs/troubleshootings/pr-traps-2026-09.md).
 */
import "dotenv/config"
import { prisma } from "../lib/db"
import { syncWorksCalendars } from "../lib/caldav/sync"

async function main() {
  const target = new URL(process.env.DATABASE_URL!)
  console.log(`DB: ${target.hostname}`)
  if (!["localhost", "127.0.0.1"].includes(target.hostname) && !process.argv.includes("--prod")) {
    console.error("localhost 가 아니다. 운영에 돌리려면 --prod 를 붙인다")
    process.exit(1)
  }

  const started = Date.now()
  const report = await syncWorksCalendars({ force: process.argv.includes("--force") })
  console.log(JSON.stringify(report, null, 2))
  console.log(`${Date.now() - started}ms`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

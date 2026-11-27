// 이식 스크립트의 DB 연결에 「쓴 쪽 = source(이식)」 표시를 단다 — 공통 층 P4 의 트리거가 이 값을 읽는다.
// 계획: mydocs/plans/2026-11-27-ontology-phase1.md §2-3 · P11(이 한 줄만 P4 보다 먼저 넣었다)
//
// 트리거는 current_setting('omnis.actor_kind', true) 로 쓴 쪽을 가른다. 값이 없으면 screen(맞춤 화면 = 사람)이다.
// 이식이 screen 으로 찍히면 나중에 사람 손질 보호(humanTouched)가 이식 값을 사람 값으로 지킨다.
//
// 연결 주소의 options 로 건다(-c omnis.actor_kind=source). 연결이 끊겨 다시 붙어도 값이 따라온다 — SET 한 번은 끊기면 사라진다.
// Neon 풀러(-pooler)는 이 startup 값을 거절한다(2026-11-27 실측: 「unsupported startup parameter in options」).
// 그래서 풀러 주소면 POSTGRES_URL_NON_POOLING(직결)로 바꾸고, 그것도 없으면 멈춘다.
//
// 데이터 · 순수 함수만 둔다(prisma 를 들이지 않는다). 쓰는 법: 스크립트 맨 위에서 import "@/lib/import-actor-env"
// 시험: lib/import-actor.test.ts

export const ACTOR_SETTING = "omnis.actor_kind"
export const SOURCE_ACTOR = "source"

/** Neon 풀러 주소인가 — 호스트에 -pooler 가 붙는다 */
export function isNeonPooler(url: string): boolean {
  try {
    return /-pooler\./.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** 주소에 options=-c omnis.actor_kind=source 를 붙인다. 이미 options 가 있으면 뒤에 잇고, 같은 값이 있으면 그대로 둔다 */
export function withSourceActor(url: string): string {
  if (isNeonPooler(url)) throw new Error("Neon 풀러 주소에는 쓴 쪽 표시를 달 수 없다 — POSTGRES_URL_NON_POOLING(직결)을 쓴다")
  const u = new URL(url)
  const flag = `-c ${ACTOR_SETTING}=${SOURCE_ACTOR}`
  const prev = u.searchParams.get("options")
  if (prev?.includes(`${ACTOR_SETTING}=`)) {
    if (!prev.includes(flag)) throw new Error(`연결 주소에 다른 ${ACTOR_SETTING} 값이 있다`)
    return url
  }
  u.searchParams.set("options", prev ? `${prev} ${flag}` : flag)
  return u.toString()
}

/**
 * 이식 스크립트가 쓸 연결 주소 — DATABASE_URL 이 풀러면 POSTGRES_URL_NON_POOLING 으로 바꾼 뒤 표시를 단다.
 * env.DATABASE_URL 을 바꾼다(Prisma 는 클라이언트를 만들 때 이것을 읽는다). 돌려주는 값은 호스트(찍어 보기용).
 */
export function applySourceActor(env: Record<string, string | undefined> = process.env): string {
  let url = env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL 이 없다")
  if (isNeonPooler(url)) {
    const direct = env.POSTGRES_URL_NON_POOLING
    if (!direct || isNeonPooler(direct)) throw new Error("DATABASE_URL 이 Neon 풀러인데 POSTGRES_URL_NON_POOLING(직결)이 없다 — 이식은 직결로만 돈다")
    url = direct
  }
  env.DATABASE_URL = withSourceActor(url)
  return new URL(url).hostname
}

/** 연결이 정말 source 로 붙었는지 — 스크립트 main 첫 줄에서 부른다. 아니면 아무것도 쓰기 전에 멈춘다 */
export async function assertSourceActor(db: { $queryRawUnsafe<T = unknown>(q: string): Promise<T> }): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ k: string | null }[]>(`select current_setting('${ACTOR_SETTING}', true) as k`)
  const got = rows[0]?.k ?? null
  if (got !== SOURCE_ACTOR) throw new Error(`이식 연결의 ${ACTOR_SETTING} 가 ${JSON.stringify(got)} 다 — source 가 아니면 쓰지 않는다`)
}

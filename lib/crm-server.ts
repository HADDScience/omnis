import { Prisma } from "@/generated/prisma"

/**
 * ORG001 · CT001 · HADD260904-001 같은 코드는 "지금까지의 최대값 + 1" 로 만든다.
 * 읽고 쓰는 사이가 열려 있어서, 두 사람이 동시에 만들면 같은 번호를 노린다.
 *
 * DB 의 unique 제약이 그 충돌을 막아 주므로 — 막힌 쪽만 번호를 다시 뽑아 재시도한다.
 * 테이블 잠금보다 싸고, 실패해도 잘못된 번호가 저장되지는 않는다.
 *
 * (실제로 났던 일이다: 만들기 버튼이 두 번 눌려 둘 다 ORG024 를 시도했고
 *  한쪽이 500 으로 떨어졌다.)
 */
export async function createWithUniqueCode<T>(
  attempt: () => Promise<T>,
  maxTries = 5
): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < maxTries; i++) {
    try {
      return await attempt()
    } catch (e) {
      const collided =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        (e.meta?.target as string[] | undefined)?.includes("code")
      if (!collided) throw e
      lastError = e
    }
  }
  throw lastError
}

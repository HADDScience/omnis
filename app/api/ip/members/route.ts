import { NextRequest } from "next/server"

import { prisma } from "@/lib/db"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * 지식재산권 구성원 관리.
 *
 * 셀프 가입(access_requests)은 없앴다. 계정을 관리자가 만드는 Omnis 계정 하나로
 * 모으면서, 누구인지 확인하는 절차가 계정 발급 시점으로 앞당겨졌기 때문이다.
 * 여기서 하는 일은 "이미 있는 Omnis 계정에게 지식재산권 접근을 준다"뿐이다.
 *
 * 구성원 목록은 아무 구성원이나 볼 수 있다 — 같이 일하는 사람이 누구인지는
 * 가릴 것이 아니다. 바꾸는 것은 owner 만 한다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response

  const members = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT m.user_id, m.email, m.display_name, m.role, m.created_at, u.name AS omnis_name
      FROM ip.members m JOIN public."User" u ON u.id = m.user_id
     ORDER BY m.created_at`

  // owner 만 "누구를 더 넣을 수 있는지"를 본다. 아직 구성원이 아닌 Omnis 계정 목록이다.
  const candidates =
    auth.caller.membership.role === "owner"
      ? await prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT u.id, u.name, u.email, u.department, u.position
            FROM public."User" u
           WHERE u."isActive" = true
             AND NOT EXISTS (SELECT 1 FROM ip.members m WHERE m.user_id = u.id)
           ORDER BY u.name`
      : []

  return ok({ members, candidates, me: auth.caller.membership }, auth.cors)
}

/** 구성원 추가·역할 변경·해제. owner 만. */
export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response
  if (auth.caller.membership.role !== "owner") {
    return bad("구성원 관리는 관리자만 할 수 있습니다", auth.cors, 403)
  }

  const input = await body<{ userId: string; role: "owner" | "editor" | "viewer" | null }>(req)
  if (!input?.userId) return bad("userId 가 필요합니다", auth.cors)

  // 마지막 관리자를 내리면 아무도 구성원을 관리할 수 없게 된다.
  if (input.role !== "owner") {
    const owners = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM ip.members WHERE role = 'owner'`
    const isLastOwner =
      Number(owners[0].n) <= 1 &&
      (
        await prisma.$queryRaw<{ role: string }[]>`
          SELECT role FROM ip.members WHERE user_id = ${input.userId}`
      )[0]?.role === "owner"
    if (isLastOwner) {
      return bad("마지막 관리자는 내릴 수 없습니다. 다른 사람을 먼저 관리자로 올리세요.", auth.cors, 409)
    }
  }

  if (input.role === null) {
    await prisma.$executeRaw`DELETE FROM ip.members WHERE user_id = ${input.userId}`
    return ok({ ok: true }, auth.cors)
  }

  // email·display_name 은 Omnis 계정에서 가져온다. 사람이 두 번 적을 이유가 없다.
  const user = (
    await prisma.$queryRaw<{ id: string; name: string; email: string | null }[]>`
      SELECT id, name, email FROM public."User"
       WHERE id = ${input.userId} AND "isActive" = true`
  )[0]
  if (!user) return bad("없거나 비활성인 계정입니다", auth.cors, 404)

  await prisma.$executeRaw`
    INSERT INTO ip.members (user_id, email, display_name, role)
    VALUES (${user.id}, ${user.email ?? `${user.name}@haddscience.com`}, ${user.name}, ${input.role})
    ON CONFLICT (user_id) DO UPDATE
      SET role = ${input.role}, display_name = ${user.name}`
  return ok({ ok: true }, auth.cors)
}

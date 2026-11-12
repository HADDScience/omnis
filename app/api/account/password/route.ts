import { NextRequest, NextResponse } from "next/server"
import { compare, hash } from "bcryptjs"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError, parseJson } from "@/lib/api"
import { clientIp, loginLockState, recordLoginFailure } from "@/lib/login-guard"
import { passwordProblem } from "@/lib/password-policy"
import { PASSWORD_ENTITY, passwordNoticeFor } from "@/lib/password-state"

/**
 * 본인 비밀번호 변경. 대상은 언제나 세션의 계정이다 — 본문으로 사람을 고를 수 없다.
 *
 * 지금 비밀번호를 다시 받는다. 열려 있는 세션만 가진 사람이 비밀번호를 바꿔 계정을
 * 차지하지 못하게 하려는 것이다. 틀리면 로그인 실패와 같이 세고 같은 잠금을 따른다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const body = await parseJson<{ current?: unknown; next?: unknown }>(req)
  const current = typeof body?.current === "string" ? body.current : ""
  const next = typeof body?.next === "string" ? body.next : ""
  // 로그인 코드로 막 들어온 사람은 지금 비밀번호를 모른다 — 메일로 본인임을 보였으니 새 비밀번호만 받는다
  const mustSet = (await passwordNoticeFor(session.user.id)).mustSet
  if (!next || (!mustSet && !current)) return apiError(400, "지금 비밀번호와 새 비밀번호를 모두 입력하세요.")

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, isActive: true },
    select: { id: true, name: true, passwordHash: true },
  })
  if (!user) return apiError(401, "인증 필요")

  const ip = clientIp(req.headers)
  if ((await loginLockState(user.name, ip)).locked) {
    return apiError(429, "시도가 너무 많아 잠시 막혔습니다. 15분 뒤 다시 시도하세요.")
  }
  if (!mustSet && !(await compare(current, user.passwordHash))) {
    await recordLoginFailure(user.name, ip)
    return apiError(400, "지금 비밀번호가 올바르지 않습니다.")
  }

  const problem = passwordProblem(next, mustSet ? undefined : current)
  if (problem) return apiError(400, problem)

  const passwordHash = await hash(next, 10)
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.activityLog.create({
      data: { userId: user.id, entity: PASSWORD_ENTITY, entityId: user.id, action: "changed", title: "비밀번호 변경" },
    }),
  ])
  return NextResponse.json({ success: true })
}

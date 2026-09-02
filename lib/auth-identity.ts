// 자체 계정(User)에 소셜 로그인을 붙이고 떼는 규칙.
//
// 설계 원칙: 계정의 주인은 언제나 User 다. 소셜은 "그 계정으로 들어오는 또 하나의 문"이며,
// 문이 없어져도(제공자 서비스 종료, 회사 도구 교체) 계정과 업무 데이터는 남는다.
//
// 콜백 안에 로직을 두면 실제 OAuth 왕복 없이는 검증할 수 없으므로 여기로 분리했다.
import { prisma } from "./db"

export interface SocialAccount {
  /** "google" | "kakao" */
  provider: string
  /** 제공자가 발급한 불변 식별자 (구글 sub, 카카오 회원번호) */
  providerAccountId: string
  email?: string | null
}

export interface ResolvedUser {
  id: string
  name: string
  email: string | null
  role: string
}

/**
 * 이 소셜 계정에 연결된 자체 계정을 찾는다.
 *
 * - 연결된 적 없으면 null → 호출부가 "먼저 연결하세요"로 보낸다
 * - 비활성 계정이면 null → 퇴사자가 남은 소셜로 들어오지 못한다
 */
export async function resolveIdentity(account: SocialAccount): Promise<ResolvedUser | null> {
  const identity = await prisma.userIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    select: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
  })

  if (!identity || !identity.user.isActive) return null
  const { isActive: _ignored, ...user } = identity.user
  return user
}

export type LinkResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "already-linked" }

/**
 * 로그인된 계정에 소셜을 연결한다.
 *
 * 호출부는 반드시 **세션으로 계정 소유가 증명된 뒤**에만 불러야 한다.
 * 소셜 이메일로 사람을 짐작해 묶지 않는 이유는 두 가지다 —
 * 개인 지메일·카카오 이메일은 회사 계정과 다르고, 카카오는 이메일이 선택 동의라
 * 아예 없을 수 있다. 세션을 앞세우면 남의 계정에 붙이려면 그 사람의 세션이
 * 필요해지므로 원리적으로 막힌다.
 */
export async function linkIdentity(userId: string, account: SocialAccount): Promise<LinkResult> {
  const existing = await prisma.userIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    select: { userId: true },
  })

  if (existing) {
    // 이미 내 계정에 붙어 있으면 성공으로 본다 (같은 버튼을 두 번 눌렀을 뿐)
    return existing.userId === userId ? { ok: true } : { ok: false, reason: "taken" }
  }

  try {
    await prisma.userIdentity.create({
      data: {
        userId,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email: account.email ?? null,
      },
    })
    return { ok: true }
  } catch (err) {
    // 같은 사람이 같은 제공자를 두 번 붙이려 한 경우 (userId+provider 유니크 위반)
    if ((err as { code?: string }).code === "P2002") return { ok: false, reason: "already-linked" }
    throw err
  }
}

/**
 * 연결을 해제한다.
 *
 * 자체 계정에는 항상 비밀번호가 있으므로 소셜을 모두 떼도 들어올 길이 남는다.
 * 그래서 "마지막 수단은 해제 불가" 같은 제약을 두지 않는다.
 */
export async function unlinkIdentity(userId: string, provider: string): Promise<boolean> {
  const { count } = await prisma.userIdentity.deleteMany({ where: { userId, provider } })
  return count > 0
}

/** 설정 화면에 보여줄, 이 사람이 연결해 둔 수단 목록. */
export async function listIdentities(userId: string) {
  return prisma.userIdentity.findMany({
    where: { userId },
    select: { provider: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })
}

/**
 * 표시용 이메일을 채워 넣는다.
 *
 * 연결 시점에 제공자가 이메일을 안 줄 수 있다 (카카오는 이메일이 선택 동의라
 * 동의항목을 나중에 켜면 그때부터 들어온다). 로그인할 때마다 값이 새로 생겼거나
 * 바뀌었으면 갱신해, 설정 화면에서 "어느 계정을 연결했는지" 알아볼 수 있게 한다.
 *
 * 이 값은 화면 표시 전용이다 — 사람 식별은 providerAccountId 로만 한다.
 */
export async function rememberIdentityEmail(account: SocialAccount): Promise<void> {
  if (!account.email) return
  await prisma.userIdentity.updateMany({
    where: {
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      NOT: { email: account.email },
    },
    data: { email: account.email },
  })
}

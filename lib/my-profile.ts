/**
 * 마이 화면 위 프로필 카드 · 프로필 설정 화면이 보이는 내 정보. 순수 부분은 profile-title.ts — 시험: profile-title.test.ts
 */
import { prisma } from "./db"
import { profileTitle, socialProviders } from "./profile-title"

export interface MyProfile {
  name: string
  email: string | null
  /** 직급 — 인력 표(StaffProfile)의 직급. 없으면 null(카드에 비워 둔다) */
  title: string | null
  /** 연결된 소셜 로그인 — 연결된 것만, 정해진 순서로 */
  social: ("google" | "kakao")[]
}

export async function loadMyProfile(userId: string): Promise<MyProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      staffProfile: { select: { position: true, haddRole: true } },
      identities: { select: { provider: true } },
    },
  })
  if (!user) return null
  return {
    name: user.name,
    email: user.email,
    title: profileTitle(user.staffProfile),
    social: socialProviders(user.identities.map((i) => i.provider)),
  }
}

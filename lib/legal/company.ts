/**
 * 약관 · 개인정보 처리방침에 들어가는 회사 정보 — DB 의 회사 기본정보(CompanyProfile)와 대표(StaffProfile, CEO)에서 읽는다.
 * 저장소가 공개라 회사 이름 · 주소를 코드에 적지 않는다. 데모 빌드에는 데모 시드의 익명 회사가 보인다.
 */
import { prisma } from "@/lib/db"

export interface LegalCompany {
  name: string
  nameEn: string | null
  representative: string | null
  bizRegNo: string | null
  address: string | null
  homepage: string | null
}

/** 약관 · 처리방침을 고쳐 시행하는 날. 고치면 이 값과 각 문서의 「바뀐 내용」 을 함께 고친다 */
export const LEGAL_EFFECTIVE_DATE = "2026년 11월 11일"

export async function loadLegalCompany(): Promise<LegalCompany> {
  const [profile, ceo] = await Promise.all([
    prisma.companyProfile.findFirst({ select: { nameKo: true, nameEn: true, bizRegNo: true, hqAddress: true, homepage: true } }),
    prisma.staffProfile.findFirst({
      where: { employment: "EMPLOYED", OR: [{ haddRole: "CEO" }, { position: "대표" }] },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    }),
  ])
  return {
    name: profile?.nameKo ?? "회사",
    nameEn: profile?.nameEn ?? null,
    representative: ceo?.name ?? null,
    bizRegNo: profile?.bizRegNo ?? null,
    address: profile?.hqAddress ?? null,
    homepage: profile?.homepage ?? null,
  }
}

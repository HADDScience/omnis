import { z } from "zod"

import { prisma } from "@/lib/db"
import { LANGS } from "@/lib/schemas/website"
import { INQUIRY_TOPICS, type InquiryTopic } from "@/lib/website-inquiry-labels"

/**
 * 홈페이지 문의 — 받는 쪽의 규칙.
 *
 * 계약의 정본은 mydocs/plans/2026-09-22-website-inquiry-to-crm.md 다.
 * 사이트(hadd-website)의 `app/api/contact/route.ts` 가 서버 간 호출로 이걸 부른다.
 *
 * 값의 이름표(유형·상태)는 `lib/website-inquiry-labels.ts` 에 있다 — 이 파일은 prisma 를
 * import 해서 클라이언트 컴포넌트가 가져올 수 없다.
 */

/** 빈 문자열은 "안 적었다" 로 본다 — 사이트의 선택 입력은 비면 "" 로 온다. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null)

export const inquiryIntakeSchema = z.object({
  name: z.string().trim().min(1, "이름이 없습니다").max(100),
  organization: optionalText(200),
  email: z.string().trim().email("이메일 형식이 아닙니다").max(200),
  phone: optionalText(50),
  topic: z.enum(Object.keys(INQUIRY_TOPICS) as [InquiryTopic, ...InquiryTopic[]]),
  message: z.string().trim().min(1, "내용이 없습니다").max(5000),
  lang: z.enum(LANGS).default("ko"),
  ip: optionalText(100),
  userAgent: optionalText(500),
})

export type InquiryIntake = z.infer<typeof inquiryIntakeSchema>

// ─── 레이트리밋 ────────────────────────────────────────────

/**
 * 레이트리밋 인프라가 없어 표를 직접 센다.
 *
 * **status 를 가리지 않고 센다.** SPAM 으로 표시하는 순간 공격자의 한도가 되살아나면
 * 막는 의미가 없다.
 *
 * **ip 가 없으면 IP 한도를 건너뛴다.** null 을 한 칸으로 묶으면 IP 를 못 넘긴 요청
 * 전체가 서로를 막는다 — 사이트가 `x-forwarded-for` 를 못 읽은 환경에서 문의가
 * 통째로 잠긴다. 이메일 한도는 그대로 적용된다.
 */
export const RATE_LIMITS = {
  ip: { max: 3, windowMs: 10 * 60 * 1000 },
  email: { max: 5, windowMs: 24 * 60 * 60 * 1000 },
} as const

export async function isRateLimited(email: string, ip: string | null): Promise<boolean> {
  const now = Date.now()

  if (ip) {
    const recent = await prisma.websiteInquiry.count({
      where: { ip, createdAt: { gte: new Date(now - RATE_LIMITS.ip.windowMs) } },
    })
    if (recent >= RATE_LIMITS.ip.max) return true
  }

  const byEmail = await prisma.websiteInquiry.count({
    where: {
      email: { equals: email, mode: "insensitive" },
      createdAt: { gte: new Date(now - RATE_LIMITS.email.windowMs) },
    },
  })
  return byEmail >= RATE_LIMITS.email.max
}

// ─── 중복 접수 ─────────────────────────────────────────────

/**
 * 사이트가 타임아웃 뒤 재시도하면 앞 요청이 저장됐는지 알 수 없다. 폼 더블클릭도 같다.
 * 같은 이메일 + 같은 내용이 창 안에 있으면 새로 만들지 않고 그 행을 돌려준다.
 */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000

export async function findDuplicate(email: string, message: string) {
  return prisma.websiteInquiry.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      message,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
}

// ─── 알림 수신자 ───────────────────────────────────────────

/**
 * 영업 담당과 대표. 작업지시자 확정(2026-09-22).
 *
 * 부서 이름으로 찾는 방식은 세금계산서 발행 요청과 같다
 * (`app/api/crm/quotes/[quoteId]/route.ts` 의 `department contains "재무"`).
 * 대표는 부서가 「경영진」 이라 직급으로 잡는다 — `position` 에 CEO 가 들어간다.
 *
 * 둘 다 비면 ADMIN 전원으로 떨어진다. 부서·직급을 고치다 아무에게도 가지 않는 것이
 * 가장 나쁘다 — 문의가 조용히 쌓인다.
 */
export async function inquiryRecipientIds(): Promise<string[]> {
  const targeted = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ department: { contains: "영업" } }, { position: { contains: "CEO" } }],
    },
    select: { id: true },
  })
  if (targeted.length) return targeted.map((u) => u.id)

  const admins = await prisma.user.findMany({
    where: { isActive: true, role: "ADMIN" },
    select: { id: true },
  })
  return admins.map((u) => u.id)
}

// ─── 검토 ──────────────────────────────────────────────────

/**
 * 승인 — 이미 골라 둔 기관·담당자에 DRAFT 견적을 연다.
 *
 * 기관·담당자를 **여기서 만들지 않는다.** 화면이 견적·샘플과 같은 EntityPicker 를 쓰고,
 * 없는 이름은 그 자리에서 `/api/crm/orgs`·`/api/crm/contacts` 로 만들어 둔 다음 id 로 넘어온다.
 * CRM 이 이미 쓰는 길을 두고 이 경로만 따로 만들 이유가 없다.
 *
 * `lib/crm.ts` 의 `quoteCreateSchema` 는 쓰지 않는다. 그쪽은 `items.min(1)` 이라 품목 0개를
 * 막는데, 여기서 만드는 견적은 **품목이 비어 있는 것이 정상**이다 — 무엇을 얼마에 줄지는
 * 담당자가 문의를 읽고 채운다. 손으로 쓰는 견적에 빈 품목을 허용할 이유는 없으므로
 * 저쪽은 그대로 둔다.
 */
export const inquiryAcceptSchema = z.object({
  orgId: z.string().uuid(),
  /** 담당자는 건너뛸 수 있다 — 견적이 그렇다 */
  contactId: z.string().uuid().nullish(),
  note: z.string().trim().max(2000).optional(),
})

export const inquiryRejectSchema = z.object({
  status: z.enum(["REJECTED", "SPAM"]),
  reviewNote: z.string().trim().max(2000).optional(),
})

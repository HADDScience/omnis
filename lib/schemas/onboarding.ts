import { z } from "zod"

export const onboardingActionSchema = z
  .object({
    phase: z.enum(["video", "complete"]),
  })
  .strict()

export const onboardingStateSchema = z.object({
  onboardingVideoSeenAt: z.string().datetime().nullable(),
  onboardingCompletedAt: z.string().datetime().nullable(),
})
export type OnboardingState = z.infer<typeof onboardingStateSchema>

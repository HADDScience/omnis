import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { sendPushToUser } from "@/lib/push"

/**
 * 자기 자신에게 시험 푸시를 보낸다.
 *
 * 이것이 없으면 "알림이 오는가"를 확인하려고 남이 업무를 지시해 줄 때까지 기다려야 한다.
 * 특히 iOS 는 홈 화면에 추가해야만 오기 때문에, 제대로 됐는지 그 자리에서 확인할 길이 필요하다.
 * 남에게는 보내지 못한다 — 자기 userId 로만 나간다.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const result = await sendPushToUser(session.user.id, {
    title: "Omnis 알림 시험",
    body: "이 알림이 보이면 이 기기는 준비된 것입니다.",
    tag: "omnis:test",
  })

  if (result.skipped === "unconfigured") {
    return NextResponse.json({ error: "서버에 푸시 키가 설정되지 않았습니다" }, { status: 503 })
  }
  if (result.sent === 0) {
    return NextResponse.json(
      { error: "보낼 구독이 없습니다. 알림을 다시 켜 보세요" },
      { status: 409 }
    )
  }
  return NextResponse.json(result)
}

// 시스템 계정 — AI 가 남기는 🤖 메시지(재구성·완료 확인 대기)의 작성자.
//
// 예전에는 `HADD MCP` 사용자를 찾고, 없으면 정렬 없이 첫 ADMIN 을 썼다. 그 계정이 어느 DB 에도 없어
// 관리자 중 DB 가 먼저 돌려준 사람(허채정·김아리 …)이 업무와 상관없이 「담당자 확인을 기다립니다」를
// 보낸 사람으로 찍혔다(2026-09-14).
//
// 로그인할 수 없게 둔다. isActive=false 라 로그인·SSO·구성원 목록이 걸러내고, passwordHash 는
// bcrypt 형식이 아니어서 어떤 비밀번호와도 맞지 않는다. id 가 "system" 인 것은 채팅 목록
// (components/chat/message-list.tsx)이 이미 그 id 를 시스템 메시지로 그리기 때문이다.
import { prisma } from "@/lib/db"

export const SYSTEM_USER_ID = "system"
export const SYSTEM_USER_NAME = "Omnis"

let ensured: Promise<string> | null = null

/** 없으면 만든다. 마이그레이션 없이 어느 DB 에서든 같은 계정이 생기고, 프로세스마다 한 번만 확인한다. */
export function getSystemUserId(): Promise<string> {
  ensured ??= prisma.user
    .upsert({
      where: { id: SYSTEM_USER_ID },
      update: {},
      create: {
        id: SYSTEM_USER_ID, name: SYSTEM_USER_NAME, passwordHash: "!", role: "MEMBER", isActive: false, position: "시스템",
      },
      select: { id: true },
    })
    .then((u) => u.id)
    .catch((e) => {
      ensured = null
      throw e
    })
  return ensured
}

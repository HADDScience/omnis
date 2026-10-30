"use client"

/**
 * 지식재산권 API 를 부르는 통로 — Omnis 안에 들어온 화면용.
 *
 * ip-platform 시절에는 다른 오리진(GitHub Pages)의 정적 앱이라 SSO 표를 받아
 * localStorage 에 두고 Authorization 헤더로 보냈다. 이제 화면이 Omnis 와 같은
 * 오리진이라 로그인 쿠키가 그대로 실린다 — 표 교환·저장·자동 진입이 전부 필요 없다.
 * 서버(lib/ip-api.ts 의 authorize)가 헤더가 없으면 쿠키 세션을 본다.
 *
 * 함수 모양(api · OmnisError · omnisMcpUrl · omnisSettingsUrl)은 예전 그대로 둬서
 * 화면 코드를 손대지 않는다.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export class OmnisError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

function messageFor(code: string): string {
  switch (code) {
    case "not_a_member":
      return "지식재산권 자료에 접근할 수 있는 계정이 아닙니다. 담당자에게 권한을 요청하세요."
    case "read_only":
      return "읽기 전용 권한입니다."
    case "unauthorized":
    case "no_token":
    case "invalid_session":
      return "로그인이 만료되었습니다. 새로고침해 다시 로그인해 주세요."
    default:
      return "요청을 처리하지 못했습니다. 다시 시도해 주세요."
  }
}

/**
 * Omnis 지식재산권 API 한 번.
 *
 * 실패를 빈 값으로 삼키지 않는다. 자료를 못 읽는 채로 화면만 그리면 사용자는
 * "비어 있다"고 읽는다 — 비어 있는 것과 못 읽는 것은 다르다.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${BASE_PATH}/api/ip${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => null)

  if (!res) throw new OmnisError("network", "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.")

  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) {
    const code = body?.error ?? (res.status === 401 ? "unauthorized" : "unknown")
    throw new OmnisError(code, messageFor(code))
  }
  return body as T
}

/** MCP 서버 주소. 「AI 연결하기」 안내가 이 값을 그대로 보여준다. */
export function omnisMcpUrl(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}${BASE_PATH}/api/ip-mcp`
}

/** 계정 설정 — 비밀번호·소셜 연결은 저기서 관리한다. */
export function omnisSettingsUrl(): string {
  return `${BASE_PATH}/settings`
}

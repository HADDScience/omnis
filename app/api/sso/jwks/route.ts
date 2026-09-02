import { NextResponse } from "next/server"

import { publicJwks } from "@/lib/sso"

/**
 * SSO 토큰 서명에 쓰는 공개키.
 *
 * 지금 허브는 /api/sso/verify 로 검증을 맡기므로 이 엔드포인트가 없어도 돈다.
 * 그래도 열어 두는 이유는, 우리 엔드포인트를 거치지 않고 토큰을 스스로 검증해야
 * 하는 소비자가 생기기 때문이다 — 대표적으로 외부 DB(Supabase 등)에 Omnis 토큰을
 * 신뢰시키려면 표준 JWKS 주소가 필요하다. 대칭키(HS256)를 골랐다면 그 길이 막힌다.
 *
 * 공개키라 아무나 읽어도 된다 — 오히려 아무나 읽을 수 있어야 쓸모가 있다.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  const jwks = await publicJwks()
  return NextResponse.json(jwks, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      // 키는 자주 바뀌지 않는다. 회전하면 kid 가 달라지므로 캐시가 오해를 낳지 않는다.
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  })
}

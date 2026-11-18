import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { mergeProjects } from "@/lib/project-merge"

interface MergeBody {
  sourceId?: string
  targetId?: string
}

/**
 * 프로젝트 병합.
 *
 * 이름 정규화로는 "홈페이지 관리"와 "웹사이트 관리"를 같은 것으로 볼 수 없다
 * (실측: 프로젝트명 178종 중 71%가 자동 병합 불가 — 인수인계 §5-B-4).
 * 기계가 판단할 수 없는 나머지를 사람이 사후에 합치는 자리다.
 *
 * 원본은 지우지 않고 보관(archived) 처리한다. 업무만 대상 프로젝트로 옮긴다.
 * 업무의 `productId`는 건드리지 않는다 — 비어 있는 업무는 자연히 대상 프로젝트의
 * 제품을 따르고, 명시된 업무는 사용자가 정한 값이므로 유지된다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const body = await parseJson<MergeBody>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")

  const sourceId = body.sourceId?.trim()
  const targetId = body.targetId?.trim()
  if (!sourceId || !targetId) {
    return apiError(400, "sourceId, targetId 필수")
  }
  const result = await mergeProjects(sourceId, targetId, session.user.id)
  if (!result.ok) return apiError(result.status, result.error)
  return NextResponse.json(result)
}

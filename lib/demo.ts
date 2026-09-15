/** 시연용 데모 사이트인지. NEXT_PUBLIC_* 은 빌드 때 값이 박히므로 서버 · 클라 양쪽에서 쓸 수 있다.
 *  클라이언트 컴포넌트도 가져가므로 next/server 같은 서버 전용 모듈을 들이지 않는다. */
export const IS_DEMO = process.env.NEXT_PUBLIC_IS_DEMO === "true"

export const DEMO_STORAGE_MESSAGE = "시연용 데모에서는 파일 저장을 쓸 수 없습니다"

/** 데모에서 NAS 가 필요한 요청을 막는다. 데모가 아니면 null — 호출부는 그대로 진행한다. */
export function demoStorageBlocked(): Response | null {
  if (!IS_DEMO) return null
  return Response.json({ error: DEMO_STORAGE_MESSAGE }, { status: 403 })
}

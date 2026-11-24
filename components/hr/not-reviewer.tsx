import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

/** 채용 담당이 아닐 때 — 지원서가 있는지 · 몇 건인지도 보이지 않는다 */
export function NotReviewer() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
      <Empty className="rounded-xl border border-dashed" data-hr-denied>
        <EmptyHeader>
          <EmptyTitle>채용 담당만 볼 수 있습니다</EmptyTitle>
          <EmptyDescription>지원서에는 지원자의 연락처와 이력서가 있어, 관리자가 정한 채용 담당에게만 열려 있습니다.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

// 임시 저장소 → NAS 복사 한 건. 300MB 를 한 함수에 넣지 않고 단계로 나눈다 — 설계: mydocs/plans/2026-11-04-large-upload.md
//
// 이 파일은 Workflow 문맥(결정적 · Node 없음)에서 돈다. 저장소 · DB 는 전부 steps.ts 의 "use step" 함수다.
// 정본은 DB 의 FileTransfer 다. 실행이 사라지면 매일 크론이 새 실행으로 이어 간다(lib/large-upload/server.ts).
import { sleep } from "workflow"
import { runCopy } from "./copy-loop"
import { alertStep, claimCopySlot, copySegment, deleteTemp, failTransfer, loadCopyPlan, markVerified, markWaiting, probeNas, recordProgress, verifyWholeSize } from "./steps"

export async function copyToNasWorkflow(fileId: string) {
  "use workflow"
  const status = await runCopy({
    now: () => Date.now(),
    sleep: (ms) => sleep(ms),
    loadCopyPlan: () => loadCopyPlan(fileId),
    claimCopySlot: () => claimCopySlot(fileId),
    copySegment: (index, manifest) => copySegment(fileId, index, manifest),
    recordProgress: (done, manifest) => recordProgress(fileId, done, manifest),
    markWaiting: (done, manifest, reason) => markWaiting(fileId, done, manifest, reason),
    probeNas: () => probeNas(),
    verifyWholeSize: () => verifyWholeSize(fileId),
    markVerified: (done, manifest) => markVerified(fileId, done, manifest),
    failTransfer: (reason) => failTransfer(fileId, reason),
    alert: (reason) => alertStep(fileId, reason),
    deleteTemp: () => deleteTemp(fileId),
  })
  return { status }
}

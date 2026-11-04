// 복사 실패 · 대기 알림. 관리자 메일 하나로 보낸다
import { sendAlertMail } from "@/lib/alert-mail"
import { prisma } from "@/lib/db"

const MiB = 1024 * 1024

export async function alertTransfer(fileId: string, reason: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId }, select: { name: true, size: true } })
  // 파일 이름은 메일에만 적는다. 이슈 저장소가 공개라 이슈로 보내지 않는다
  await sendAlertMail(
    `[옴니스] 큰 첨부 복사 확인 필요: ${reason}`,
    `파일: ${file?.name ?? "(없음)"} (${file ? Math.round(file.size / MiB) : "?"}MB)\nID: ${fileId}\n사유: ${reason}\n\n임시본은 지우지 않았습니다.`,
  )
  await prisma.fileTransfer.updateMany({ where: { fileId }, data: { notifiedAt: new Date() } })
}

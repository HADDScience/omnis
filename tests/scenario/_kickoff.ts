import { type TestInfo, expect } from "@playwright/test"
import {
  type Actor,
  createTaskByCommand,
  expectThreadHas,
  markDone,
  replyInThread,
  respondNotification,
  say,
  waitForChat,
  waitForNotification,
  waitForTaskStatus,
} from "./_actors"

/**
 * 과제 킥오프 — 실제 도입 흐름을 4명이 동시에 밟는다. kickoff.spec.ts 에서 떼어 낸 본문이다.
 * 혼자서도 돌고(kickoff.spec.ts), 옴니스 AI 질의와 이어 붙여서도 돈다(full.spec.ts).
 *
 *   대표(허채정)   전체 지시 한 줄 → 팀장에게 업무로
 *   팀장(김아리)   수락 → 세부 업무 둘로 나눠 사원·과장에게 지시
 *   사원(정우창)   ┐ 각자 스레드에 진행·완료 보고 → 「완료로 표시」
 *   과장(노혜린)   ┘ (둘은 동시에 움직인다)
 *   팀장           둘의 완료를 받아 대표 업무 스레드에 취합 보고 → 완료 표시
 *   대표           「업무 완료」 알림 → 업무가 완료로 보인다
 */

export const CEO = "허채정"
export const LEAD = "김아리"
export const WORKER_A = "정우창"
export const WORKER_B = "노혜린"
export const CAST = [CEO, LEAD, WORKER_A, WORKER_B] as const

export interface KickoffCast {
  ceo: Actor
  lead: Actor
  woochang: Actor
  hyerin: Actor
}

export interface KickoffResult {
  tag: string
  ceoTask: { id: string; name: string; slug: string }
  taskA: { id: string; name: string; slug: string }
  taskB: { id: string; name: string; slug: string }
  /** 킥오프 전체에 걸린 시간(ms) */
  ms: number
}

export function newTag(): string {
  return new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")
}

export async function runKickoff({ ceo, lead, woochang, hyerin }: KickoffCast, tag: string, info: TestInfo): Promise<KickoffResult> {
  const t0 = Date.now()

  // ── 1. 대표: 전체 방향 공지 + 팀장에게 업무로 ───────────────────
  const kickoff = `[킥오프 ${tag}] 이번 치매진단플랫폼 과제는 뉴로힐 제품으로 진행합니다. 컨셉은 "가정에서 10분 자가검사" 로 잡고, 3주 안에 시제품 데모까지 갑니다. 김아리 팀장님이 세부 업무 나눠 주세요.`
  await say(ceo.page, kickoff)

  const ceoTask = await createTaskByCommand(ceo.page, {
    assignee: LEAD,
    tag,
    title: `[${tag}] 치매진단플랫폼 과제 킥오프 — 뉴로힐 자가검사 컨셉 시제품 데모 준비`,
  })
  info.annotations.push({ type: "대표 업무", description: `${ceoTask.name} (#${ceoTask.slug})` })

  // ── 2. 팀장: 대표 지시가 화면에 도착 → 수락 → 세부 업무 분배 ─────
  await waitForChat(lead.page, `[킥오프 ${tag}]`)
  await respondNotification(lead.page, `새 업무: ${ceoTask.name}`, "수락")

  await say(
    lead.page,
    `[${tag}] 대표님 지시 받아서 나눕니다. 우창님은 자가검사 앱 화면 프로토타입, 혜린님은 뉴로힐 검사 키트 사양 정리 부탁드립니다.`,
  )
  const taskA = await createTaskByCommand(lead.page, {
    assignee: WORKER_A,
    tag,
    title: `[${tag}] 자가검사 앱 화면 프로토타입 제작 (10분 검사 흐름, 3개 화면)`,
  })
  const taskB = await createTaskByCommand(lead.page, {
    assignee: WORKER_B,
    tag,
    title: `[${tag}] 뉴로힐 검사 키트 구성품·사양서 정리 (시제품 데모용)`,
  })
  info.annotations.push({ type: "세부 업무", description: `${taskA.name} / ${taskB.name}` })

  // 대표 화면에도 팀장의 분배가 폴링으로 보인다
  await waitForChat(ceo.page, `[${tag}] 대표님 지시 받아서 나눕니다`)

  // ── 3. 실무 2명이 동시에: 수락 → 진행 보고 → 완료 보고 → 완료 표시 ──
  const work = async (me: Actor, task: { id: string; name: string; slug: string }, progress: string, done: string) => {
    await respondNotification(me.page, `새 업무: ${task.name}`, "수락")
    await replyInThread(me.page, task, progress)
    await replyInThread(me.page, task, done)
    // AI 가 완료로 읽으면 담당자에게 확인을 묻는다 — 담당자가 눌러야 완료가 된다
    const r = await markDone(me.page, task)
    const desc = r.why ? `${r.how} (${r.why})` : r.how
    info.annotations.push({ type: `완료 경로 · ${me.name}`, description: desc })
    console.log(`[시나리오] 완료 경로 · ${me.name}: ${desc}`)
    await waitForTaskStatus(me.page, task, "완료")
  }
  await Promise.all([
    work(
      woochang,
      taskA,
      `[${tag}] 검사 시작·문항·결과 3개 화면 와이어프레임 잡았고 Figma 로 옮기는 중입니다. 내일 오전 공유 가능합니다.`,
      `[${tag}] 앱 화면 프로토타입 3개 화면 모두 Figma 에 올렸습니다. 링크는 스레드에 첨부했습니다. 업무 마무리하겠습니다.`,
    ),
    work(
      hyerin,
      taskB,
      `[${tag}] 키트 구성품 목록(검사지·채취봉·안내서) 초안 잡았고 사양 수치 확인 중입니다.`,
      `[${tag}] 구성품 사양서 v1 완성해서 NAS 에 올렸습니다. 데모용 수량 20세트 기준입니다. 업무 완료합니다.`,
    ),
  ])

  // ── 4. 팀장: 두 완료 알림을 받고 확인 → 대표 업무에 취합 보고 ───────
  await waitForNotification(lead.page, `#${taskA.slug} 업무를 완료했습니다`)
  await waitForNotification(lead.page, `#${taskB.slug} 업무를 완료했습니다`)
  await waitForTaskStatus(lead.page, taskA, "완료")
  await waitForTaskStatus(lead.page, taskB, "완료")
  await expectThreadHas(lead.page, taskA, "업무 마무리하겠습니다")
  await expectThreadHas(lead.page, taskB, "업무 완료합니다")

  await replyInThread(
    lead.page,
    ceoTask,
    `[${tag}] 취합 보고드립니다. 앱 화면 프로토타입(우창) 3개 화면 Figma 완료, 검사 키트 사양서 v1(혜린) 20세트 기준 완료. 시제품 데모 준비 항목 모두 끝났습니다. 업무 마무리하겠습니다.`,
  )
  const rLead = await markDone(lead.page, ceoTask)
  info.annotations.push({ type: `완료 경로 · ${lead.name}`, description: rLead.why ? `${rLead.how} (${rLead.why})` : rLead.how })

  // ── 5. 대표: 완료 알림 → 업무가 완료로, 취합 보고가 스레드에 ──────────
  await waitForNotification(ceo.page, `#${ceoTask.slug} 업무를 완료했습니다`)
  await waitForTaskStatus(ceo.page, ceoTask, "완료")
  await expectThreadHas(ceo.page, ceoTask, `[${tag}] 취합 보고드립니다`)

  // 화면이 쓰는 목록 API 로 최종 상태를 한 번 더 본다
  const final = await ceo.page.evaluate(async (ids: string[]) => {
    const res = await fetch("/api/tasks")
    const tasks: { id: string; status: string }[] = await res.json()
    return ids.map((id) => tasks.find((t) => t.id === id)?.status)
  }, [ceoTask.id, taskA.id, taskB.id])
  expect(final).toEqual(["DONE", "DONE", "DONE"])
  return { tag, ceoTask, taskA, taskB, ms: Date.now() - t0 }
}

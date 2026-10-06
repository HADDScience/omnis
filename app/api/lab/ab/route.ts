import { NextRequest, NextResponse } from "next/server"
import { labAdmin } from "@/app/lab/ab/guard"
import {
  LabError, checkRun, labStatus, pickQuestion, recordVote, runSchema, runTrial, voteSchema, PAIR_KEYS,
  type Pair, type TrialEvent,
} from "@/bench/lab-ab/trial"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// wk-agent 는 20회 반복까지 간다
export const maxDuration = 300

const notFound = () => NextResponse.json({ error: "Not Found" }, { status: 404 })

/**
 * 블라인드 A/B 평가 API — 로컬 dev · ADMIN 전용 (그 밖에는 404).
 *   GET                     진행 현황
 *   GET ?pick=<쌍>          세트에서 아직 평가하지 않은 문항 하나
 *   POST { action:"run", question, qid?, pair }   두 팔 동시 실행. NDJSON 스트림(TrialEvent 한 줄씩)
 *   POST { action:"vote", trialId, prefer, scores, guessed?, note? }
 * 응답에는 팔 이름이 나가지 않는다 — bench/lab-ab/trial.ts 머리 주석.
 */
export async function GET(req: NextRequest) {
  if (!(await labAdmin())) return notFound()
  const pick = req.nextUrl.searchParams.get("pick")
  if (pick) {
    if (!PAIR_KEYS.includes(pick as Pair)) return NextResponse.json({ error: "모르는 비교 쌍" }, { status: 400 })
    return NextResponse.json({ question: pickQuestion(pick as Pair) })
  }
  return NextResponse.json(labStatus())
}

export async function POST(req: NextRequest) {
  const caller = await labAdmin()
  if (!caller) return notFound()
  const body = (await req.json().catch(() => null)) as { action?: string } | null
  if (!body) return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 })

  if (body.action === "vote") {
    const parsed = voteSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "평가 형식이 맞지 않습니다", issues: parsed.error.issues }, { status: 400 })
    try {
      recordVote(parsed.data, caller.name)
    } catch (err) {
      if (err instanceof LabError) return NextResponse.json({ error: err.message }, { status: 409 })
      throw err
    }
    return NextResponse.json({ ok: true, status: labStatus() })
  }

  if (body.action !== "run") return NextResponse.json({ error: "action 은 run 또는 vote" }, { status: 400 })
  const parsed = runSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "실행 형식이 맞지 않습니다", issues: parsed.error.issues }, { status: 400 })
  try {
    checkRun(parsed.data) // 준비 안 된 쌍 · 예산 초과는 스트림을 열기 전에 409 로
  } catch (err) {
    if (err instanceof LabError) return NextResponse.json({ error: err.message }, { status: 409 })
    throw err
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const emit = (e: TrialEvent) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))
        } catch {
          open = false // 화면을 닫았다 — 실행은 끝까지 가고 기록도 남는다
        }
      }
      try {
        await runTrial(parsed.data, caller, emit)
      } catch (err) {
        emit({ type: "error", message: err instanceof LabError ? err.message : `실행 실패: ${String(err).slice(0, 200)}` })
      } finally {
        if (open) controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  })
}

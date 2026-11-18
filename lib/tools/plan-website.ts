// 묶음 6(#248) 실행 — 홈페이지 기사 · 사진 · 통계 · 칼럼 키워드 · 칼럼 초안. 정의는 lib/tools/defs-website.ts.
// 권한은 관리 화면(requireWebsiteUser)과 같다 — 재직 구성원. 초안 승인 · 수정 요청은 검토자만(lib/column/draft decide 가 본다).
// 쓰기는 관리 화면 API 와 같은 서버 함수(lib/website-posts · website-media · column/*)를 부른다.
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import { deletePost, getPost, listPosts, reorderPosts, revalidateWebsite, savePost, setPinned } from "@/lib/website-posts"
import { extensionFor, storeMedia } from "@/lib/website-media"
import { bufferStatus, visitStats } from "@/lib/website-visits"
import { PostBlockSchema, PostIdSchema, PostInputSchema } from "@/lib/schemas/website"
import { collectKeywords } from "@/lib/column/collect"
import { columnDraftView, keywordAction, keywordBoard, listColumnDrafts, todaysKeywordRun, type KeywordAction } from "@/lib/column/board"
import { decide, discardDraft, DraftError, generateDraft, isReviewer, publishDraft, requestReview, updateDraft } from "@/lib/column/draft"
import { findVisibleFile } from "@/lib/file-access-server"
import { openFileObject } from "@/lib/file-object"
import { MAX_UPLOAD_BYTES } from "@/lib/storage"
import { IS_DEMO } from "@/lib/demo"
import { blocked, clip, has, str, type Planner, type RunResult } from "./planned"
import type { WebsiteReadName, WebsiteWriteName } from "./defs-website"
import { z } from "zod"

const title = (p: { content: Partial<Record<string, { title?: string }>>; sourceLang: string }) =>
  p.content[p.sourceLang]?.title ?? p.content.ko?.title ?? "(제목 없음)"

/** 관리 화면이 보내는 것과 같은 오류 → 도구 결과 */
async function draftRun(f: () => Promise<unknown>, text: string): Promise<RunResult> {
  try {
    await f()
    return { ok: true, text }
  } catch (e) {
    if (e instanceof DraftError) return { ok: false, error: e.message }
    throw e
  }
}

// ─── 읽기 ───

export async function runWebsiteRead(name: WebsiteReadName, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "list_website_posts": {
      const id = str(args.id)
      if (id) {
        const p = await getPost(id)
        if (!p) return { error: "기사를 찾지 못했습니다 — list_website_posts 로 확인하세요." }
        return { text: `# ${title(p)} — 고칠 때는 아래 JSON 을 고쳐 save_website_post 의 post 로\n${JSON.stringify(p)}` }
      }
      const rows = await listPosts()
      return { text: [`기사 ${rows.length}건(사이트 순서)`, ...rows.map((p) => `- id=${p.id} · ${p.category} · ${p.date}${p.pinned ? " · 고정" : ""} · ${clip(title(p), 80)}`)].join("\n") }
    }
    case "website_stats": {
      const asked = Number(args.days ?? 30)
      const days = [7, 30, 90].includes(asked) ? asked : 30
      const [stats, buf] = await Promise.all([visitStats(days), bufferStatus()])
      return { text: `방문 통계 ${days}일(KST)\n${JSON.stringify({ ...stats, pending: buf.pending, bufferOk: buf.ok })}` }
    }
    case "list_column_keywords": {
      const st = str(args.status) || "ALL"
      const b = await keywordBoard(caller.userId)
      const rows = b.keywords.filter((k) => (st === "ALL" ? k.status !== "discarded" : k.status === st)).slice(0, 60)
      return {
        text: [
          `칼럼 키워드 ${rows.length}개(점수순)${b.lastRun ? ` · 마지막 수집 ${b.lastRun.startedAt.toISOString().slice(0, 10)}` : ""}`,
          ...rows.map((k) => `- keyword_id=${k.id} · ${k.term} · ${k.topic} · ${k.status}${k.reservedBy ? `(${k.reservedBy})` : ""} · 점수 ${k.score.toFixed(2)}${k.drafts.length ? ` · 초안 ${k.drafts.length}` : ""}${k.similarWarn ? ` · 비슷한 글 있음: ${k.nearestTitle}` : ""}`),
        ].join("\n"),
      }
    }
    case "list_column_drafts": {
      const id = str(args.id)
      if (id) {
        const v = await columnDraftView(id)
        if (!v) return { error: "초안을 찾지 못했습니다." }
        return { text: `# ${v.draft.title} · ${v.draft.status}${v.problems.length ? `\n검토 전에 고칠 것: ${v.problems.join(" · ")}` : ""}\n${JSON.stringify({ title: v.draft.title, summary: v.draft.summary, blocks: v.draft.blocks, keyword: v.draft.keyword.term, reviewNote: v.draft.reviewNote })}` }
      }
      const rows = await listColumnDrafts()
      return { text: [`칼럼 초안 ${rows.length}건(최근 순) — 검토자: ${isReviewer(caller.name) ? "나" : "다른 사람"}`, ...rows.map((d) => `- id=${d.id} · ${d.status} · ${clip(d.title, 70)} · 키워드 ${d.keyword.term} · ${d.createdBy ?? "?"}${d.reviewNote ? ` · 검토 메모: ${clip(d.reviewNote, 60)}` : ""}`)].join("\n") }
    }
  }
}

// ─── 쓰기 계획 ───

const planSavePost: Planner = async (args, caller) => {
  const T = "홈페이지 기사 저장"
  const id = str(args.id)
  if (!PostIdSchema.safeParse(id).success) return blocked(T, id || "(ID 없음)", "기사 id 형식이 아닙니다(숫자 6자리 이상)")
  const parsed = PostInputSchema.safeParse(args.post)
  if (!parsed.success) return blocked(T, id, `post 를 읽지 못했습니다 — ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ")}`)
  const before = await getPost(id)
  const after = parsed.data
  const lang = after.sourceLang
  const b = before?.content[lang]
  const a = after.content[lang]
  const changes = [
    { label: "제목", before: before ? b?.title ?? "(없음)" : null, after: a?.title ?? "(없음)" },
    ...(!before || b?.summary !== a?.summary ? [{ label: "요약", before: before ? clip(b?.summary ?? "", 200) || "(없음)" : null, after: clip(a?.summary ?? "", 200) || "(없음)" }] : []),
    ...(!before || before.date !== after.date ? [{ label: "날짜", before: before?.date ?? null, after: after.date }] : []),
    { label: "본문 블록", before: before ? `${b?.blocks.length ?? 0}개` : null, after: `${a?.blocks.length ?? 0}개` },
  ]
  return {
    title: before ? "홈페이지 기사 고치기" : "홈페이지 기사 새로", target: `${id} · ${clip(a?.title ?? "", 80)}`,
    changes,
    risk: "저장하면 사이트에 바로 반영됩니다. 다른 언어 번역이 AI 로 다시 채워집니다(비용 · 사람이 손본 번역은 그대로).",
    run: async () => {
      const r = await savePost(id, after, caller.userId)
      await revalidateWebsite()
      return { ok: true, id, text: `저장했습니다: ${title(r.post)}${r.translationFailures.length ? ` — 번역 실패: ${r.translationFailures.join(", ")}` : ""}` }
    },
  }
}

const planDeletePost: Planner = async (args) => {
  const T = "홈페이지 기사 지우기"
  const p = str(args.id) ? await getPost(str(args.id)) : null
  if (!p) return blocked(T, str(args.id) || "(ID 없음)", "기사를 찾지 못했습니다 — list_website_posts 로 확인하세요")
  const media = await prisma.websiteMedia.count({ where: { postId: p.id } })
  return {
    title: T, target: `${p.id} · ${title(p)}`,
    changes: [{ label: "지울 기사", before: `${p.category} · ${p.date}${media ? ` · 사진 ${media}장` : ""}`, after: "지움" }],
    risk: "사이트에서 바로 사라지고 사진도 함께 지워집니다. 되돌릴 수 없습니다.",
    confirmLabel: "지우기",
    run: async () => {
      const removed = await deletePost(p.id)
      await revalidateWebsite()
      return removed ? { ok: true, id: p.id, text: "지웠습니다." } : { ok: false, error: "기사를 찾지 못했습니다" }
    },
  }
}

const planArrange: Planner = async (args, caller) => {
  const action = str(args.action)
  if (action === "pin" || action === "unpin") {
    const T = action === "pin" ? "홈페이지 기사 고정" : "홈페이지 기사 고정 풀기"
    const p = str(args.id) ? await getPost(str(args.id)) : null
    if (!p) return blocked(T, str(args.id) || "(ID 없음)", "기사를 찾지 못했습니다")
    const want = action === "pin"
    return {
      title: T, target: `${p.id} · ${title(p)}`,
      changes: [{ label: "고정", before: p.pinned ? "고정" : "아님", after: want ? "고정" : "아님" }],
      risk: "사이트 목록 맨 위 고정이 바뀝니다.",
      ...(p.pinned === want ? { problem: "이미 그 상태입니다" } : {}),
      run: async () => {
        const r = await setPinned(p.id, want, caller.userId)
        await revalidateWebsite()
        return r === null ? { ok: false, error: "기사를 찾지 못했습니다" } : { ok: true, id: p.id, text: "바꿨습니다." }
      },
    }
  }
  if (action !== "order") return blocked("홈페이지 기사 정리", "", "action 은 pin · unpin · order 중 하나입니다")
  const order = Array.isArray(args.order) ? args.order.map(String) : []
  const ok = z.array(PostIdSchema).max(1_000).safeParse(order)
  const now = await listPosts()
  const titleOf = new Map(now.map((p) => [p.id, title(p)]))
  return {
    title: "홈페이지 기사 순서", target: `${order.length}건`,
    changes: [{ label: "앞 다섯", before: now.slice(0, 5).map((p) => clip(title(p), 30)).join(" / "), after: order.slice(0, 5).map((id) => clip(titleOf.get(id) ?? id, 30)).join(" / ") }],
    risk: "사이트 목록 순서가 바뀝니다(고정한 글은 그대로 맨 위).",
    ...(!ok.success || order.length === 0 ? { problem: "order 에 기사 ID 를 순서대로 주세요" } : {}),
    run: async () => {
      await reorderPosts(order)
      await revalidateWebsite()
      return { ok: true, text: "순서를 바꿨습니다." }
    },
  }
}

const planMedia: Planner = async (args, caller) => {
  const T = "홈페이지 사진 올리기"
  if (IS_DEMO) return blocked(T, "", "시연용 사이트에서는 저장소에 올리지 않습니다")
  const postId = str(args.post_id)
  if (!PostIdSchema.safeParse(postId).success) return blocked(T, postId, "기사 id 형식이 아닙니다")
  const id = str(args.file)
  const f = id && (await findVisibleFile(id, caller.userId)) ? await prisma.file.findUnique({ where: { id }, select: { id: true, name: true, path: true, size: true, mimeType: true } }) : null
  if (!f) return blocked(T, id || "(파일 없음)", "파일을 찾지 못했습니다 — upload_file 로 올린 파일 ID 를 넣으세요")
  const contentType = f.mimeType.split(";")[0].trim()
  if (!extensionFor(contentType)) return blocked(T, f.name, `사진 형식이 아닙니다(${contentType})`)
  if (f.size > MAX_UPLOAD_BYTES) return blocked(T, f.name, "파일이 너무 큽니다")
  return {
    title: T, target: `${postId} · ${f.name}`,
    changes: [{ label: "사진", before: null, after: `${f.name} (${Math.round(f.size / 1024)}KB)` }],
    risk: "홈페이지 저장소에 사진이 올라가고 주소가 생깁니다. 기사에 넣어야 사이트에 보입니다.",
    run: async () => {
      const res = await openFileObject(f)
      const chunks: Buffer[] = []
      for await (const chunk of res.body) chunks.push(Buffer.from(chunk))
      const stored = await storeMedia({ postId, bytes: Buffer.concat(chunks), contentType })
      return { ok: true, text: `올렸습니다: ${stored.url}` }
    },
  }
}

const planCollect: Planner = async (_args, caller) => {
  const today = await todaysKeywordRun()
  return {
    title: "칼럼 키워드 모으기", target: today ? "오늘 이미 모음" : "오늘 처음",
    changes: [{ label: "수집", before: null, after: today ? "오늘 결과를 그대로 씁니다(다시 돌지 않음)" : "뉴스를 읽어 후보 키워드를 모읍니다" }],
    risk: today ? "새로 돌지 않습니다." : "AI 비용이 들고 수십 초 걸립니다. 하루 한 번만 돕니다.",
    run: async () => {
      if (await todaysKeywordRun()) return { ok: true, text: "오늘 이미 모았습니다 — list_column_keywords 로 보세요." }
      const r = await collectKeywords({ userId: caller.userId })
      return { ok: true, text: `모았습니다 — 기사 ${r.items}건 · 후보 ${r.candidates.length}개 · 뺀 것 ${r.dropped.length}개` }
    },
  }
}

const planKeyword: Planner = async (args, caller) => {
  const T = "칼럼 키워드"
  const k = str(args.keyword_id) ? await prisma.columnKeyword.findUnique({ where: { id: str(args.keyword_id) }, select: { id: true, term: true, status: true } }) : null
  if (!k) return blocked(T, str(args.keyword_id) || "(ID 없음)", "키워드를 찾지 못했습니다 — list_column_keywords 로 확인하세요")
  const action = str(args.action)
  const LABEL: Record<string, string> = { reserve: "예약", release: "예약 풀기", discard: "버리기", restore: "되살리기", removeSource: "근거 빼기" }
  if (!LABEL[action]) return blocked(T, k.term, "action 은 reserve · release · discard · restore · removeSource 중 하나입니다")
  if (action === "removeSource" && !str(args.url)) return blocked(T, k.term, "removeSource 에는 url 이 필요합니다")
  const body = (action === "removeSource" ? { action, url: str(args.url) } : { action }) as KeywordAction
  return {
    title: `${T} ${LABEL[action]}`, target: k.term,
    changes: [{ label: "상태", before: k.status, after: LABEL[action] }, ...(action === "removeSource" ? [{ label: "뺄 근거", before: str(args.url), after: "뺌" }] : [])],
    risk: "칼럼 키워드 보드가 바뀝니다.",
    run: async () => {
      const r = await keywordAction(k.id, caller.userId, body)
      return r.ok ? { ok: true, id: k.id, text: `${LABEL[action]} 했습니다.` } : { ok: false, error: r.message ?? r.error }
    },
  }
}

const planCreateDraft: Planner = async (args, caller) => {
  const T = "칼럼 초안 쓰기"
  const k = str(args.keyword_id) ? await prisma.columnKeyword.findUnique({ where: { id: str(args.keyword_id) }, select: { id: true, term: true, status: true } }) : null
  if (!k) return blocked(T, str(args.keyword_id) || "(ID 없음)", "키워드를 찾지 못했습니다 — list_column_keywords 로 확인하세요")
  return {
    title: T, target: k.term,
    changes: [{ label: "초안", before: null, after: `「${k.term}」 로 AI 초안` }],
    risk: "AI 비용이 들고 30~60초 걸립니다. 키워드가 내 이름으로 예약됩니다.",
    run: async () => {
      try {
        const r = await generateDraft(k.id, caller.userId)
        return { ok: true, text: `썼습니다 — list_column_drafts 로 보세요.${typeof r === "object" && r && "draft" in r ? ` id=${(r as { draft: { id: string } }).draft.id}` : ""}` }
      } catch (e) {
        if (e instanceof DraftError) return { ok: false, error: e.message }
        throw e
      }
    },
  }
}

const planUpdateDraft: Planner = async (args) => {
  const T = "칼럼 초안 고치기"
  const d = str(args.id) ? await prisma.columnDraft.findUnique({ where: { id: str(args.id) }, select: { id: true, title: true, summary: true, blocks: true, status: true } }) : null
  if (!d) return blocked(T, str(args.id) || "(ID 없음)", "초안을 찾지 못했습니다 — list_column_drafts 로 확인하세요")
  const blocks = has(args, "blocks") ? z.array(PostBlockSchema).max(500).safeParse(args.blocks) : null
  if (blocks && !blocks.success) return blocked(T, d.title, `blocks 를 읽지 못했습니다 — ${blocks.error.issues[0]?.message}`)
  const next = { title: has(args, "title") ? str(args.title) : d.title, summary: has(args, "summary") ? str(args.summary) : d.summary, blocks: blocks?.success ? blocks.data : (d.blocks as z.infer<typeof PostBlockSchema>[]) }
  const changes = [
    ...(next.title !== d.title ? [{ label: "제목", before: d.title, after: next.title }] : []),
    ...(next.summary !== d.summary ? [{ label: "요약", before: clip(d.summary, 200), after: clip(next.summary, 200) }] : []),
    ...(blocks ? [{ label: "본문 블록", before: `${Array.isArray(d.blocks) ? d.blocks.length : 0}개`, after: `${next.blocks.length}개` }] : []),
  ]
  return {
    title: T, target: d.title, changes,
    risk: "초안만 바뀝니다. 검토 중 · 게시된 초안은 고칠 수 없습니다.",
    ...(changes.length === 0 ? { problem: "바뀌는 것이 없습니다" } : {}),
    run: () => draftRun(() => updateDraft(d.id, next), "고쳤습니다."),
  }
}

const planDraftAction: Planner = async (args, caller) => {
  const action = str(args.action)
  const LABEL: Record<string, string> = { review: "검토 요청", approve: "승인", request_changes: "수정 요청", publish: "게시", discard: "버리기" }
  const T = `칼럼 초안 ${LABEL[action] ?? ""}`.trim()
  if (!LABEL[action]) return blocked("칼럼 초안", "", "action 은 review · approve · request_changes · publish · discard 중 하나입니다")
  const d = str(args.id) ? await prisma.columnDraft.findUnique({ where: { id: str(args.id) }, select: { id: true, title: true, status: true } }) : null
  if (!d) return blocked(T, str(args.id) || "(ID 없음)", "초안을 찾지 못했습니다 — list_column_drafts 로 확인하세요")
  // 승인 · 수정 요청은 검토자만 — 관리 화면과 같은 규칙(lib/column/draft decide). 미리 막아 카드를 띄우지 않는다
  if ((action === "approve" || action === "request_changes") && !isReviewer(caller.name)) return blocked(T, d.title, "검토 권한이 없습니다(검토자만 승인 · 수정 요청)")
  const user = { id: caller.userId, name: caller.name }
  const note = str(args.note) || undefined
  return {
    title: T, target: d.title,
    changes: [{ label: "상태", before: d.status, after: LABEL[action] }, ...(note ? [{ label: "메모", before: null, after: clip(note) }] : [])],
    risk: action === "publish" ? "라이브러리 기사로 사이트에 올라갑니다(영어 번역 AI 비용)." : action === "discard" ? "초안을 지웁니다. 키워드에 남은 초안이 없으면 예약이 풀립니다." : action === "review" ? "검토자에게 알림이 갑니다." : "작성자가 결과를 봅니다.",
    ...(action === "discard" ? { confirmLabel: "버리기" } : {}),
    run: () => draftRun(async () => {
      if (action === "review") await requestReview(d.id, user)
      else if (action === "approve" || action === "request_changes") await decide(d.id, user, action, note)
      else if (action === "publish") await publishDraft(d.id, caller.userId)
      else await discardDraft(d.id)
    }, `${LABEL[action]} 했습니다.`),
  }
}

export const WEBSITE_PLANNERS: Record<WebsiteWriteName, Planner> = {
  save_website_post: planSavePost,
  delete_website_post: planDeletePost,
  arrange_website_posts: planArrange,
  upload_website_media: planMedia,
  collect_column_keywords: planCollect,
  column_keyword_action: planKeyword,
  create_column_draft: planCreateDraft,
  update_column_draft: planUpdateDraft,
  column_draft_action: planDraftAction,
}

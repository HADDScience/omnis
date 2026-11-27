/**
 * 인증 한 건을 명세(JSON)대로 넣거나 맞춘다 — 아카이브 › 인증 탭의 첫 건처럼 손으로 정리한 인증을 옮길 때.
 *
 *   npx tsx scripts/add-certification.ts --spec <명세.json>                 # 건식: 할 일만 찍는다(DB 를 읽기만)
 *   npx tsx scripts/add-certification.ts --spec <명세.json> --apply         # 쓴다
 *   운영(Neon)은 --prod 를 함께 줘야 쓴다(작업지시자 승인 뒤)
 *
 * 명세는 저장소 밖에 둔다 — 사람 이름 · 방 이름 · 회사 자료가 들어간다(공개 저장소). 모양:
 *   {
 *     "name": "…", "issuer": "…", "stage": "PREPARING", "stageReason": "…", "deadline": "2026-12-18 16:00",
 *     "owner": "구성원 정식 이름", "note": "…",
 *     "checklist": ["…", "…"],
 *     "evidence": [
 *       { "kind": "message", "roomId": "방 id"(또는 "roomName": "방 이름 일부"), "at": "2026-11-27 13:51", "author": "보낸 사람 정식 이름",
 *         "pick": "first"(그 분에 글이 여럿이면 첫 글), "label": "…" },   // 또는 { "kind": "message", "messageId": "…", "label": "…" }
 *       { "kind": "file", "fileId": "옴니스 파일 id", "label": "…" }
 *       { "kind": "url", "ref": "https://…", "label": "…" }
 *     ]
 *   }
 * 같은 인증이 이미 있으면(이름이 같거나 같은 인증 키 — lib/grant-bonus CERT_KEYS) 새로 만들지 않고 그 인증의 칸을 맞춘다.
 * 채팅 글 근거는 그 방 · 그 분(서울 시각) · 그 사람의 글이 하나일 때 잇는다. 여럿이면 pick: "first" 가 있어야 첫 글을 잇고,
 * 없으면 후보(시각 · 글자 수)만 찍고 멈춘다 — messageId 로 고른다. 글 본문은 찍지도 복사하지도 않는다.
 * 파일 근거는 이미 옴니스에 올린 파일의 id 로 준다. 이 스크립트는 파일을 올리지 않는다 — 저장소(NAS)에 직접 쓰지 않으려는 것이다.
 * 파일은 옴니스(화면 · MCP upload_file)로 올려 id 를 받는다. 참여자만 보는 파일(privateToUserId)은 근거로 잇지 않는다.
 * 쓰기는 lib/grants 의 addCertificationCandidate · updateCertification 을 그대로 부른다(활동 기록 · 사람 손질 보호 같다).
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename } from "node:path"
import { prisma } from "@/lib/db"
import { addCertificationCandidate, updateCertification, type CertPatch } from "@/lib/grants"
import { keyOfCert } from "@/lib/grant-bonus"
import { isCertStage, parseSeoulMinute, seoulMinute } from "@/lib/grants-labels"
import { normalizeChecklist, normalizeEvidence, readChecklist, readEvidence, type EvidenceRef } from "@/lib/certs"

const args = process.argv.slice(2)
const flag = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const APPLY = args.includes("--apply")
const PROD_OK = args.includes("--prod")
const specPath = flag("--spec")
if (!specPath) throw new Error("--spec <명세.json> 이 필요하다")
const expand = (p: string) => p.replace(/^~(?=\/)/, homedir())

const host = /@([^/:?]+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "(알 수 없음)"
const prod = host.endsWith("neon.tech")

type EvidenceSpec =
  | { kind: "message"; roomId?: string; roomName?: string; at?: string; author?: string; pick?: "first"; messageId?: string; label?: string }
  | { kind: "file"; fileId: string; label?: string }
  | { kind: "url"; ref: string; label?: string }
interface Spec {
  name: string
  issuer?: string
  stage?: string
  stageReason?: string
  deadline?: string
  owner?: string
  note?: string
  checklist?: string[]
  evidence?: EvidenceSpec[]
}

const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase()

async function findMessage(e: Extract<EvidenceSpec, { kind: "message" }>) {
  const select = { id: true, roomId: true, createdAt: true, content: true } as const
  if (e.messageId) {
    const m = await prisma.chatMessage.findUnique({ where: { id: e.messageId }, select })
    if (!m) throw new Error(`없는 글 id: ${e.messageId}`)
    return m
  }
  const at = e.at ? parseSeoulMinute(e.at) : null
  if (!at || !e.author || (!e.roomId && !e.roomName)) throw new Error("채팅 글 근거는 messageId, 또는 방(roomId · roomName) · at · author 가 있어야 한다")
  const rows = await prisma.chatMessage.findMany({
    where: {
      ...(e.roomId ? { roomId: e.roomId } : { room: { name: { contains: e.roomName } } }),
      author: { name: e.author },
      createdAt: { gte: at, lt: new Date(at.getTime() + 60_000) },
      deletedAt: null,
    },
    select,
    orderBy: { createdAt: "asc" },
  })
  const where = `방 「${e.roomId ?? e.roomName}」 · ${e.at} · ${e.author}`
  if (rows.length === 0) throw new Error(`채팅 글을 못 찾았다 — ${where}`)
  if (rows.length > 1 && e.pick !== "first") {
    // 본문은 찍지 않는다 — 시각 · 글자 수 · id 만
    for (const m of rows) console.error(`  후보 ${m.createdAt.toISOString()} · ${m.content.length}자 · id ${m.id}`)
    throw new Error(`글이 ${rows.length}개다 — ${where}. pick: "first" 나 messageId 로 고른다`)
  }
  if (rows.length > 1) console.log(`  (그 분 글 ${rows.length}개 중 첫 글 — pick: first)`)
  return rows[0]
}

async function main() {
  const spec = JSON.parse(readFileSync(expand(specPath!), "utf8")) as Spec
  console.log(`대상 DB: ${host}${prod ? " (운영)" : ""} · ${APPLY ? "쓰기" : "건식"} · 명세 ${basename(specPath!)}`)
  if (APPLY && prod && !PROD_OK) {
    console.error("운영(Neon)이다. 작업지시자 승인 뒤 --prod 를 함께 줘야 쓴다. 중단.")
    process.exit(1)
  }
  if (!spec.name?.trim()) throw new Error("명세에 name 이 없다")
  if (spec.stage && !isCertStage(spec.stage)) throw new Error(`단계가 틀렸다: ${spec.stage}`)
  if (spec.deadline && !parseSeoulMinute(spec.deadline)) throw new Error(`접수 마감 형식: ${spec.deadline}`)

  // 쓴 사람(활동 기록) — 명세의 담당. 없으면 system
  const owner = spec.owner
    ? await prisma.user.findFirst({ where: { name: spec.owner, id: { not: "system" } }, select: { id: true, name: true } })
    : null
  if (spec.owner && !owner) throw new Error(`담당을 못 찾았다(구성원 정식 이름): ${spec.owner}`)
  const actor = owner?.id ?? "system"

  // 같은 인증 — 이름이 같거나 같은 인증 키
  const key = keyOfCert({ name: spec.name, officialName: null })
  const all = await prisma.companyCertification.findMany({
    select: { id: true, name: true, officialName: true, status: true, checklist: true, evidence: true },
  })
  const same =
    all.find((c) => compact(c.name) === compact(spec.name)) ??
    (key ? all.find((c) => keyOfCert(c) === key) : undefined)
  console.log(same ? `이미 있는 인증 — 「${same.name}」(${same.status}) 칸을 맞춘다` : `새 인증 — 「${spec.name}」 후보로 만든 뒤 칸을 맞춘다`)

  // 근거
  const evidence: EvidenceRef[] = same ? readEvidence(same.evidence) : []
  for (const e of spec.evidence ?? []) {
    if (e.kind === "message") {
      const m = await findMessage(e)
      console.log(`  근거 · 채팅 글(${seoulMinute(m.createdAt)} · id ${m.id}) — 본문은 옮기지 않는다`)
      evidence.push({ kind: "message", ref: m.id, roomId: m.roomId, label: e.label ?? "채팅 글", at: m.createdAt.toISOString() })
    } else if (e.kind === "file") {
      if (!e.fileId) throw new Error("파일 근거는 fileId(옴니스에 올린 파일 id)가 있어야 한다 — 이 스크립트는 파일을 올리지 않는다")
      const f = await prisma.file.findUnique({ where: { id: e.fileId }, select: { id: true, name: true, privateToUserId: true } })
      if (!f) throw new Error(`없는 파일 id: ${e.fileId}`)
      if (f.privateToUserId) throw new Error(`참여자만 보는 파일이라 근거로 잇지 않는다: ${f.name}`)
      console.log(`  근거 · 파일 ${f.name}`)
      evidence.push({ kind: "file", ref: f.id, label: e.label ?? f.name, at: new Date().toISOString() })
    } else if (e.kind === "url") {
      evidence.push({ kind: "url", ref: e.ref, label: e.label ?? "", at: new Date().toISOString() })
      console.log(`  근거 · 링크 ${e.ref}`)
    }
  }
  const checklist = [
    ...(same ? readChecklist(same.checklist) : []),
    ...(spec.checklist ?? [])
      .filter((t) => !(same ? readChecklist(same.checklist) : []).some((x) => x.text === t.trim()))
      .map((text, i) => ({ id: `s${i}`, text, done: false })),
  ]
  const cl = normalizeChecklist(checklist)
  if (typeof cl === "string") throw new Error(cl)
  console.log(`  준비물 ${cl.length}줄 · 단계 ${spec.stage ?? "(그대로)"} · 접수 마감 ${spec.deadline ?? "(그대로)"} · 담당 ${owner?.name ?? "(그대로)"}`)

  if (!APPLY) {
    console.log("건식 — 쓰지 않았다")
    return
  }
  const ev = normalizeEvidence(evidence)
  if (typeof ev === "string") throw new Error(ev)

  let id = same?.id
  if (!id) {
    const r = await addCertificationCandidate(actor, { name: spec.name, issuer: spec.issuer })
    if (!r.ok) throw new Error(r.error)
    id = r.value.id
    console.log(`  만듦 · id ${id}`)
  }
  const patch: CertPatch = {
    ...(spec.issuer !== undefined && { issuer: spec.issuer }),
    ...(spec.stage !== undefined && { status: spec.stage }),
    ...(spec.stageReason !== undefined && { stageReason: spec.stageReason }),
    ...(spec.deadline !== undefined && { deadline: spec.deadline }),
    ...(owner && { ownerId: owner.id }),
    ...(spec.note !== undefined && { note: spec.note }),
    checklist: cl,
    evidence: ev,
  }
  const r = await updateCertification(actor, id, patch)
  if (!r.ok && r.error !== "바뀌는 칸이 없습니다") throw new Error(r.error)
  console.log(`썼다 · ${r.ok ? r.changed.join(" · ") : "바뀌는 칸 없음"} · /omnis/certs?cert=${id}`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

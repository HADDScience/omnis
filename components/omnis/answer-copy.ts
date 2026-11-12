"use client"

/**
 * 화면(DOM) → 클립보드. 정리 규칙은 lib/answer-clipboard.ts(순수 함수 · 단위 시험)에 있고, 여기는 DOM 을 그 나무로 옮기고 쓰기만 한다.
 */
import { clipFromTree, wrapClipboardHtml, type Clip, type ClipNode } from "@/lib/answer-clipboard"

function toNode(n: Node): ClipNode | null {
  if (n.nodeType === Node.TEXT_NODE) return { type: "text", value: n.textContent ?? "" }
  if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return null
  const children = Array.from(n.childNodes).map(toNode).filter((c): c is ClipNode => c !== null)
  if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return { type: "el", tag: "div", children }
  const el = n as Element
  return { type: "el", tag: el.tagName.toLowerCase(), className: typeof el.className === "string" ? el.className : undefined, children }
}

/** 요소 하나를 통째로 */
export function clipFromElement(el: Element): Clip {
  const node = toNode(el)
  return clipFromTree(node ? [node] : [])
}

/** 지금 화면에서 고른 것. 고른 것이 없으면 null */
export function clipFromSelection(sel: Selection | null): Clip | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const nodes: ClipNode[] = []
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i)
    let frag: Node = range.cloneContents()
    // 표 칸 안만 고른 경우에도 칸이 표 안에 있었음을 남긴다 — 조각의 맨 위가 tr · td 면 표로 감싼다
    const host = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    const tag = host?.tagName.toLowerCase()
    if (tag === "tr" || tag === "tbody" || tag === "thead" || tag === "table") {
      const table = document.createElement("table")
      if (tag === "tr") {
        const tr = document.createElement("tr")
        tr.appendChild(frag)
        table.appendChild(tr)
      } else table.appendChild(frag)
      frag = table
    }
    const n = toNode(frag)
    if (n) nodes.push(n)
  }
  const clip = clipFromTree(nodes)
  return clip.text || clip.html ? clip : null
}

/** 복사 사건(Ctrl/⌘+C)에 싣는다 — 글 · 완전한 html 문서 · (있으면) RTF */
export function putClip(data: DataTransfer, clip: Clip) {
  data.setData("text/plain", clip.text)
  data.setData("text/html", wrapClipboardHtml(clip.html))
  // RTF 는 받는 브라우저(파이어폭스 · 사파리)만 맥 · 윈도의 RTF 형식으로 넘긴다. 못 받는 브라우저에서 던지면 나머지는 지킨다
  if (clip.rtf) {
    try {
      data.setData("text/rtf", clip.rtf)
    } catch {
      // 무시
    }
  }
}

/**
 * 단추로 복사. 먼저 복사 사건(execCommand)으로 싣는다 — 비동기 클립보드(navigator.clipboard.write)는 html 을 다듬어
 * 문서 머리 · 표식을 걷고 RTF 를 받지 않는다. 사건이 돌지 않으면(막힌 브라우저) 비동기 클립보드로 html · 글, 그것도 없으면 글만.
 */
export async function writeClip(clip: Clip): Promise<void> {
  if (copyViaEvent(clip)) return
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([wrapClipboardHtml(clip.html)], { type: "text/html" }),
        "text/plain": new Blob([clip.text], { type: "text/plain" }),
      }),
    ])
    return
  }
  await navigator.clipboard.writeText(clip.text)
}

/** 사용자 몸짓 안에서 복사 사건을 일으켜 그 자리에서 싣는다. 실렸으면 true */
function copyViaEvent(clip: Clip): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false
  let done = false
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    putClip(e.clipboardData, clip)
    e.preventDefault()
    // 답 본문 · 표의 복사 듣기(고른 글 · 칸 범위)가 덮어쓰지 않게 여기서 멈춘다
    e.stopImmediatePropagation()
    done = true
  }
  // 잡기 단계의 window — 다른 듣기보다 먼저(표의 듣기도 window 잡기 단계라 먼저 붙은 것이 먼저 돈다 — 그쪽은 포커스가 표 안일 때만 일한다)
  window.addEventListener("copy", onCopy, true)
  try {
    return document.execCommand("copy") && done
  } catch {
    return false
  } finally {
    window.removeEventListener("copy", onCopy, true)
  }
}

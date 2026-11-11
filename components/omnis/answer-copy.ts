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

/** 복사 사건(Ctrl/⌘+C)에 두 형식을 싣는다 */
export function putClip(data: DataTransfer, clip: Clip) {
  data.setData("text/html", wrapClipboardHtml(clip.html))
  data.setData("text/plain", clip.text)
}

/** 단추로 복사 — 두 형식. ClipboardItem 이 없으면 글만 */
export async function writeClip(clip: Clip): Promise<void> {
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

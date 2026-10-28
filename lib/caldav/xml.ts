/**
 * WebDAV multistatus 를 읽는 작은 XML 파서.
 *
 * 의존성을 늘리지 않으려고 직접 둔다. 읽는 것은 서버 응답 하나뿐이고 필요한 것은 넷이다:
 * - 네임스페이스 접두사를 무시한다. 웍스는 CalDAV 를 `C:` 가 아니라 `caldav:` 로 쓴다
 * - `calendar-data` 가 CDATA 로 온다 (2026-10-27 실측)
 * - 표준 엔티티와 숫자 문자 참조
 * - 주석 · 처리 지시 · DOCTYPE 은 건너뛴다
 */

export type XmlNode = {
  /** 접두사를 뗀 로컬 이름 (D:getetag → getetag) */
  name: string
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[ref] ?? whole
  })
}

function localName(qname: string): string {
  const i = qname.indexOf(":")
  return i >= 0 ? qname.slice(i + 1) : qname
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", children: [], text: "" }
  const stack: XmlNode[] = [root]
  let i = 0
  const top = () => stack[stack.length - 1]

  while (i < xml.length) {
    const lt = xml.indexOf("<", i)
    if (lt < 0) {
      top().text += decodeEntities(xml.slice(i))
      break
    }
    if (lt > i) top().text += decodeEntities(xml.slice(i, lt))

    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9)
      if (end < 0) throw new Error("XML: CDATA 가 닫히지 않았다")
      top().text += xml.slice(lt + 9, end)
      i = end + 3
    } else if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4)
      i = end < 0 ? xml.length : end + 3
    } else if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt)
      i = end < 0 ? xml.length : end + 1
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt)
      if (end < 0) throw new Error("XML: 닫는 태그가 끝나지 않았다")
      const name = localName(xml.slice(lt + 2, end).trim())
      if (stack.length <= 1 || top().name !== name) {
        throw new Error(`XML: </${name}> 의 짝이 없다`)
      }
      stack.pop()
      i = end + 1
    } else {
      // 속성 값 안의 > 를 건너뛰며 태그 끝을 찾는다
      let j = lt + 1
      let quote: string | null = null
      while (j < xml.length) {
        const ch = xml[j]
        if (quote) {
          if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") quote = ch
        else if (ch === ">") break
        j++
      }
      if (j >= xml.length) throw new Error("XML: 여는 태그가 끝나지 않았다")
      const selfClosing = xml[j - 1] === "/"
      const inner = xml.slice(lt + 1, selfClosing ? j - 1 : j).trim()
      const qname = inner.split(/\s/, 1)[0]
      const node: XmlNode = { name: localName(qname), children: [], text: "" }
      top().children.push(node)
      if (!selfClosing) stack.push(node)
      i = j + 1
    }
  }
  if (stack.length !== 1) throw new Error(`XML: <${top().name}> 이 닫히지 않았다`)
  return root
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name)
}

export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? []
}

/** 깊이 우선으로 이름이 맞는 첫 노드 */
export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined
  for (const c of node.children) {
    if (c.name === name) return c
    const hit = find(c, name)
    if (hit) return hit
  }
  return undefined
}

/** `HTTP/1.1 404 Not Found` → 404 */
export function statusCode(line: string | undefined): number | null {
  const m = /\s(\d{3})\s?/.exec(line ?? "")
  return m ? Number(m[1]) : null
}

export type DavPropstat = { status: number | null; props: Map<string, XmlNode> }

export type DavResponse = {
  href: string
  /** response 바로 아래의 status (sync-collection 의 묘비가 여기 온다) */
  status: number | null
  propstats: DavPropstat[]
}

/** 상태 200 인 propstat 에서 속성을 찾는다 */
export function okProp(r: DavResponse, name: string): XmlNode | undefined {
  for (const ps of r.propstats) {
    if (ps.status !== null && ps.status >= 200 && ps.status < 300) {
      const n = ps.props.get(name)
      if (n) return n
    }
  }
  return undefined
}

export type Multistatus = { responses: DavResponse[]; syncToken: string | null }

export function parseMultistatus(xml: string): Multistatus {
  const doc = parseXml(xml)
  const ms = child(doc, "multistatus")
  if (!ms) throw new Error("XML: multistatus 가 아니다")
  const responses = childrenNamed(ms, "response").map((r) => ({
    // href 는 퍼센트 인코딩된 그대로 둔다. multiget 에 되돌려 보낼 때 서버가 준 값과 같아야 한다
    href: child(r, "href")?.text.trim() ?? "",
    status: statusCode(child(r, "status")?.text),
    propstats: childrenNamed(r, "propstat").map((ps) => {
      const props = new Map<string, XmlNode>()
      for (const p of child(ps, "prop")?.children ?? []) props.set(p.name, p)
      return { status: statusCode(child(ps, "status")?.text), props }
    }),
  }))
  const tok = child(ms, "sync-token")?.text.trim()
  return { responses, syncToken: tok ? tok : null }
}


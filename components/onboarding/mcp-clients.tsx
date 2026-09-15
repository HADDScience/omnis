import type { ReactNode } from "react"

/**
 * AI 도구별 Omnis MCP 붙이는 법.
 *
 * hadd-ip-platform 의 「AI 도구에 연결하기」(components/ip/mcp-install.tsx)를 옮겼다.
 * 커맨드·딥링크는 각 도구의 실제 규격을 따른다 — Claude Code·Gemini CLI 는 `--transport http`,
 * Codex 는 `--url`, Cursor 는 설정 JSON 을 base64 로, VS Code 는 URL 인코딩으로 받는다.
 * 틀리면 안내가 없느니만 못하다.
 *
 * 전부 OAuth 로 붙는다. 토큰을 손으로 옮기지 않는다 — 도구가 스스로 받고 스스로 갱신한다.
 *
 * 이름을 `hadd-omnis` 하나로 맞추는 이유(2026-09-15): 프로젝트마다 `hadd-ip` 를 따로 붙여
 * 주소가 셋으로 갈렸고(옛 Supabase 410 · 옛 도메인 307 · 현재), 이름이 지식재산권 전용처럼 읽혀
 * AI 가 업무 질문에 이 서버를 쓰지 않았다. Claude Code 는 user 범위로 한 번만 붙인다.
 */

export const SERVER_NAME = "hadd-omnis"

export interface McpClient {
  id: string
  /** 탭 이름 */
  name: string
  /** 터미널에 붙여넣을 커맨드 */
  command?: string
  /** 눌러서 바로 설치되는 딥링크 */
  install?: string
  /** 손으로 설정하는 절차 */
  steps?: ReactNode
  /** 붙인 뒤 승인까지 가는 길 */
  auth: ReactNode
  note?: ReactNode
  /** 「프롬프트 복사」 — AI 에이전트에게 그대로 넘길 글 */
  prompt: string
}

/**
 * UTF-8 문자열을 base64 로. `btoa` 는 Latin-1 만 받아 한글이 섞이면 예외를 던진다.
 */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function buildMcpClients(url: string): McpClient[] {
  // base64 의 `+` 는 쿼리 문자열에서 공백으로 읽힌다 — 한 번 더 인코딩한다.
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(
    base64Utf8(JSON.stringify({ url }))
  )}`
  const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, type: "http", url }))}`

  const cliPrompt = (tool: string, command: string, after: string) =>
    [
      `HADD SCIENCE 의 업무 시스템 Omnis MCP 서버를 ${tool} 에 붙여 줘.`,
      "",
      "아래 커맨드를 실행하면 된다:",
      command,
      "",
      after,
      "토큰은 필요 없다 — 브라우저 승인 화면이 뜨면 Omnis 계정으로 승인하면 된다.",
      "붙인 뒤 도구 목록에 ask_omnis · list_tasks 가 보이는지 확인해 줘.",
    ].join("\n")

  const claudeCode = `claude mcp add --transport http --scope user ${SERVER_NAME} ${url}`
  const codex = `codex mcp add ${SERVER_NAME} --url ${url}\ncodex mcp login ${SERVER_NAME}`
  const gemini = `gemini mcp add --transport http --scope user ${SERVER_NAME} ${url}`

  return [
    {
      id: "claude-code",
      name: "Claude Code",
      command: claudeCode,
      auth: (
        <>
          Claude Code 에서 <b>/mcp</b> → <b>{SERVER_NAME}</b> → <b>Authenticate</b> 를 고르면 브라우저가
          열립니다. 승인하면 끝입니다.
        </>
      ),
      note: (
        <>
          <b>--scope user</b> 라서 모든 폴더에서 한 번에 쓰입니다. 예전에 폴더마다 <b>hadd-ip</b> 로 붙였다면 그
          폴더에서 <code className="rounded bg-muted px-1">claude mcp remove hadd-ip</code> 로 지우세요 — 남겨 두면
          옛 주소가 그 폴더에서 계속 실패합니다.
        </>
      ),
      prompt: cliPrompt(
        "Claude Code",
        claudeCode,
        "예전에 붙인 hadd-ip 가 있으면(`claude mcp list`) `claude mcp remove hadd-ip` 로 먼저 지워 줘. 붙인 뒤 /mcp 에서 hadd-omnis 를 Authenticate 하라고 안내해 줘."
      ),
    },
    {
      id: "claude-ai",
      name: "claude.ai",
      steps: (
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            claude.ai 에서 <b>설정 → 커넥터</b> 를 엽니다.
          </li>
          <li>
            <b>커스텀 커넥터 추가</b> 를 누르고 이름에 <b>{SERVER_NAME}</b>, 주소에 위의 MCP 서버 주소를 넣습니다.
            토큰을 넣는 칸은 없습니다.
          </li>
          <li>
            <b>연결</b> 을 누르면 승인 화면이 뜹니다. Omnis 에 로그인돼 있으면 버튼 한 번으로 끝납니다.
          </li>
        </ol>
      ),
      auth: `대화의 도구 목록에 ${SERVER_NAME} 가 보이면 붙은 것입니다. Claude Desktop 도 같은 커넥터를 씁니다.`,
      note: (
        <>
          예전에 만든 <b>HADD IP</b> 커넥터가 있으면 지우세요. 옛 주소라 연결에 실패하고(410), 같은 이름처럼 보여 AI
          가 새 커넥터까지 안 되는 것으로 착각합니다.
        </>
      ),
      prompt: [
        "claude.ai 에 Omnis MCP 서버를 붙이는 방법:",
        "",
        "1. 설정 → 커넥터 → 커스텀 커넥터 추가",
        `2. 이름: ${SERVER_NAME}`,
        `3. 주소: ${url}`,
        "4. 연결을 누르면 승인 화면이 뜬다. 승인하면 끝 (토큰 필요 없음).",
        "5. 예전 HADD IP 커넥터가 있으면 지운다.",
      ].join("\n"),
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      steps: (
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            <b>설정 → 보안 및 로그인</b> 에서 <b>개발자 모드</b>를 켭니다. 회사 요금제는 관리자가 열어줘야 합니다.
          </li>
          <li>
            <b>설정 → 플러그인</b> 에서 검색창 옆 <b>+</b> 를 눌러 「새 플러그인」을 엽니다.
          </li>
          <li>
            이름 <b>{SERVER_NAME}</b> · 연결 <b>서버 URL</b> · 서버 URL 에 위의 주소 · 인증 <b>OAuth</b>(기본값)로
            채웁니다.
          </li>
          <li>
            「내용을 이해했으며 계속 진행하길 원합니다」를 체크하고 <b>만들기</b> → 승인 화면에서 <b>승인</b>.
          </li>
        </ol>
      ),
      auth: "검토되지 않았다는 경고는 공개 디렉터리에 올리지 않은 사내 서버라서 정상입니다.",
      note: "개발자 모드를 켜지 않으면 + 가 보이지 않습니다. 무료 요금제는 지원되지 않습니다.",
      prompt: [
        "ChatGPT 에 Omnis MCP 서버를 붙이는 방법:",
        "",
        "1. 설정 → 보안 및 로그인 → 개발자 모드 켜기 (회사 요금제는 관리자가 열어줘야 한다)",
        "2. 설정 → 플러그인 → 검색창 옆 + → 새 플러그인",
        `3. 이름: ${SERVER_NAME} / 연결: 서버 URL / 서버 URL: ${url} / 인증: OAuth`,
        "4. 「내용을 이해했으며 계속 진행하길 원합니다」 체크 → 만들기 → 승인",
      ].join("\n"),
    },
    {
      id: "codex",
      name: "Codex",
      command: codex,
      auth: (
        <>
          둘째 줄(<b>codex mcp login</b>)이 브라우저를 엽니다. 승인하면 끝입니다.
        </>
      ),
      prompt: cliPrompt("Codex", codex, "둘째 줄이 브라우저 승인을 연다."),
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      command: gemini,
      auth: "처음 쓸 때 인증을 요구하면 안내대로 브라우저에서 승인하세요.",
      prompt: cliPrompt("Gemini CLI", gemini, "처음 쓸 때 인증을 요구하면 브라우저에서 승인한다."),
    },
    {
      id: "cursor",
      name: "Cursor",
      install: cursorLink,
      auth: "설치한 뒤 서버를 처음 쓸 때 인증 창이 뜹니다. 승인하면 끝입니다.",
      note: "버튼이 반응하지 않으면 Cursor 가 없거나 브라우저가 앱 실행을 막은 것입니다. 설정 → MCP 에 위 주소를 직접 넣으세요.",
      prompt: [
        "Omnis MCP 서버를 Cursor 에 붙여 줘.",
        "",
        `이름: ${SERVER_NAME}`,
        `주소(streamable HTTP): ${url}`,
        "",
        "설정 → MCP 에 추가한 뒤 도구 목록이 보이는지 확인해 줘.",
      ].join("\n"),
    },
    {
      id: "vscode",
      name: "VS Code",
      install: vscodeLink,
      auth: "설치한 뒤 서버를 처음 쓸 때 인증 창이 뜹니다. 승인하면 끝입니다.",
      note: "버튼이 반응하지 않으면 명령 팔레트의 MCP: Add Server 에서 위 주소를 직접 넣으세요.",
      prompt: [
        "Omnis MCP 서버를 VS Code 에 붙여 줘.",
        "",
        `이름: ${SERVER_NAME}`,
        "형식: http",
        `주소: ${url}`,
        "",
        "MCP: Add Server 로 추가한 뒤 도구 목록이 보이는지 확인해 줘.",
      ].join("\n"),
    },
  ]
}

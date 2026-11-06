/**
 * 정적 점검 화면. DB · 인증 · React 를 쓰지 않는다 — 점검 이유가 DB 장애여도 이 화면은 뜬다.
 * 글꼴도 시스템 글꼴만 쓴다(외부 CDN 이 막혀도 그대로).
 */

const DEFAULT_MESSAGE = "잠시 점검 중입니다. 곧 다시 열립니다."

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function maintenancePageHtml(input: { message: string; updatedAt: string | null; retryAfterSeconds: number }): string {
  const message = escapeHtml(input.message || DEFAULT_MESSAGE)
  const since = input.updatedAt
    ? new Date(input.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="${input.retryAfterSeconds}">
<title>점검 중 — Omnis</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#14171c;--muted:#5d6470;--line:#e3e6eb;--accent:#2b4fd8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--ink:#eef0f3;--muted:#9aa1ad;--line:#272b33;--accent:#8aa2ff}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink)}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100svh;padding:max(24px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px 24px}
.tag{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--accent);margin-bottom:12px}
h1{font-size:20px;line-height:1.35;margin:0 0 10px}
p{font-size:15px;line-height:1.6;margin:0;color:var(--muted);white-space:pre-wrap;word-break:keep-all}
.since{margin-top:16px;font-size:13px}
a{display:inline-block;margin-top:20px;font-size:14px;font-weight:600;color:var(--accent);text-decoration:none}
</style>
</head>
<body>
<main role="main" aria-labelledby="t">
<span class="tag">Omnis</span>
<h1 id="t">점검 중입니다</h1>
<p data-maintenance-message>${message}</p>
${since ? `<p class="since">${escapeHtml(since)}부터</p>` : ""}
<a href="">다시 확인</a>
</main>
</body>
</html>`
}

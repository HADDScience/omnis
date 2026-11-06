#!/usr/bin/env bash
# 점검 스위치 켜고 끄기 — 재배포 없이 30~60초 안에 반영된다. 설명: mydocs/manual/maintenance-switch.md
#
#   scripts/maintenance.sh status              지금 값
#   scripts/maintenance.sh banner "문구"        화면 위 공지 띠
#   scripts/maintenance.sh on "문구"            점검 화면(503). 우회 쿠키가 있는 사람만 들어간다
#   scripts/maintenance.sh off                 끄기
#
# 필요: vercel CLI 로그인(vercel whoami). 쓰기 한 번 = Global Config 쓰기 1회(Hobby 월 100회).
# 스토어 이름은 MAINTENANCE_STORE(기본 omnis-switch), 팀은 VERCEL_SCOPE 로 바꾼다.
set -euo pipefail

STORE="${MAINTENANCE_STORE:-omnis-switch}"
SCOPE_ARGS=()
[ -n "${VERCEL_SCOPE:-}" ] && SCOPE_ARGS=(--scope "$VERCEL_SCOPE")

cmd="${1:-status}"
message="${2:-}"

case "$cmd" in
  status)
    exec vercel global-config items "$STORE" --key maintenance ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"}
    ;;
  banner | on | off) ;;
  *)
    sed -n '2,8p' "$0"
    exit 2
    ;;
esac

if [ "$cmd" = "banner" ] && [ -z "$message" ]; then
  echo "banner 는 문구가 필요하다: scripts/maintenance.sh banner \"문구\"" >&2
  exit 2
fi

mode="$cmd"
[ "$cmd" = "on" ] && mode="maintenance"

# 문구의 따옴표 · 줄바꿈을 JSON 으로 안전하게 감싼다
patch="$(MODE="$mode" MESSAGE="$message" node -e '
  const value = { mode: process.env.MODE, message: process.env.MESSAGE, updatedAt: new Date().toISOString() }
  process.stdout.write(JSON.stringify({ items: [{ operation: "upsert", key: "maintenance", value }] }))
')"

vercel global-config update "$STORE" --patch "$patch" ${SCOPE_ARGS[@]+"${SCOPE_ARGS[@]}"}
echo "→ $mode 로 바꿨다. 전파 최대 10초 + 서버 캐시 30초 뒤 점검 화면, 열린 화면의 띠는 최대 60초."
if [ "$mode" = "maintenance" ]; then
  echo "  우회: https://omnis.haddscience.com/?maintenance_bypass=<MAINTENANCE_BYPASS_TOKEN> 를 한 번 연다(12시간 쿠키)."
fi

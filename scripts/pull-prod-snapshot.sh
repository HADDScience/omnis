#!/usr/bin/env bash
# 프로덕션(Neon) 을 로컬 DB 로 통째로 복사한다.
#
#   npm run db:snapshot
#
# 로컬에서 화면을 확인할 때 더미 자료로는 실제 모양이 안 나온다. 업무 421건이
# 있어야 목록이 어떻게 보이는지, 채팅 9천 건이 있어야 스크롤이 어떤지 알 수 있다.
#
# 방향은 **프로덕션 → 로컬** 한쪽뿐이다. 반대로 도는 일이 없도록 대상 URL 을
# 먼저 찍고, 로컬이 아니면 멈춘다.
set -euo pipefail
cd "$(dirname "$0")/.."

envval() { grep -m1 "^$1=" "$2" 2>/dev/null | sed "s/^$1=//; s/^\"//; s/\"$//"; }
host_of() { echo "$1" | sed 's|.*@||; s|/.*||; s|?.*||'; }

SRC=$(envval POSTGRES_URL_NON_POOLING .env.production.local)
[ -z "$SRC" ] && SRC=$(envval DATABASE_URL .env.production.local)
DST=$(envval DATABASE_URL .env)

echo "  읽을 곳 (프로덕션): $(host_of "$SRC")"
echo "  쓸 곳   (로컬)    : $(host_of "$DST")"
echo

case "$SRC" in *neon.tech*) ;; *) echo "읽을 곳이 Neon 이 아니다. 중단."; exit 1;; esac
case "$DST" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "쓸 곳이 로컬이 아니다. 중단 — 프로덕션에 덮어쓸 뻔했다."; exit 1;;
esac

DUMP=$(mktemp -t omnis-snapshot).sql
trap 'rm -f "$DUMP"' EXIT

echo "1/3  프로덕션에서 받는 중..."
docker exec -i omnis-db-local pg_dump --no-owner --no-acl --clean --if-exists "$SRC" > "$DUMP"
echo "     $(wc -l < "$DUMP" | tr -d ' ') 줄 · $(du -h "$DUMP" | cut -f1)"

echo "2/3  로컬에 넣는 중..."
docker exec -i omnis-db-local psql -q -U omnis -d omnis -v ON_ERROR_STOP=0 < "$DUMP" > /dev/null 2>&1 || true

echo "3/3  확인"
docker exec omnis-db-local psql -U omnis -d omnis -c \
  'select (select count(*) from "Task") as 업무,
          (select count(*) from "ChatMessage") as 채팅,
          (select count(*) from "CrmQuote") as 견적,
          (select count(*) from "User") as 사용자;'

echo
echo "끝. 로컬 서버를 다시 띄우면 프로덕션과 같은 자료로 보인다."

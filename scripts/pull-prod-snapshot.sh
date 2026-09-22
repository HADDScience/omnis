#!/usr/bin/env bash
# 프로덕션(Neon) 을 로컬 DB 로 통째로 복사한다.
#
#   pnpm db:snapshot
#
# 로컬에서 화면을 확인할 때 더미 자료로는 실제 모양이 안 나온다. 업무 421건이
# 있어야 목록이 어떻게 보이는지, 채팅 9천 건이 있어야 스크롤이 어떤지 알 수 있다.
#
# 방향은 **프로덕션 → 로컬** 한쪽뿐이다. 반대로 도는 일이 없도록 대상 URL 을
# 먼저 찍고, 로컬이 아니면 멈춘다.
#
# 받은 뒤 scripts/mask-snapshot.sql 로 내용을 가린다. 글자 수와 구조는 그대로라
# 목록·스크롤·성능은 원본과 같이 보이고, 노트북에는 운영 원문이 남지 않는다.
#
#   pnpm db:snapshot            마스킹 (기본값)
#   pnpm db:snapshot --raw      원문 그대로 — 이슈 재현처럼 실제 값이 필요할 때만
set -euo pipefail
cd "$(dirname "$0")/.."

MASK=1
for arg in "$@"; do
  case "$arg" in
    --raw) MASK=0 ;;
    *) echo "모르는 옵션: $arg  (쓸 수 있는 것: --raw)"; exit 1 ;;
  esac
done

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

echo "1/4  프로덕션에서 받는 중..."
docker exec -i omnis-db-local pg_dump --no-owner --no-acl --clean --if-exists "$SRC" > "$DUMP"
echo "     $(wc -l < "$DUMP" | tr -d ' ') 줄 · $(du -h "$DUMP" | cut -f1)"

echo "2/4  로컬에 넣는 중..."
docker exec -i omnis-db-local psql -q -U omnis -d omnis -v ON_ERROR_STOP=0 < "$DUMP" > /dev/null 2>&1 || true

if [ "$MASK" = 1 ]; then
  echo "3/4  내용 가리는 중..."
  docker exec -i omnis-db-local psql -q -U omnis -d omnis -v ON_ERROR_STOP=1 < scripts/mask-snapshot.sql
  echo "     채팅·업무·카드·색인·세금계산서·거래처·연락처를 같은 글자 수의 더미로 바꿨다."
else
  echo "3/4  마스킹 건너뜀 (--raw)"
  echo "     ⚠ 운영 원문이 이 컴퓨터에 그대로 남는다. 일이 끝나면 docker compose down -v 로 지울 것."
fi

echo "4/4  확인"
docker exec omnis-db-local psql -U omnis -d omnis -c \
  'select (select count(*) from "Task") as 업무,
          (select count(*) from "ChatMessage") as 채팅,
          (select count(*) from "CrmQuote") as 견적,
          (select count(*) from "User") as 사용자;'

echo
if [ "$MASK" = 1 ]; then
  echo "끝. 로컬 서버를 다시 띄우면 프로덕션과 같은 분량·모양으로 보인다(내용은 더미)."
  echo "벡터 검색을 쓰려면 pnpm db:embed 로 색인을 다시 만든다 — 마스킹이 벡터를 비웠다."
else
  echo "끝. 로컬 서버를 다시 띄우면 프로덕션과 같은 자료로 보인다."
fi

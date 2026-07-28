#!/bin/sh
# Omnis 설치 스크립트 — Container Manager GUI 없이 SSH 명령어로 설치.
# 사용법: 이 폴더 안에서   sudo sh install.sh
#
# images/ 폴더가 있으면 그 tar에서 이미지를 불러오고(오프라인),
# 없으면 인터넷에서 자동으로 내려받습니다(온라인).

set -e
cd "$(dirname "$0")"

echo "[1/4] 필수 파일 확인..."
[ -f docker-compose.yml ] || { echo "  ✗ docker-compose.yml 이 없습니다."; exit 1; }
[ -f .env ] || { echo "  ✗ .env 가 없습니다. (숨김파일이라 업로드가 누락됐을 수 있음)"; exit 1; }
echo "  ✓ docker-compose.yml, .env 확인"

echo "[2/4] docker 명령 확인..."
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "  ✗ docker compose 를 찾을 수 없습니다."
  echo "    DSM 패키지센터에서 'Container Manager'(구 Docker) 패키지를 먼저 설치하세요."
  exit 1
fi
echo "  ✓ 사용할 명령: $DC"

if [ -d images ]; then
  echo "[3/4] 오프라인 이미지 불러오기..."
  for f in images/*.tar.gz; do
    [ -e "$f" ] || continue
    echo "  로드 중: $f"
    gunzip -c "$f" | docker load
  done
else
  echo "[3/4] images 폴더 없음 → 인터넷에서 이미지를 자동으로 내려받습니다."
fi

echo "[4/4] 컨테이너 시작..."
$DC up -d

echo ""
echo "════════════════════════════════════════"
echo " 설치 완료."
echo " 상태 확인:  sudo $DC ps"
echo " 로그 확인:  sudo $DC logs -f omnis"
echo " 접속:       http://<NAS내부IP>:3000  (아이디 admin)"
echo "════════════════════════════════════════"

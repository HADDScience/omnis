#!/usr/bin/env bash
# 새 로고(v2) 자산을 원본 SVG 에서 다시 만든다. 결과는 public/brand/v2/ 에 쌓이고 저장소에 들어간다.
#
#   bash scripts/brand/build-v2.sh [원본 폴더]
#
# 원본 폴더 기본값은 ~/work/omnis-reports/logo-motion (읽기만 한다).
# 필요한 것: rsvg-convert · magick (brew install librsvg imagemagick)
set -euo pipefail

SRC="${1:-$HOME/work/omnis-reports/logo-motion}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/public/brand/v2"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

BLUE="#044ABF"

# 1) 원본 그대로 — 그라데이션 · 단색 · 흰색(어두운 바탕용) · 앱 아이콘 · 로딩
for f in omnis-mark.svg omnis-mark-mono.svg omnis-mark-white.svg omnis-appicon.svg omnis-loader.svg; do
  cp "$SRC/$f" "$OUT/$f"
done

# 마크 세 조각의 path — 흰 마크 원본에서 꺼낸다(512 viewBox, 마크 외곽 60~452)
PATHS="$(sed -E 's/.*<defs><\/defs>//; s/<\/svg>.*//' "$SRC/omnis-mark-white.svg")"

# 2) omnis-logo.svg — v1 의 omnis-logo.png 와 같은 쓰임(타일 위 흰 마크). 여백 없이 마크 외곽에 맞춘다
cat > "$OUT/omnis-logo.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 60 392 392" width="392" height="392">$PATHS</svg>
SVG

# 3) 꽉 찬 사각형 위 흰 마크 — 마스커블(안전 영역: 지름 80% 원 안) · iOS(모서리는 iOS 가 깎는다)
square() { # $1 = 마크 너비 비율(바탕 대비)
  local s; s="$(awk -v r="$1" 'BEGIN{printf "%.4f", r*512/392}')"
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="$BLUE"/><g transform="translate(256 256) scale($s) translate(-256 -256)">$PATHS</g></svg>
SVG
}
square 0.60 > "$TMP/maskable.svg"   # 마크 반지름 ≈ 30% < 안전 영역 40%
square 0.654 > "$TMP/apple.svg"     # 앱 아이콘(omnis-appicon.svg)과 같은 비율 — 마크 175~845 / 1024

# 4) PNG
png() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }
png "$OUT/omnis-appicon.svg" 192 "$OUT/icon-192.png"
png "$OUT/omnis-appicon.svg" 512 "$OUT/icon-512.png"
png "$OUT/omnis-appicon.svg" 512 "$OUT/icon.png"
png "$TMP/maskable.svg" 512 "$OUT/icon-maskable-512.png"
png "$TMP/apple.svg" 180 "$OUT/apple-icon.png"
png "$OUT/omnis-logo.svg" 512 "$OUT/omnis-logo.png"

# 5) favicon.ico — 16 · 32 · 48
for s in 16 32 48; do png "$OUT/omnis-appicon.svg" "$s" "$TMP/fav-$s.png"; done
magick "$TMP/fav-16.png" "$TMP/fav-32.png" "$TMP/fav-48.png" "$OUT/favicon.ico"

ls -la "$OUT"

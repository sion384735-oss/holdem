#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INSTALL_DIR="$PROJECT_DIR/.local/texas-solver"
ARCHIVE_URL="https://github.com/bupticybee/TexasSolver/releases/download/v0.2.0/TexasSolver-v0.2.0-MacOs.zip"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "현재 설치 스크립트는 macOS용입니다. Linux에서는 TexasSolver console 브랜치를 빌드하세요." >&2
  exit 1
fi

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/felt-texassolver.XXXXXX")
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

echo "TexasSolver v0.2.0 다운로드 중…"
curl -L --fail --compressed "$ARCHIVE_URL" -o "$TEMP_DIR/texassolver.zip"
unzip -q "$TEMP_DIR/texassolver.zip" -d "$TEMP_DIR/release"
mkdir -p "$INSTALL_DIR"
cp -R "$TEMP_DIR/release/TexasSolver-v0.2.0-MacOs/"* "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/console_solver"

echo "설치 완료: $INSTALL_DIR"
file "$INSTALL_DIR/console_solver"
echo "Apple Silicon에서는 Rosetta 2가 필요할 수 있습니다."
echo "주의: 웹 서비스 배포 전 TexasSolver 상업 라이선스를 확인하세요."

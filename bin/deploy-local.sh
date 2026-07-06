#!/bin/sh
# Copy a local pnpm build into the binary cache and record the deploy stamp.
# Usage: ./bin/deploy-local.sh [install-dir]
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="${1:-$HOME/.cache/memex-grok}"

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux*)  PLATFORM_OS="linux" ;;
    Darwin*) PLATFORM_OS="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM_OS="win32" ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64)   PLATFORM_ARCH="x64" ;;
    aarch64|arm64)  PLATFORM_ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac
  printf '%s-%s' "$PLATFORM_OS" "$PLATFORM_ARCH"
}

PLATFORM="$(detect_platform)"
SRC="$ROOT/dist/$PLATFORM"
BIN_SRC="$SRC/memex"
BIN_DEST="$INSTALL/memex-grok"
STAMP_SRC="$SRC/.stamp"
STAMP_DEST="$INSTALL/.stamp"

[ -f "$BIN_SRC" ] || { echo "Missing build artifact: $BIN_SRC (run pnpm build first)" >&2; exit 1; }

mkdir -p "$INSTALL"
cp "$BIN_SRC" "$BIN_DEST"
chmod +x "$BIN_DEST"
for lib in "$SRC"/*.so* "$SRC"/*.dylib "$SRC"/*.dll; do
  [ -f "$lib" ] && cp "$lib" "$INSTALL/"
done

if [ -f "$STAMP_SRC" ]; then
  cp "$STAMP_SRC" "$STAMP_DEST"
elif "$BIN_DEST" --version >"$STAMP_DEST" 2>/dev/null; then
  :
else
  echo "warn: could not record deploy stamp" >&2
fi

echo "Deployed $BIN_DEST (stamp: $(cat "$STAMP_DEST" 2>/dev/null || echo unknown))" >&2
#!/bin/sh
# Downloads the prebuilt memex-grok binary for the current platform.
# Usage: ./bin/install.sh [version]
#   version defaults to "latest"
set -e

REPO="jim80net/memex-grok"
VERSION="${1:-latest}"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK="$DIR/.installing.lock"
LOG="$DIR/.install.log"

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
[ -z "${MEMEX_INSTALL_QUIET:-}" ] && echo "Detected platform: $PLATFORM" >&2

# Resolve version → release tag
if [ "$VERSION" = "latest" ]; then
  REAL_VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | \
    grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
  [ -z "$REAL_VERSION" ] && { echo "Failed to resolve latest version" >&2; exit 1; }
else
  REAL_VERSION="$VERSION"
fi
TAG="v$REAL_VERSION"

if [ "$PLATFORM_OS" = "win32" ]; then
  BIN_NAME="memex.exe"
  BIN_DEST="$DIR/memex.exe"
else
  BIN_NAME="memex"
  BIN_DEST="$DIR/memex.bin"
fi

# Acquire lockfile to serialize concurrent installs
{
  exec 9>"$LOCK"
  if command -v flock >/dev/null 2>&1; then
    flock 9 || { echo "Could not acquire install lock" >&2; exit 1; }
  fi

  # If another process completed the install while we waited, exit success.
  if [ -f "$BIN_DEST" ]; then
    [ -z "${MEMEX_INSTALL_QUIET:-}" ] && echo "Binary already present at $BIN_DEST" >&2
    exit 0
  fi

  URL="https://github.com/$REPO/releases/download/$TAG/memex-grok-$PLATFORM.tar.gz"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  echo "Downloading $URL" >&2
  curl -fsSL "$URL" -o "$TMP/bundle.tar.gz" || { echo "Download failed" >&2; exit 1; }
  tar -xzf "$TMP/bundle.tar.gz" -C "$TMP" || { echo "Extract failed" >&2; exit 1; }
  [ -f "$TMP/$BIN_NAME" ] || { echo "Bundle missing $BIN_NAME" >&2; exit 1; }

  # Move binary and shared libs into bin/
  mv "$TMP/$BIN_NAME" "$BIN_DEST"
  chmod +x "$BIN_DEST"
  for lib in "$TMP"/*.so* "$TMP"/*.dylib "$TMP"/*.dll; do
    [ -f "$lib" ] && cp "$lib" "$DIR/"
  done

  STAMP_FILE="$DIR/.stamp"
  if "$BIN_DEST" --version >"$STAMP_FILE" 2>/dev/null; then
    [ -z "${MEMEX_INSTALL_QUIET:-}" ] && echo "Recorded deploy stamp in $STAMP_FILE" >&2
  else
    echo "$REAL_VERSION" >"$STAMP_FILE"
  fi

  echo "Installed memex $REAL_VERSION to $BIN_DEST" >&2
} >>"$LOG" 2>&1 || { tail -20 "$LOG" >&2; exit 1; }

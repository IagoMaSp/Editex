#!/usr/bin/env bash
# Descarga texlab para incluirlo en la app (sidecar de Tauri) en src-tauri/binaries/.
# Uso: scripts/fetch-texlab.sh [target-triple]   (por defecto, el host de `rustc -vV`)
set -euo pipefail

VERSION="${TEXLAB_VERSION:-v5.25.1}"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"

case "$TRIPLE" in
  x86_64-pc-windows-msvc) ASSET="texlab-x86_64-windows.zip"; EXT=".exe" ;;
  aarch64-pc-windows-msvc) ASSET="texlab-aarch64-windows.zip"; EXT=".exe" ;;
  aarch64-apple-darwin) ASSET="texlab-aarch64-macos.tar.gz"; EXT="" ;;
  x86_64-apple-darwin) ASSET="texlab-x86_64-macos.tar.gz"; EXT="" ;;
  x86_64-unknown-linux-gnu) ASSET="texlab-x86_64-linux.tar.gz"; EXT="" ;;
  aarch64-unknown-linux-gnu) ASSET="texlab-aarch64-linux.tar.gz"; EXT="" ;;
  *) echo "Target no soportado: $TRIPLE" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://github.com/latex-lsp/texlab/releases/download/$VERSION/$ASSET"
echo "Descargando $URL"
curl -fsSL "$URL" -o "$TMP/$ASSET"
case "$ASSET" in
  *.zip) unzip -q -o "$TMP/$ASSET" -d "$TMP" ;;
  *) tar -xzf "$TMP/$ASSET" -C "$TMP" ;;
esac

mkdir -p "$DEST"
install -m755 "$TMP/texlab$EXT" "$DEST/texlab-$TRIPLE$EXT"
echo "texlab $VERSION -> $DEST/texlab-$TRIPLE$EXT"

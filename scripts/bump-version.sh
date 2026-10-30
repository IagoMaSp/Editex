#!/usr/bin/env bash
# Cambia la versión de Editex en package.json, tauri.conf.json y Cargo.toml (+ Cargo.lock).
# Uso: scripts/bump-version.sh 0.2.0
set -euo pipefail

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Uso: $0 X.Y.Z" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

sed -i.bak -E "0,/\"version\": \"[^\"]+\"/s//\"version\": \"$VERSION\"/" "$ROOT/package.json" "$ROOT/src-tauri/tauri.conf.json"
sed -i.bak -E "0,/^version = \"[^\"]+\"/s//version = \"$VERSION\"/" "$ROOT/src-tauri/Cargo.toml"
rm -f "$ROOT/package.json.bak" "$ROOT/src-tauri/tauri.conf.json.bak" "$ROOT/src-tauri/Cargo.toml.bak"
(cd "$ROOT/src-tauri" && cargo update -p editex --offline >/dev/null 2>&1 || cargo update -p editex)

echo "Versión $VERSION. Haz commit, fusiona en main y después etiqueta main:"
echo "  git switch main && git pull && git tag v$VERSION && git push origin v$VERSION"

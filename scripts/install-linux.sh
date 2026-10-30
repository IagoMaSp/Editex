#!/usr/bin/env bash
# Compila Editex en modo release y lo instala para el usuario actual (sin sudo):
#   binario  -> ~/.local/bin/editex
#   icono    -> ~/.local/share/icons/hicolor/*/apps/editex.png
#   lanzador -> ~/.local/share/applications/editex.desktop
# Uso: scripts/install-linux.sh            (compila e instala)
#      scripts/install-linux.sh --no-build (instala el binario ya compilado)
#      scripts/install-linux.sh --uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN_DIR/editex" "$APPS_DIR/editex.desktop"
  rm -f "$ICONS_DIR"/{32x32,64x64,128x128,256x256}/apps/editex.png
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
  echo "Editex desinstalado."
  exit 0
fi

if [[ "${1:-}" != "--no-build" ]]; then
  cd "$ROOT"
  pnpm install --frozen-lockfile
  # Solo el binario: los paquetes (AppImage/deb/rpm) no hacen falta para instalar en local.
  pnpm tauri build --no-bundle
fi

BIN="$ROOT/src-tauri/target/release/editex"
[[ -x "$BIN" ]] || { echo "No existe $BIN: compila primero." >&2; exit 1; }

install -Dm755 "$BIN" "$BIN_DIR/editex"
install -Dm644 "$ROOT/src-tauri/icons/32x32.png" "$ICONS_DIR/32x32/apps/editex.png"
install -Dm644 "$ROOT/src-tauri/icons/64x64.png" "$ICONS_DIR/64x64/apps/editex.png"
install -Dm644 "$ROOT/src-tauri/icons/128x128.png" "$ICONS_DIR/128x128/apps/editex.png"
install -Dm644 "$ROOT/src-tauri/icons/128x128@2x.png" "$ICONS_DIR/256x256/apps/editex.png"

mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/editex.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Editex
GenericName=Editor LaTeX
Comment=Editor LaTeX local y rápido
Exec=$BIN_DIR/editex %f
Icon=editex
Terminal=false
Categories=Office;
Keywords=latex;tex;overleaf;pdf;
StartupWMClass=editex
DESKTOP

update-desktop-database "$APPS_DIR" 2>/dev/null || true
gtk-update-icon-cache -q "$ICONS_DIR" 2>/dev/null || true
echo "Editex instalado en $BIN_DIR/editex (búscalo como «Editex» en el lanzador)."

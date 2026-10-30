# Editex

Editor LaTeX de escritorio, local y rápido. Tauri 2 (Rust) + Svelte 5 + CodeMirror 6 + pdf.js.

## Windows y macOS

1. Instala LaTeX:
   - **Windows**: [MiKTeX](https://miktex.org/download) (en su consola, activa *Instalar paquetes que falten → Siempre*) o [TeX Live](https://tug.org/texlive/windows.html). Para `latexmk` con MiKTeX hace falta Perl ([Strawberry Perl](https://strawberryperl.com/)); TeX Live ya lo incluye.
   - **macOS**: [MacTeX](https://tug.org/mactex/) o `brew install --cask mactex-no-gui`.
2. Descarga el instalador de Editex:
   - Versiones publicadas: pestaña **Releases** del repositorio (`.msi`/`-setup.exe` para Windows, `.dmg` para macOS: `aarch64` = Apple Silicon, `x64` = Intel).
   - Última compilación de una rama: **Actions → Build →** el run más reciente **→ Artifacts**.
3. La app no está firmada, así que la primera vez:
   - **Windows**: en el aviso de SmartScreen, *Más información → Ejecutar de todas formas*.
   - **macOS**: clic derecho sobre Editex → *Abrir*; si dice que está dañada: `xattr -cr /Applications/Editex.app`.

texlab (autocompletado) y los diccionarios de español e inglés vienen incluidos.

Para publicar una versión: `git tag v0.2.0 && git push origin v0.2.0` crea un release en borrador con los instaladores de los tres sistemas.

## Requisitos para desarrollar (Arch / CachyOS)

```bash
sudo pacman -S --needed texlive texlive-lang biber texlab webkit2gtk-4.1 hunspell-es_es hunspell-en_us
```

## Instalar como app (Linux)

```bash
scripts/install-linux.sh
```

Compila en modo release e instala para tu usuario (sin sudo): el binario en `~/.local/bin/editex` y el lanzador «Editex» en el menú de aplicaciones. Para actualizar, vuelve a ejecutarlo; para quitarlo, `scripts/install-linux.sh --uninstall`.

También se puede abrir un proyecto directamente: `editex ~/ruta/al/proyecto`.

## Desarrollo

```bash
pnpm install
pnpm tauri dev                       # pantalla de bienvenida
pnpm tauri dev -- -- examples/tesis  # abre directamente un proyecto
pnpm tauri build                     # AppImage / .deb / .rpm
```

## Funciones

- Editor CodeMirror con resaltado LaTeX, cierre automático de `\begin{…}`/`\end{…}` y llaves.
- Autocompletado, diagnósticos de sintaxis, `\ref`/`\cite` vía **texlab** (LSP).
- Ortografía español/inglés (Hunspell vía `spellbook`), ignorando comandos, matemáticas y referencias. Clic derecho para sugerencias.
- Compilación con `latexmk` (pdfLaTeX/XeLaTeX/LuaLaTeX), errores enlazados a la línea.
- **Modo rápido**: compila solo el capítulo `\include` que estás editando, en su propio directorio de build.
- **Preámbulo precompilado** (`mylatexformat`) para compilaciones completas.
- Visor PDF con renderizado bajo demanda, zoom, modo oscuro, SyncTeX (Ctrl+clic en PDF → código, Ctrl+J → PDF).
- Esquema del documento, importar/exportar ZIP de Overleaf, compilar al guardar o al dejar de escribir.

## Asistente de IA

Editex se integra con agentes de IA que trabajan sobre los archivos del proyecto, usando **tu propia cuenta** (la misma sesión que en la terminal):

- **Panel de IA** (✦ o Ctrl+Shift+A): chat con Claude Code o Codex mediante el [Agent Client Protocol](https://agentclientprotocol.com). Muestra el razonamiento, el plan, cada archivo que lee y los cambios como diff; pide permiso antes de editar. Los cambios en archivos abiertos se aplican en el editor y **Ctrl+Z los deshace**. Puedes adjuntar el archivo actual, la selección y los errores de compilación. En *Problemas* hay un botón **Arreglar con IA**.
- **Terminal integrada** (Ctrl+`): una terminal real en la carpeta del proyecto, con botones para lanzar `claude` o `codex` directamente.

Requisitos: [Node.js](https://nodejs.org) (el adaptador ACP se descarga con `npx` la primera vez) y haber iniciado sesión en el agente (`claude` → `/login`, o `codex login`). Con ⚙ en el panel se pueden añadir otros agentes compatibles con ACP (p. ej. Gemini CLI).

Si un agente modifica en disco un archivo que tienes abierto con cambios sin guardar, Editex avisa y te deja elegir qué versión conservar.

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl+S | Guardar (y compilar si está activado) |
| Ctrl+Enter | Compilar (modo rápido si está activado) |
| Ctrl+Shift+Enter | Compilación completa |
| Ctrl+J | Ir a la posición en el PDF |
| Ctrl+clic en PDF | Ir a la línea en el código |
| Ctrl+Shift+A | Panel de IA |
| Ctrl+` | Terminal integrada |

## Caché de figuras TikZ

Añade `\usepackage{memoize}` antes de `tikz` y activa *shell-escape* en ajustes. Requiere `perl-pdf-api2`.

## Benchmark

```bash
cp -r examples/tesis /tmp/bench
cd src-tauri && EDITEX_BENCH=/tmp/bench cargo test bench -- --ignored --nocapture
```

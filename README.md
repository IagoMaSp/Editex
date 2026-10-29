# Editex

Editor LaTeX de escritorio, local y rápido. Tauri 2 (Rust) + Svelte 5 + CodeMirror 6 + pdf.js.

## Requisitos (Arch / CachyOS)

```bash
sudo pacman -S --needed texlive texlive-lang biber texlab webkit2gtk-4.1 hunspell-es_es hunspell-en_us
```

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

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl+S | Guardar (y compilar si está activado) |
| Ctrl+Enter | Compilar (modo rápido si está activado) |
| Ctrl+Shift+Enter | Compilación completa |
| Ctrl+J | Ir a la posición en el PDF |
| Ctrl+clic en PDF | Ir a la línea en el código |

## Caché de figuras TikZ

Añade `\usepackage{memoize}` antes de `tikz` y activa *shell-escape* en ajustes. Requiere `perl-pdf-api2`.

## Benchmark

```bash
cp -r examples/tesis /tmp/bench
cd src-tauri && EDITEX_BENCH=/tmp/bench cargo test bench -- --ignored --nocapture
```

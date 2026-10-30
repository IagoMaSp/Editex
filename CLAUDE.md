# CLAUDE.md

Editex: editor LaTeX de escritorio (alternativa local a Overleaf). Tauri 2 + Rust en el backend, Svelte 5 + CodeMirror 6 + pdf.js en el frontend. Idioma del proyecto: español (UI, comentarios, commits).

## Comandos

```bash
pnpm install
pnpm tauri dev                       # app en modo desarrollo
pnpm tauri dev -- -- examples/tesis  # abre un proyecto directamente (argv → initial_project)
pnpm dev  →  http://localhost:1420/?mock   # interfaz en el navegador con backend simulado (src/dev/mock.ts)
pnpm check                           # svelte-check (TS + Svelte)
pnpm build                           # build del frontend (vite)
cd src-tauri && cargo test           # tests unitarios Rust
scripts/install-linux.sh             # build release + instalar en ~/.local (lanzador incluido); --uninstall para quitar
cd src-tauri && EDITEX_BENCH=/tmp/copia-de-examples-tesis cargo test bench -- --ignored --nocapture
```

Antes de dar algo por terminado: `pnpm check` sin errores y `cargo test` en verde.

Requisitos del sistema (Arch/CachyOS): `texlive texlive-lang biber texlab webkit2gtk-4.1 hunspell-es_es hunspell-en_us`.

## Arquitectura

### Backend (`src-tauri/src/`)
Cada módulo expone `#[tauri::command]`s registrados en `lib.rs`. El frontend trabaja con **rutas relativas al proyecto** (`root` + `path`); `project::resolve` rechaza rutas que escapan del proyecto.

- `compile.rs` — orquestador de compilación (`run_compile`). Puntos clave:
  - Usa `latexmk` con `-{engine}="<engine> %O %P"` y `-pretex=` (si falta latexmk, una pasada directa del motor).
  - **Modo rápido**: si el archivo activo pertenece a un `\include`, compila con `\includeonly{cap}` en `.editex/fast` (directorio propio, sembrado con los `.aux` de `.editex/build`). No mezclar con el build completo: alternar modos invalidaría la caché de latexmk.
  - latexmk **no detecta** cambios de `-pretex` ni del `.fmt`: se pasa `-g` (via `last_pretex`).
  - `mirror_dirs`: TeX no crea subcarpetas en el outdir; sin esto `\include{cap/x}` falla.
  - **Preámbulo precompilado** (`mylatexformat`, `.editex/build/editex-preamble.fmt`, `TEXFORMATS`): solo sin pretex; mylatexformat necesita el documento como primer elemento de la línea de órdenes.
  - Cancelación: cada compilación nueva cancela la anterior (oneshot) y mata el grupo de procesos.
  - Env `max_print_line=100000` para que las rutas del log no se corten.
- `log_parser.rs` — parsea `.log` (`-file-line-error`, `! ...`, warnings de LaTeX/paquetes, bad boxes) siguiendo la pila de archivos por paréntesis.
- `spell.rs` — tokenizador LaTeX-aware + `spellbook` (Hunspell). Devuelve offsets **UTF-16** (los de CodeMirror). Diccionarios en `/usr/share/hunspell` y similares; diccionario personal en `app_config_dir/words.txt`.
- `lsp.rs` — lanza `texlab` y hace de puente stdio ↔ eventos Tauri (`lsp-message`), añadiendo/quitando cabeceras `Content-Length`.
- `synctex.rs` — llama al binario `synctex view/edit`; coordenadas en puntos PDF desde arriba-izquierda.
- `search.rs` — buscar/reemplazar en todo el proyecto (regex crate); columnas en UTF-16; reemplaza por líneas conservando `\r\n`.
- `project.rs` — `trash_path` mueve a la papelera del sistema (crate `trash`, nunca borrado definitivo); `save_binary` recibe el cuerpo binario crudo con root/dir/stem/ext en cabeceras URL-encoded; `import_file` copia archivos externos sin sobrescribir. Además: árbol de archivos, lectura/escritura atómica, outline (sigue `\input`/`\include`), ZIP, watcher (`fs-changed`).

### Frontend (`src/`)
- `lib/store.svelte.ts` — estado global (`app`, runes de Svelte 5) y acciones: abrir proyecto, archivos, guardar, compilar. Ajustes por proyecto en `.editex/settings.json`.
- `lib/editor/manager.ts` — **una sola `EditorView`** y un `EditorState` por archivo (se intercambian con `setState`). La extensión LSP va en un `Compartment` porque el cliente llega después de cargar archivos.
- Diagnósticos: texlab usa `@codemirror/lint` (`serverDiagnostics`); por eso ortografía (`spell.ts`) y errores de compilación (`diagnostics.ts`) son `StateField`s de decoraciones propias — **no usar `linter()`/`setDiagnostics`**, pisaría los de texlab.
- `lib/pdf/PdfViewer.svelte` — pdf.js con capa de texto (`TextLayer`, necesita `--total-scale-factor` en la página); solo pinta páginas visibles, libera canvas lejanos, mantiene los canvas viejos hasta que el nuevo está listo (sin parpadeo).
- `lib/CommandPalette.svelte` — paleta (Ctrl+Shift+P, comandos definidos en `App.svelte`) y abrir rápido (Ctrl+P, archivos + secciones del esquema), con búsqueda difusa sin acentos.
- `lib/editor/math.ts` — vista previa KaTeX (cursor = `StateField` + `showTooltip`; ratón = `hoverTooltip`). Busca en una ventana de ±6000 caracteres; traduce align/gather/eqnarray a aligned/gathered/array. Las macros salen del preámbulo (`parseMacros`, `store.refreshMacros`).
- `lib/editor/snippets.ts` — se expanden con **prefijo + Tab**, nunca con Enter (en prosa, «par» + Enter no debe insertar nada); Ctrl+Espacio los lista. Sintaxis de CodeMirror: `${1:x}`, `${0}`, las llaves sueltas son literales. Los del usuario están en `.editex/snippets.json` del proyecto.
- `lib/errors.ts` — explicaciones en español de errores/advertencias comunes (panel de problemas y tooltip de línea). F8/Shift+F8 recorren los problemas (`store.nextProblem`).
- `lib/editor/images.ts` — pegar imágenes → `figuras/` + entorno `figure`. Soltar archivos desde el sistema se gestiona en `App.svelte` (`onDragDropEvent`).
- Árbol (`FileTree.svelte`): arrastrar con eventos de puntero (no HTML5 DnD, poco fiable en el webview); destino = elemento con `data-drop`.
- `app.ui` (store) guarda el estado de paneles para que la paleta pueda controlarlos.
- `lib/api.ts` — envoltorios tipados de los comandos; mantener sincronizado con los structs Rust (`serde(rename_all = "camelCase")` en request/result de compilación).
- Estilos: variables CSS en `app.css` (claro/oscuro con `prefers-color-scheme`); el tema de CodeMirror usa esas variables.

## Git
- Nunca hacer push a `main`. Cada tanda de cambios va en una rama `feat/<tema>` que se sube con `git push -u origin <rama>`; el merge lo hace el usuario (no hay `gh`: dale el enlace `https://github.com/IagoMaSp/Editex/compare/main...<rama>?expand=1`).
- Si el puerto 22 está bloqueado: `GIT_SSH_COMMAND="ssh -o HostName=ssh.github.com -p 443" git push ...`.

## Convenciones
- Todo lo que el usuario ve, en español.
- Directorio `.editex/` dentro de cada proyecto del usuario: build, fast, settings. Está en `.gitignore` y se excluye del árbol y del ZIP exportado.
- Linux primero (Hyprland/Wayland); mantener el código portable (`#[cfg(unix)]` donde haga falta) para Windows/macOS más adelante.
- `examples/tesis/` es el proyecto de prueba (capítulos con `\include`, TikZ, pgfplots, biblatex).

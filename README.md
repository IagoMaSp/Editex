# Editex

**Editor LaTeX de escritorio, local y rápido.** Una alternativa a Overleaf que funciona sin conexión, con tus archivos en tu disco y compilando con la instalación de TeX de tu sistema.

[![Última versión](https://img.shields.io/github/v/release/IagoMaSp/Editex?label=descargar)](https://github.com/IagoMaSp/Editex/releases/latest)
[![CI](https://github.com/IagoMaSp/Editex/actions/workflows/ci.yml/badge.svg)](https://github.com/IagoMaSp/Editex/actions/workflows/ci.yml)

Hecho con Tauri 2 (Rust) + Svelte 5 + CodeMirror 6 + pdf.js.

## ¿Qué ofrece?

- **Editor** con resaltado LaTeX, cierre automático de `\begin{…}`/`\end{…}` y llaves, snippets y vista previa de fórmulas.
- **Autocompletado y diagnósticos** de comandos, `\ref` y `\cite` mediante [texlab](https://github.com/latex-lsp/texlab).
- **Ortografía** en español e inglés (Hunspell) que ignora comandos, matemáticas y referencias. Clic derecho para ver sugerencias.
- **Compilación** con `latexmk` (pdfLaTeX, XeLaTeX o LuaLaTeX), con los errores enlazados a su línea.
- **Modo rápido**: compila solo el capítulo (`\include`) que estás editando.
- **Preámbulo precompilado** para que las compilaciones completas tarden menos.
- **Visor PDF** integrado: zoom, modo oscuro, texto seleccionable y SyncTeX (Ctrl+clic en el PDF → código, Ctrl+J → PDF).
- **Proyecto**: árbol de archivos editable, esquema del documento, buscar y reemplazar en todo el proyecto, pegar imágenes directamente, importar/exportar ZIP de Overleaf.
- **Paleta de comandos** (Ctrl+Shift+P) y apertura rápida de archivos y secciones (Ctrl+P).
- Tema claro, oscuro o el del sistema.

## Instalación

Editex es el editor; para compilar necesita una **distribución de TeX** instalada en el sistema (igual que cualquier editor LaTeX local). Los pasos son siempre dos:

1. Instalar TeX (y opcionalmente texlab y los diccionarios).
2. Descargar el instalador de Editex de la [página de la última versión](https://github.com/IagoMaSp/Editex/releases/latest).

| Componente | ¿Para qué? | ¿Obligatorio? |
|---|---|---|
| TeX Live / MiKTeX / MacTeX (con `latexmk`) | Compilar | Sí |
| `biber` | Bibliografía con biblatex | Si usas biblatex |
| `texlab` | Autocompletado y diagnósticos | Recomendado |
| Diccionarios Hunspell (`es_ES`, `en_US`) | Ortografía | Opcional |

### Linux

**1. Dependencias**

<details open>
<summary>Arch / CachyOS / Manjaro</summary>

```bash
sudo pacman -S --needed texlive texlive-lang biber texlab hunspell-es_es hunspell-en_us
```
</details>

<details>
<summary>Debian / Ubuntu / Linux Mint</summary>

```bash
sudo apt install texlive-latex-extra texlive-lang-spanish texlive-bibtex-extra biber latexmk hunspell-es hunspell-en-us
```

texlab no está en los repositorios de todas las versiones: descarga `texlab-x86_64-linux.tar.gz` de sus [releases](https://github.com/latex-lsp/texlab/releases/latest) y copia el binario a `~/.local/bin/`.
</details>

<details>
<summary>Fedora</summary>

```bash
sudo dnf install texlive-scheme-medium latexmk biber hunspell-es hunspell-en-US
```

texlab: igual que en Debian, desde sus [releases](https://github.com/latex-lsp/texlab/releases/latest).
</details>

**2. Editex** — elige un formato:

- **AppImage** (cualquier distribución, no requiere instalación):
  ```bash
  chmod +x Editex_*_amd64.AppImage
  ./Editex_*_amd64.AppImage
  ```
  Si no arranca, puede faltar FUSE: `sudo apt install libfuse2` (Ubuntu) o `sudo pacman -S fuse2` (Arch).
- **.deb** (Debian/Ubuntu): `sudo apt install ./Editex_*_amd64.deb`
- **.rpm** (Fedora/openSUSE): `sudo dnf install ./Editex-*.x86_64.rpm`

### Windows

**1. TeX.** Instala una de estas dos (desde PowerShell o con su instalador gráfico):

- **TeX Live** (recomendado, incluye `latexmk`, `biber` y Perl): [instalador oficial](https://tug.org/texlive/windows.html) (`install-tl-windows.exe`).
- **MiKTeX** (más ligero, instala paquetes bajo demanda). `latexmk` necesita Perl:
  ```powershell
  winget install MiKTeX.MiKTeX
  winget install StrawberryPerl.StrawberryPerl
  ```

**texlab** (recomendado): descarga `texlab-x86_64-windows.zip` de sus [releases](https://github.com/latex-lsp/texlab/releases/latest) y coloca `texlab.exe` en una carpeta del `PATH`.

**2. Editex.** Descarga y ejecuta `Editex_*_x64-setup.exe` (o el `.msi`).

> Windows SmartScreen puede avisar de que la app no está firmada: pulsa **Más información → Ejecutar de todas formas**.

### macOS

**1. TeX** con [Homebrew](https://brew.sh):

```bash
brew install --cask mactex-no-gui   # o descarga MacTeX desde https://tug.org/mactex/
brew install texlab
```

**2. Editex.** Descarga el `.dmg` para tu Mac — `aarch64` para Apple Silicon (M1 o posterior), `x64` para Intel — y arrastra Editex a *Aplicaciones*.

> La app no está firmada con un certificado de Apple, así que la primera vez macOS dirá que «está dañada» o que «no se puede abrir». Ejecuta una vez:
> ```bash
> xattr -dr com.apple.quarantine /Applications/Editex.app
> ```

### Ortografía en Windows y macOS

Editex busca diccionarios Hunspell (`es_ES.dic`/`.aff`, `en_US.dic`/`.aff`) en las carpetas del sistema y en la carpeta `dictionaries` de su configuración:

| Sistema | Carpeta |
|---|---|
| Linux | `~/.config/dev.iagomasp.editex/dictionaries/` |
| Windows | `%APPDATA%\dev.iagomasp.editex\dictionaries\` |
| macOS | `~/Library/Application Support/dev.iagomasp.editex/dictionaries/` |

Puedes descargarlos del [repositorio de diccionarios de LibreOffice](https://github.com/LibreOffice/dictionaries) (carpetas `es` y `en`).

## Uso

Abre una carpeta con tu proyecto LaTeX (o importa un ZIP de Overleaf). Editex detecta el archivo principal y compila al guardar. Toda la información auxiliar (builds, ajustes del proyecto) se guarda en una carpeta `.editex/` dentro del proyecto; añádela a tu `.gitignore`.

En Linux también puedes abrir un proyecto desde la terminal: `editex ~/ruta/al/proyecto`.

### Atajos

| Atajo | Acción |
|---|---|
| Ctrl+S | Guardar (y compilar si está activado) |
| Ctrl+Enter | Compilar (modo rápido si está activado) |
| Ctrl+Shift+Enter | Compilación completa |
| Ctrl+Shift+P | Paleta de comandos |
| Ctrl+P | Abrir archivo o sección |
| Ctrl+J | Ir a la posición en el PDF |
| Ctrl+clic en PDF | Ir a la línea en el código |

### Caché de figuras TikZ

Añade `\usepackage{memoize}` antes de `tikz` y activa *shell-escape* en ajustes. Requiere el módulo Perl `PDF::API2` (`perl-pdf-api2` en Arch).

## Desarrollo

Requisitos: Rust estable, Node.js 22+, pnpm y las [dependencias de Tauri](https://v2.tauri.app/start/prerequisites/) de tu sistema (en Arch: `webkit2gtk-4.1`).

```bash
pnpm install
pnpm tauri dev                       # pantalla de bienvenida
pnpm tauri dev -- -- examples/tesis  # abre directamente un proyecto
pnpm dev                             # solo la interfaz en el navegador: http://localhost:1420/?mock
pnpm check                           # comprobación de tipos
cd src-tauri && cargo test           # tests de Rust
pnpm tauri build                     # instaladores del sistema actual
```

Para instalar tu propia compilación en Linux sin empaquetar: `scripts/install-linux.sh` (binario en `~/.local/bin` y lanzador en el menú; `--uninstall` para quitarlo).

### Publicar una versión

Las versiones se publican automáticamente con GitHub Actions ([`release.yml`](.github/workflows/release.yml)):

1. `scripts/bump-version.sh 0.2.0` — actualiza la versión en `package.json`, `tauri.conf.json` y `Cargo.toml`.
2. Commit en una rama, pull request y merge a `main`.
3. Etiqueta `main` y súbela:
   ```bash
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. Actions compila en Linux, Windows y macOS (unos 15–20 min) y crea un **borrador** de release con los instaladores.
5. En *Releases*, revisa el borrador, escribe las novedades y pulsa **Publish release**.

### Benchmark

```bash
cp -r examples/tesis /tmp/bench
cd src-tauri && EDITEX_BENCH=/tmp/bench cargo test bench -- --ignored --nocapture
```

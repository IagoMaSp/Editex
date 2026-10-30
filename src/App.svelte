<script lang="ts">
  import { basename, kbd } from "./lib/platform";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { api } from "./lib/api";
  import { app } from "./lib/store.svelte";
  import Editor from "./lib/editor/Editor.svelte";
  import PdfViewer from "./lib/pdf/PdfViewer.svelte";
  import FileTree from "./lib/panels/FileTree.svelte";
  import Outline from "./lib/panels/Outline.svelte";
  import Problems from "./lib/panels/Problems.svelte";
  import Settings from "./lib/Settings.svelte";
  import TexNotice from "./lib/TexNotice.svelte";
  import AiPanel from "./lib/ai/AiPanel.svelte";
  import { loadAgents } from "./lib/ai/agents";
  import type { TexInfo } from "./lib/api";
  import SearchPanel from "./lib/panels/SearchPanel.svelte";
  import CommandPalette, { type PaletteItem } from "./lib/CommandPalette.svelte";
  import { theme } from "./lib/theme.svelte";
  import { isTextFile } from "./lib/store.svelte";
  import { FIGURES_DIR, IMAGE_EXT, insertFigure } from "./lib/editor/images";
  import { recheckSpelling } from "./lib/editor/spell";
  import { snippet } from "@codemirror/autocomplete";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import type { Engine, FileNode, SpellLang, AutoCompile } from "./lib/api";

  let sidebarWidth = $state(Number(localStorage.getItem("editex.sidebar")) || 240);
  let pdfWidth = $state(Number(localStorage.getItem("editex.pdf")) || 46);
  let aiWidth = $state(Number(localStorage.getItem("editex.aiWidth")) || 380);
  let main = $state<HTMLDivElement>();
  const ui = app.ui;
  let texInfo = $state<TexInfo | null>(null);

  const projectName = $derived(app.root ? basename(app.root) : "");
  const errors = $derived(app.diagnostics.filter((d) => d.severity === "error").length);
  const warnings = $derived(app.diagnostics.filter((d) => d.severity === "warning").length);

  async function openFolder() {
    const dir = await open({ directory: true, title: "Abrir proyecto LaTeX" });
    if (typeof dir === "string") await app.openProject(dir);
  }

  async function importZip() {
    const zip = await open({ title: "ZIP descargado de Overleaf", filters: [{ name: "ZIP", extensions: ["zip"] }] });
    if (typeof zip !== "string") return;
    const parent = await open({ directory: true, title: "Carpeta donde crear el proyecto" });
    if (typeof parent !== "string") return;
    const name = basename(zip).replace(/\.zip$/i, "");
    try {
      const root = await api.importZip(zip, `${parent}/${name}`);
      await app.openProject(root);
    } catch (e) {
      app.notify(`No se pudo importar: ${e}`);
    }
  }

  async function exportZip() {
    if (!app.root) return;
    const target = await save({ defaultPath: `${app.root}.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] });
    if (!target) return;
    await app.saveAll();
    await api.exportZip(app.root, target).then(
      () => app.notify("Proyecto exportado"),
      (e) => app.notify(String(e)),
    );
  }

  function drag(kind: "sidebar" | "pdf" | "ai") {
    return (e: PointerEvent) => {
      e.preventDefault();
      const rect = main!.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        if (kind === "sidebar") sidebarWidth = Math.min(480, Math.max(160, ev.clientX - rect.left));
        else if (kind === "ai") aiWidth = Math.min(800, Math.max(280, rect.right - ev.clientX));
        else {
          // El PDF se mide sin contar el panel de IA, que está a su derecha.
          const right = rect.right - (ui.ai ? aiWidth : 0);
          pdfWidth = Math.min(75, Math.max(20, ((right - ev.clientX) / rect.width) * 100));
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("dragging");
        localStorage.setItem("editex.sidebar", String(sidebarWidth));
        localStorage.setItem("editex.pdf", String(pdfWidth));
        localStorage.setItem("editex.aiWidth", String(aiWidth));
      };
      document.body.classList.add("dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  function allFiles(nodes: FileNode[]): string[] {
    return nodes.flatMap((n) => (n.is_dir ? allFiles(n.children) : [n.path]));
  }

  function openSearch() {
    ui.sidebar = true;
    ui.sideTab = "search";
  }

  async function setSetting<K extends keyof typeof app.settings>(key: K, value: (typeof app.settings)[K]) {
    app.settings[key] = value;
    await app.saveSettings();
    if (key === "spellLang") app.editor.view?.dispatch({ effects: recheckSpelling.of(null) });
  }

  const commands = $derived.by((): PaletteItem[] => {
    const c = (label: string, run: () => unknown, detail?: string): PaletteItem => ({ label, detail, kind: "›", run: () => void run() });
    const engines: [Engine, string][] = [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]];
    const langs: [SpellLang, string][] = [["es+en", "español + inglés"], ["es", "español"], ["en", "inglés"], ["off", "desactivada"]];
    const autos: [AutoCompile, string][] = [["off", "nunca"], ["save", "al guardar"], ["idle", "al dejar de escribir"]];
    return [
      c("Compilar", () => app.compile(), kbd("Ctrl+Enter")),
      c("Compilación completa", () => app.compile(true), kbd("Ctrl+Shift+Enter")),
      c("Detener compilación", () => api.cancelCompile()),
      c("Guardar", () => app.saveActive(), kbd("Ctrl+S")),
      c("Guardar todo", () => app.saveAll()),
      c("Ir al archivo…", () => (ui.palette = "files"), kbd("Ctrl+P")),
      c("Buscar en el proyecto", openSearch, kbd("Ctrl+Shift+F")),
      c("Ver posición actual en el PDF", () => {
        const v = app.editor.view;
        if (v) app.syncForward?.(v.state.doc.lineAt(v.state.selection.main.head).number);
      }, kbd("Ctrl+J")),
      c(`${ui.sidebar ? "Ocultar" : "Mostrar"} panel lateral`, () => (ui.sidebar = !ui.sidebar)),
      c(`${ui.pdf ? "Ocultar" : "Mostrar"} vista previa PDF`, () => (ui.pdf = !ui.pdf)),
      c(`${ui.problems ? "Ocultar" : "Mostrar"} problemas`, () => (ui.problems = !ui.problems)),
      c("Mostrar esquema", () => ((ui.sidebar = true), (ui.sideTab = "outline"))),
      c(`Cambiar tema (ahora: ${theme.label.replace("Tema: ", "")})`, () => theme.cycle()),
      c(`${app.settings.fastMode ? "Desactivar" : "Activar"} modo rápido`, () => setSetting("fastMode", !app.settings.fastMode)),
      ...engines.map(([e, name]) => c(`Motor: ${name}`, () => setSetting("engine", e), app.settings.engine === e ? "actual" : undefined)),
      ...langs.map(([l, name]) => c(`Ortografía: ${name}`, () => setSetting("spellLang", l), app.settings.spellLang === l ? "actual" : undefined)),
      ...autos.map(([a, name]) => c(`Compilar automáticamente: ${name}`, () => setSetting("autoCompile", a), app.settings.autoCompile === a ? "actual" : undefined)),
      c("Insertar snippet…", () => (ui.palette = "snippets"), "o escribe el prefijo + Tab"),
      c("Editar mis snippets del proyecto", () => app.editUserSnippets()),
      c(`${app.settings.mathPreview ? "Desactivar" : "Activar"} vista previa de fórmulas`, () => setSetting("mathPreview", !app.settings.mathPreview)),
      c("Ir al siguiente error", () => app.nextProblem(1), "F8"),
      c("Ir al error anterior", () => app.nextProblem(-1), "Shift+F8"),
      c(`${ui.ai ? "Cerrar" : "Abrir"} panel de IA`, () => (ui.ai = !ui.ai), kbd("Ctrl+Shift+A")),
      c("Abrir terminal", () => app.openTerminal(), kbd("Ctrl+`")),
      ...loadAgents().map((a) => c(`Abrir ${a.name} en la terminal`, () => app.openTerminal(a.terminalCommand))),
      c("Arreglar errores con IA", () => app.askAi("Corrige los errores de la última compilación. Explica brevemente qué cambiaste.", true)),
      c("Ajustes del proyecto", () => (ui.settings = true)),
      c("Abrir carpeta…", openFolder, kbd("Ctrl+O")),
      c("Importar ZIP de Overleaf…", importZip),
      c("Exportar proyecto como ZIP…", exportZip),
    ];
  });

  const fileItems = $derived.by((): PaletteItem[] => {
    const files: PaletteItem[] = allFiles(app.files)
      .filter(isTextFile)
      .map((f) => ({ label: f.split("/").pop()!, detail: f, kind: "T", run: () => app.openFile(f) }));
    const sections: PaletteItem[] = app.outline.map((o) => ({
      label: o.title || "(sin título)",
      detail: `${o.file}:${o.line}`,
      kind: "§",
      run: () => app.openFile(o.file, o.line),
    }));
    return [...files, ...sections];
  });

  const snippetItems = $derived.by((): PaletteItem[] =>
    // Leer `ui.palette` hace que la lista se recalcule al abrirla (los snippets pueden haber cambiado).
    ui.palette === "snippets"
      ? app.snippets.map((s) => ({
          label: s.prefix,
          detail: s.description,
          kind: "✎",
          run: () => {
            const view = app.editor.view;
            if (!view || !app.active) return;
            const { from, to } = view.state.selection.main;
            snippet(s.body.replace(/\t/g, "  "))(view, null, from, to);
            view.focus();
          },
        }))
      : [],
  );

  /** Archivos arrastrados desde el gestor de archivos del sistema. */
  async function onOsDrop(paths: string[], x: number, y: number) {
    if (!app.root || paths.length === 0) return;
    const el = document.elementFromPoint(x, y);
    const view = app.editor.view;
    if (el?.closest(".cm-editor") && view && app.active?.endsWith(".tex")) {
      const images = paths.filter((p) => IMAGE_EXT.test(p));
      if (!images.length) return app.notify("Solo se pueden insertar imágenes (png, jpg, pdf, eps)");
      let pos = view.posAtCoords({ x, y }) ?? view.state.selection.main.head;
      for (const src of images) {
        const rel = await api.importFile(app.root, src, FIGURES_DIR).catch((e) => (app.notify(String(e)), null));
        if (!rel) continue;
        insertFigure(view, rel, pos);
        pos = view.state.selection.main.head;
      }
      return;
    }
    // En el árbol: copiar a la carpeta bajo el puntero (o a la raíz).
    const target = el?.closest<HTMLElement>("[data-drop]");
    if (target || el?.closest("aside")) {
      const p = target?.dataset.drop ?? "";
      const dir = target?.dataset.dir === "1" ? p : p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      for (const src of paths) await api.importFile(app.root, src, dir).catch((e) => app.notify(String(e)));
      await app.refreshTree();
      app.notify(`${paths.length} archivo(s) copiados a ${dir || "la raíz del proyecto"}`);
    }
  }

  onMount(() => {
    void api.checkTex().then((info) => (texInfo = info)).catch(() => {});
    void api.initialProject().then((dir) => {
      if (dir) void app.openProject(dir);
    });
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const dpr = window.devicePixelRatio || 1;
      void onOsDrop(e.payload.paths, e.payload.position.x / dpr, e.payload.position.y / dpr);
    });
    return () => void unlisten.then((f) => f());
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "F8" && app.root && !(e.target as HTMLElement)?.closest?.(".cm-editor")) {
      e.preventDefault();
      void app.nextProblem(e.shiftKey ? -1 : 1);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || !app.root) return;
    // Atajos globales, también dentro del editor.
    const key = e.key.toLowerCase();
    if (key === "p") {
      e.preventDefault();
      ui.palette = e.shiftKey ? "commands" : "files";
      return;
    }
    if (key === "a" && e.shiftKey) {
      e.preventDefault();
      ui.ai = !ui.ai;
      return;
    }
    if (e.key === "`" || e.code === "Backquote") {
      e.preventDefault();
      if (ui.problems && ui.bottomTab === "terminal") ui.problems = false;
      else void app.openTerminal();
      return;
    }
    if (key === "f" && e.shiftKey) {
      e.preventDefault();
      openSearch();
      return;
    }
    // Dentro del editor el resto de atajos los gestiona CodeMirror.
    if ((e.target as HTMLElement)?.closest?.(".cm-editor")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void app.compile(e.shiftKey);
    } else if (e.key === "s") {
      e.preventDefault();
      void app.saveActive();
    } else if (e.key === "o") {
      e.preventDefault();
      void openFolder();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if !app.root}
  <div class="welcome">
    <button class="icon theme" title={theme.label} onclick={() => theme.cycle()}>{theme.icon}</button>
    <div class="card">
      <div class="logo">E<span>χ</span></div>
      <h1>Editex</h1>
      <p class="sub">Editor LaTeX local, rápido y sin colas de compilación.</p>
      {#if texInfo && !texInfo.pdflatex}<div class="welcome-notice"><TexNotice info={texInfo} /></div>{/if}
      <div class="actions">
        <button class="primary" onclick={openFolder}>Abrir carpeta…</button>
        <button onclick={importZip}>Importar ZIP de Overleaf…</button>
      </div>
      {#if app.recents.length}
        <h2>Recientes</h2>
        <ul>
          {#each app.recents as r (r)}
            <li><button class="link" onclick={() => app.openProject(r)}>{basename(r)}<small>{r}</small></button></li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{:else}
  <div class="app">
    <header>
      <button class="icon" title="Panel lateral" onclick={() => (ui.sidebar = !ui.sidebar)}>☰</button>
      <span class="brand">Editex</span>
      <span class="project" title={app.root}>{projectName}</span>
      <div class="menu">
        <button onclick={openFolder}>Abrir</button>
        <button onclick={importZip}>Importar ZIP</button>
        <button onclick={exportZip}>Exportar ZIP</button>
      </div>
      <div class="spacer"></div>
      <div class="compile">
        <button class="primary run" disabled={!app.settings.main} title="Compilar ({kbd('Ctrl+Enter')})" onclick={() => app.compile()}>
          {#if app.compiling}<span class="spin"></span>{:else}▶{/if}
          Compilar
        </button>
        <button class="primary full" title="Compilación completa ({kbd('Ctrl+Shift+Enter')})" onclick={() => app.compile(true)}>⟳</button>
      </div>
      {#if app.compiling}
        <button class="ghost" onclick={() => api.cancelCompile()}>Detener</button>
      {/if}
      <div class="spacer"></div>
      <button class="icon" class:on={ui.problems} title="Problemas y salida" onclick={() => (ui.problems = !ui.problems)}>
        ⚠{#if errors}<span class="count">{errors}</span>{/if}
      </button>
      <button class="icon" class:on={ui.pdf} title="Vista previa PDF" onclick={() => (ui.pdf = !ui.pdf)}>▤</button>
      <button class="ai-btn" class:on={ui.ai} title="Asistente de IA: Claude Code, Codex… ({kbd('Ctrl+Shift+A')})" onclick={() => (ui.ai = !ui.ai)}>✦ IA</button>
      <button class="icon" title={theme.label} onclick={() => theme.cycle()}>{theme.icon}</button>
      <button class="icon" class:on={ui.settings} title="Ajustes" onclick={() => (ui.settings = !ui.settings)}>⚙</button>
    </header>

    {#if ui.settings}<Settings onclose={() => (ui.settings = false)} />{/if}
    {#if texInfo}<TexNotice info={texInfo} />{/if}

    <div class="main" bind:this={main}>
      {#if ui.sidebar}
        <aside style="width:{sidebarWidth}px">
          <div class="seg">
            <button class:sel={ui.sideTab === "files"} onclick={() => (ui.sideTab = "files")}>Archivos</button>
            <button class:sel={ui.sideTab === "outline"} onclick={() => (ui.sideTab = "outline")}>Esquema</button>
            <button class:sel={ui.sideTab === "search"} title={kbd("Ctrl+Shift+F")} onclick={() => (ui.sideTab = "search")}>Buscar</button>
          </div>
          {#if ui.sideTab === "files"}<FileTree />{:else if ui.sideTab === "outline"}<Outline />{:else}<SearchPanel />{/if}
        </aside>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="split" onpointerdown={drag("sidebar")}></div>
      {/if}
      <section class="center">
        <div class="editor"><Editor /></div>
        {#if ui.problems || ui.terminalStarted}
          <div class="problems" class:closed={!ui.problems}><Problems onclose={() => (ui.problems = false)} /></div>
        {/if}
      </section>
      {#if ui.pdf}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="split" onpointerdown={drag("pdf")}></div>
        <section class="pdf" style="width:{pdfWidth}%"><PdfViewer /></section>
      {/if}
      {#if ui.ai}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="split" onpointerdown={drag("ai")}></div>
        <section class="aipanel" style="width:{aiWidth}px"><AiPanel onclose={() => (ui.ai = false)} /></section>
      {/if}
    </div>

    <footer>
      <span class="lsp {app.lspStatus}" title="Autocompletado (texlab)">
        ● {app.lspStatus === "ready" ? "texlab" : app.lspStatus === "starting" ? "iniciando texlab…" : app.lspStatus === "error" ? "texlab no disponible" : ""}
      </span>
      <span>{app.settings.engine}</span>
      {#if app.lastResult}
        <button class="link" onclick={() => (ui.problems = true)}>
          <span class:bad={errors > 0}>{errors} errores</span> · {warnings} advertencias
        </button>
        <span>{app.lastResult.mode} · {(app.lastResult.durationMs / 1000).toFixed(2)} s</span>
      {/if}
      <div class="spacer"></div>
      <span>{kbd("Ctrl+Shift+P")} comandos · {kbd("Ctrl+P")} archivos · {kbd("Ctrl+Clic")} en PDF → código · {kbd("Ctrl+J")} → PDF</span>
    </footer>
  </div>
{/if}

{#if ui.palette === "commands"}
  <CommandPalette items={commands} placeholder="Escribe un comando…" onclose={() => (ui.palette = null)} />
{:else if ui.palette === "snippets"}
  <CommandPalette items={snippetItems} placeholder="Insertar snippet…" onclose={() => (ui.palette = null)} />
{:else if ui.palette === "files"}
  <CommandPalette items={fileItems} placeholder="Ir a archivo o sección…" onclose={() => (ui.palette = null)} />
{/if}

{#if app.toast}
  <div class="toast">{app.toast}</div>
{/if}

<style>
  .welcome {
    height: 100vh;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 30% 20%, var(--accent-soft), transparent 60%), var(--bg);
  }
  .theme {
    position: fixed;
    top: 12px;
    right: 12px;
  }
  .card {
    width: min(460px, 90vw);
    padding: 36px;
    border-radius: 16px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .logo {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--accent-text);
    font: 700 24px var(--font-serif);
    white-space: nowrap;
  }
  .logo span {
    font-style: italic;
  }
  h1 {
    margin: 16px 0 4px;
    font-size: 26px;
  }
  .sub {
    margin: 0 0 22px;
    color: var(--text-muted);
  }
  .welcome-notice {
    margin: -8px 0 18px;
    border-radius: 8px;
    overflow: hidden;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 26px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li .link {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
  }
  li .link:hover {
    background: var(--bg-hover);
  }
  li small {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    height: 46px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
  }
  .brand {
    font: 700 15px var(--font-serif);
    color: var(--accent);
  }
  .project {
    font-weight: 600;
    color: var(--text-strong);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu {
    display: flex;
    gap: 2px;
    margin-left: 8px;
  }
  .menu button {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
  }
  .menu button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .compile {
    display: flex;
  }
  .compile .run {
    border-radius: 8px 0 0 8px;
    min-width: 116px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .compile .full {
    border-radius: 0 8px 8px 0;
    border-left: 1px solid color-mix(in srgb, var(--accent-text) 25%, transparent);
  }
  .spin {
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, var(--accent-text) 40%, transparent);
    border-top-color: var(--accent-text);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .count {
    font-size: 10px;
    margin-left: 2px;
    color: var(--danger);
    font-weight: 700;
  }

  .main {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  aside {
    /* En ventanas estrechas los paneles laterales ceden espacio antes que el editor. */
    flex: 0 1 auto;
    min-width: 140px;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
  }
  .seg {
    display: flex;
    margin: 8px;
    padding: 2px;
    border-radius: 8px;
    background: var(--bg-hover);
  }
  .seg button {
    flex: 1;
    border: none;
    background: none;
    padding: 4px;
    font-size: 12px;
    color: var(--text-muted);
    border-radius: 6px;
  }
  .seg button.sel {
    background: var(--bg-panel);
    color: var(--text-strong);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
  }
  .split {
    width: 5px;
    margin: 0 -2px;
    z-index: 5;
    flex: none;
    cursor: col-resize;
    background: linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat;
  }
  .split:hover {
    background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
  }
  .center {
    flex: 1 0 0;
    /* El editor tiene prioridad: el PDF y los paneles laterales encogen antes. */
    min-width: min(420px, 36vw);
    display: flex;
    flex-direction: column;
  }
  .editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-editor);
  }
  .problems {
    height: 32%;
    min-height: 120px;
    border-top: 1px solid var(--border);
  }
  .aipanel {
    flex: 0 1 auto;
    min-width: 260px;
  }
  .ai-btn {
    border: 1px solid var(--accent);
    background: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 12.5px;
    padding: 4px 10px;
    border-radius: 999px;
    margin: 0 4px;
  }
  .ai-btn:hover,
  .ai-btn.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  .problems.closed {
    display: none;
  }
  .pdf {
    /* Encoge más deprisa que el resto (flex-shrink alto). */
    flex: 0 4 auto;
    min-width: 160px;
  }

  footer {
    height: 24px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 12px;
    font-size: 11.5px;
    color: var(--text-muted);
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
  }
  footer .link {
    font-size: inherit;
    color: inherit;
  }
  .lsp.ready {
    color: var(--ok);
  }
  .lsp.error {
    color: var(--warning);
  }
  .bad {
    color: var(--danger);
    font-weight: 600;
  }
  .toast {
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    border-radius: 10px;
    background: var(--text-strong);
    color: var(--bg);
    font-size: 13px;
    box-shadow: var(--shadow);
    z-index: 100;
    max-width: 70vw;
  }
</style>

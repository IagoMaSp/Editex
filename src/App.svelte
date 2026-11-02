<script lang="ts">
  import { basename, kbd } from "./lib/platform";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount, tick } from "svelte";
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
  import Icon from "./lib/Icon.svelte";
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

  async function openSearch() {
    ui.sidebar = true;
    if (!ui.search) ui.search = true; // Al montarse, el panel enfoca su campo.
    else {
      await tick();
      document.querySelector<HTMLInputElement>(".search-section input")?.select();
    }
  }

  async function setSetting<K extends keyof typeof app.settings>(key: K, value: (typeof app.settings)[K]) {
    app.settings[key] = value;
    await app.saveSettings();
    if (key === "spellLang") app.editor.view?.dispatch({ effects: recheckSpelling.of(null) });
  }

  const commands = $derived.by((): PaletteItem[] => {
    const c = (label: string, run: () => unknown, shortcut?: string, detail?: string): PaletteItem => ({ label, shortcut, detail, run: () => void run() });
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
      ...engines.map(([e, name]) => c(`Motor: ${name}`, () => setSetting("engine", e), undefined, app.settings.engine === e ? "actual" : undefined)),
      ...langs.map(([l, name]) => c(`Ortografía: ${name}`, () => setSetting("spellLang", l), undefined, app.settings.spellLang === l ? "actual" : undefined)),
      ...autos.map(([a, name]) => c(`Compilar automáticamente: ${name}`, () => setSetting("autoCompile", a), undefined, app.settings.autoCompile === a ? "actual" : undefined)),
      c("Insertar snippet…", () => (ui.palette = "snippets"), undefined, "o escribe el prefijo + Tab"),
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
      .map((f) => ({ label: f.split("/").pop()!, detail: f, icon: "fileText", run: () => app.openFile(f) }));
    const sections: PaletteItem[] = app.outline.map((o) => ({
      label: o.title || "(sin título)",
      detail: `${o.file}:${o.line}`,
      icon: "hash",
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
          icon: "code",
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
      void openSearch();
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
    <button class="icon theme" title={theme.label} aria-label={theme.label} onclick={() => theme.cycle()}><Icon name={theme.icon} /></button>
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
  <!-- Tres columnas: lateral (archivos/esquema/búsqueda) · edición (editor + problemas) · derecha (PDF, IA). -->
  <div class="app">
    <header class="bar topbar">
      <div class="group">
        <button class="icon" class:on={ui.sidebar} title="Panel lateral" aria-label="Panel lateral" onclick={() => (ui.sidebar = !ui.sidebar)}>
          <Icon name="sidebar" />
        </button>
        <span class="brand">Editex</span>
        <span class="sep" aria-hidden="true">/</span>
        <span class="project" title={app.root}>{projectName}</span>
        <nav class="menu">
          <button onclick={openFolder}>Abrir</button>
          <button onclick={importZip}>Importar ZIP</button>
          <button onclick={exportZip}>Exportar ZIP</button>
        </nav>
      </div>

      <div class="group center-group">
        <div class="compile">
          <button class="primary run" disabled={!app.settings.main} title="Compilar ({kbd('Ctrl+Enter')})" onclick={() => app.compile()}>
            {#if app.compiling}<span class="spin"></span>{:else}<Icon name="play" size={12} />{/if}
            Compilar
          </button>
          <button
            class="primary full"
            title="Compilación completa ({kbd('Ctrl+Shift+Enter')})"
            aria-label="Compilación completa"
            onclick={() => app.compile(true)}
          >
            <Icon name="rebuild" size={13} />
          </button>
        </div>
        {#if app.compiling}
          <button class="ghost" onclick={() => api.cancelCompile()}>Detener</button>
        {/if}
      </div>

      <div class="group end-group">
        <button class="icon" class:on={ui.problems} title="Problemas y salida" aria-label="Problemas y salida" onclick={() => (ui.problems = !ui.problems)}>
          <Icon name="alert" />
          {#if errors}<span class="count">{errors}</span>{/if}
        </button>
        <button class="icon" class:on={ui.pdf} title="Vista previa PDF" aria-label="Vista previa PDF" onclick={() => (ui.pdf = !ui.pdf)}>
          <Icon name="pdf" />
        </button>
        <button class="ai-btn" class:on={ui.ai} title="Asistente de IA: Claude Code, Codex… ({kbd('Ctrl+Shift+A')})" onclick={() => (ui.ai = !ui.ai)}>
          <Icon name="sparkle" size={14} /> IA
        </button>
        <span class="divider" aria-hidden="true"></span>
        <button class="icon" title={theme.label} aria-label={theme.label} onclick={() => theme.cycle()}><Icon name={theme.icon} /></button>
        <button class="icon" class:on={ui.settings} title="Ajustes" aria-label="Ajustes" onclick={() => (ui.settings = !ui.settings)}>
          <Icon name="sliders" />
        </button>
      </div>
    </header>

    {#if ui.settings}<Settings onclose={() => (ui.settings = false)} />{/if}
    {#if texInfo}<TexNotice info={texInfo} />{/if}

    <!-- Los anchos arrastrables van como variables CSS: el resto del estilo vive en <style>. -->
    <div class="workspace" bind:this={main} style:--sidebar-w="{sidebarWidth}px" style:--pdf-w="{pdfWidth}%" style:--ai-w="{aiWidth}px">
      {#if ui.sidebar}
        <aside class="sidebar">
          <div class="tabs" role="tablist">
            <button role="tab" aria-selected={ui.sideTab === "files"} class:sel={ui.sideTab === "files"} onclick={() => (ui.sideTab = "files")}>Archivos</button>
            <button role="tab" aria-selected={ui.sideTab === "outline"} class:sel={ui.sideTab === "outline"} onclick={() => (ui.sideTab = "outline")}>Esquema</button>
          </div>
          <div class="pane">
            {#if ui.sideTab === "files"}<FileTree />{:else}<Outline />{/if}
          </div>
          <section class="search-section" class:open={ui.search}>
            <button class="section-head" aria-expanded={ui.search} onclick={() => (ui.search = !ui.search)}>
              <span class="chev"><Icon name="chevron" size={12} /></span>
              Buscar
              <kbd>{kbd("Ctrl+Shift+F")}</kbd>
            </button>
            {#if ui.search}<SearchPanel />{/if}
          </section>
        </aside>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="splitter" onpointerdown={drag("sidebar")}></div>
      {/if}
      <section class="center">
        <div class="editor"><Editor /></div>
        {#if ui.problems || ui.terminalStarted}
          <div class="problems" class:closed={!ui.problems}><Problems onclose={() => (ui.problems = false)} /></div>
        {/if}
      </section>
      {#if ui.pdf}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="splitter" onpointerdown={drag("pdf")}></div>
        <section class="pdf"><PdfViewer /></section>
      {/if}
      {#if ui.ai}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="splitter" onpointerdown={drag("ai")}></div>
        <section class="aipanel"><AiPanel onclose={() => (ui.ai = false)} /></section>
      {/if}
    </div>

    <footer class="bar statusbar">
      <span class="item lsp {app.lspStatus}" title="Autocompletado (texlab)">
        <span class="dot"></span>
        {app.lspStatus === "ready" ? "texlab" : app.lspStatus === "starting" ? "iniciando texlab…" : app.lspStatus === "error" ? "texlab no disponible" : ""}
      </span>
      <span class="item">{app.settings.engine}</span>
      {#if app.lastResult}
        <button class="item link" onclick={() => (ui.problems = true)}>
          <span class:bad={errors > 0}>{errors} errores</span><span class="muted">·</span>{warnings} advertencias
        </button>
        <span class="item">{app.lastResult.mode} · {(app.lastResult.durationMs / 1000).toFixed(2)} s</span>
      {/if}
      <div class="spacer"></div>
      <span class="item hints">
        <kbd>{kbd("Ctrl+Shift+P")}</kbd> comandos
        <kbd>{kbd("Ctrl+P")}</kbd> archivos
        <kbd>{kbd("Ctrl+Clic")}</kbd> PDF → código
        <kbd>{kbd("Ctrl+J")}</kbd> → PDF
      </span>
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
  /* ── Bienvenida ─────────────────────────────────────────────── */

  .welcome {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--bg-base);
  }
  .theme {
    position: fixed;
    top: var(--space-2);
    right: var(--space-2);
  }
  .card {
    width: min(440px, 90vw);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
  }
  .logo {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--accent-text);
    font: var(--fw-semibold) 18px var(--font-serif);
    white-space: nowrap;
  }
  .logo span {
    font-style: italic;
  }
  h1 {
    margin: var(--space-4) 0 var(--space-1);
    font-size: var(--fs-display);
    font-weight: var(--fw-semibold);
    color: var(--text-strong);
  }
  .sub {
    margin: 0 0 var(--space-5);
    color: var(--text-secondary);
    line-height: var(--lh-base);
  }
  .welcome-notice {
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  h2 {
    margin: var(--space-5) 0 var(--space-2);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
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
    gap: 2px;
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius);
  }
  li .link:hover {
    background: var(--bg-hover);
  }
  li small {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  /* ── Marco: ocupa justo la ventana, sin scroll exterior ─────── */

  .app {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--bg-base);
  }

  /* Barras superior e inferior: misma altura y tipografía. */
  .bar {
    flex: none;
    height: var(--h-header);
    display: flex;
    align-items: center;
    padding: 0 var(--space-2);
    font-size: var(--fs-sm);
    line-height: 1;
    color: var(--text-secondary);
    background: var(--bg-surface);
    white-space: nowrap;
    overflow: hidden;
  }
  .bar button {
    font-size: var(--fs-sm);
  }
  .bar button.icon {
    width: 26px;
    height: 26px;
  }

  /* Barra superior: tres grupos; el de compilar queda centrado de verdad. */
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
  }
  .group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .end-group {
    justify-content: flex-end;
  }
  .brand {
    margin-left: var(--space-1);
    font: var(--fw-semibold) var(--fs-md) var(--font-serif);
    color: var(--text-strong);
  }
  .sep {
    color: var(--text-muted);
  }
  .project {
    font-weight: var(--fw-medium);
    color: var(--text-primary);
    min-width: 0;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu {
    display: flex;
    gap: 2px;
    margin-left: var(--space-2);
  }
  .menu button {
    border: none;
    background: none;
    min-height: 24px;
    padding: 0 var(--space-2);
    color: var(--text-secondary);
  }
  .menu button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .divider {
    width: 1px;
    height: 16px;
    margin: 0 var(--space-1);
    background: var(--border-subtle);
  }
  .spacer {
    flex: 1;
  }

  .compile {
    display: flex;
  }
  .compile button {
    min-height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .compile .run {
    border-radius: var(--radius) 0 0 var(--radius);
    min-width: 104px;
    gap: var(--space-2);
  }
  .compile .full {
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 0 var(--space-2);
    border-left-color: color-mix(in srgb, var(--accent-text) 25%, transparent);
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

  button.icon:has(.count) {
    width: auto;
    padding: 0 var(--space-1);
    gap: 2px;
  }
  .count {
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    color: var(--danger);
  }
  .ai-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 24px;
    padding: 0 var(--space-2);
    border-color: var(--border-strong);
    background: none;
    color: var(--text-secondary);
    font-weight: var(--fw-medium);
  }
  .ai-btn:hover {
    color: var(--text-primary);
  }
  .ai-btn.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* ── Columnas ───────────────────────────────────────────────── */

  .workspace {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .sidebar {
    /* En ventanas estrechas los paneles laterales ceden espacio antes que el editor. */
    flex: 0 1 auto;
    width: var(--sidebar-w);
    min-width: 140px;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
  }
  .center {
    flex: 1 0 0;
    /* El editor tiene prioridad: el PDF y los paneles laterales encogen antes. */
    min-width: min(420px, 36vw);
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
  }
  .editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .problems {
    height: 32%;
    min-height: 120px;
    border-top: 1px solid var(--border-subtle);
  }
  .problems.closed {
    display: none;
  }
  .pdf {
    /* Encoge más deprisa que el resto (flex-shrink alto). */
    flex: 0 4 auto;
    width: var(--pdf-w);
    min-width: 160px;
    background: var(--bg-pdf);
  }
  .aipanel {
    flex: 0 1 auto;
    width: var(--ai-w);
    min-width: 260px;
    background: var(--bg-surface);
  }

  .pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Búsqueda al pie del lateral: una cabecera plegable; abierta, ocupa la mitad inferior. */
  .search-section {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--border-subtle);
  }
  .search-section.open {
    flex: 0 0 50%;
  }
  .section-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--h-control);
    min-height: 0;
    padding: 0 var(--space-2);
    border: none;
    border-radius: 0;
    background: none;
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .section-head:hover {
    color: var(--text-primary);
  }
  .section-head .chev {
    display: flex;
    transition: transform var(--duration-fast) var(--ease);
  }
  .search-section.open .chev {
    transform: rotate(90deg);
  }
  .section-head kbd {
    margin-left: auto;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-muted);
  }

  /* Pestañas del lateral: cabecera de panel de 32px, el activo subrayado con el acento. */
  /* Las pestañas se reparten el ancho a partes iguales, con el texto centrado. */
  .tabs {
    flex: none;
    height: var(--h-header);
    display: flex;
    border-bottom: 1px solid var(--border-subtle);
  }
  .tabs button {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 0;
    background: none;
    padding: 0 var(--space-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    color: var(--text-muted);
    box-shadow: inset 0 -1px 0 transparent;
  }
  .tabs button:hover {
    color: var(--text-primary);
  }
  .tabs button.sel {
    color: var(--text-primary);
    box-shadow: inset 0 -1px 0 var(--accent);
  }

  /* Divisor: línea de 1px; la zona de agarre (5px) es invisible y se solapa con los paneles. */
  .splitter {
    position: relative;
    z-index: 5;
    flex: none;
    width: 1px;
    cursor: col-resize;
    background: var(--border-subtle);
    transition: background-color var(--duration) var(--ease);
  }
  .splitter::before {
    content: "";
    position: absolute;
    inset: 0 -2px;
  }
  .splitter:hover,
  .splitter:active {
    background: var(--accent);
  }

  /* ── Barra de estado ────────────────────────────────────────── */

  .statusbar {
    gap: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 100%;
  }
  .statusbar .link {
    min-height: 0;
    font-size: inherit;
    color: inherit;
  }
  .statusbar .link:hover {
    color: var(--text-primary);
  }
  .muted {
    color: var(--text-muted);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .lsp.ready {
    color: var(--ok);
  }
  .lsp.error {
    color: var(--warning);
  }
  .bad {
    color: var(--danger);
    font-weight: var(--fw-semibold);
  }
  .hints {
    color: var(--text-muted);
    gap: var(--space-1);
    overflow: hidden;
  }
  .hints kbd:not(:first-child) {
    margin-left: var(--space-2);
  }
  /* Mejor ocultar las pistas que cortarlas a mitad. */
  @media (max-width: 1180px) {
    .hints {
      display: none;
    }
  }

  .toast {
    position: fixed;
    bottom: calc(var(--h-header) + var(--space-2));
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    font-size: var(--fs-base);
    box-shadow: var(--shadow-popover);
    z-index: 100;
    max-width: 70vw;
  }
</style>

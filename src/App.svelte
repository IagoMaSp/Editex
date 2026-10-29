<script lang="ts">
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

  let sidebarWidth = $state(Number(localStorage.getItem("editex.sidebar")) || 240);
  let pdfWidth = $state(Number(localStorage.getItem("editex.pdf")) || 46);
  let showSidebar = $state(true);
  let showPdf = $state(true);
  let showProblems = $state(false);
  let showSettings = $state(false);
  let sideTab = $state<"files" | "outline">("files");
  let main = $state<HTMLDivElement>();

  const projectName = $derived(app.root?.split("/").pop() ?? "");
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
    const name = zip.split("/").pop()!.replace(/\.zip$/i, "");
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

  function drag(kind: "sidebar" | "pdf") {
    return (e: PointerEvent) => {
      e.preventDefault();
      const rect = main!.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        if (kind === "sidebar") sidebarWidth = Math.min(480, Math.max(160, ev.clientX - rect.left));
        else pdfWidth = Math.min(75, Math.max(20, ((rect.right - ev.clientX) / rect.width) * 100));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("dragging");
        localStorage.setItem("editex.sidebar", String(sidebarWidth));
        localStorage.setItem("editex.pdf", String(pdfWidth));
      };
      document.body.classList.add("dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  onMount(() => {
    void api.initialProject().then((dir) => {
      if (dir) void app.openProject(dir);
    });
  });

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    // Dentro del editor los atajos los gestiona CodeMirror.
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
    <div class="card">
      <div class="logo">E<span>χ</span></div>
      <h1>Editex</h1>
      <p class="sub">Editor LaTeX local, rápido y sin colas de compilación.</p>
      <div class="actions">
        <button class="primary" onclick={openFolder}>Abrir carpeta…</button>
        <button onclick={importZip}>Importar ZIP de Overleaf…</button>
      </div>
      {#if app.recents.length}
        <h2>Recientes</h2>
        <ul>
          {#each app.recents as r (r)}
            <li><button class="link" onclick={() => app.openProject(r)}>{r.split("/").pop()}<small>{r}</small></button></li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{:else}
  <div class="app">
    <header>
      <button class="icon" title="Panel lateral" onclick={() => (showSidebar = !showSidebar)}>☰</button>
      <span class="brand">Editex</span>
      <span class="project" title={app.root}>{projectName}</span>
      <div class="menu">
        <button onclick={openFolder}>Abrir</button>
        <button onclick={importZip}>Importar ZIP</button>
        <button onclick={exportZip}>Exportar ZIP</button>
      </div>
      <div class="spacer"></div>
      <div class="compile">
        <button class="primary run" disabled={!app.settings.main} title="Compilar (Ctrl+Enter)" onclick={() => app.compile()}>
          {#if app.compiling}<span class="spin"></span>{:else}▶{/if}
          Compilar
        </button>
        <button class="primary full" title="Compilación completa (Ctrl+Shift+Enter)" onclick={() => app.compile(true)}>⟳</button>
      </div>
      {#if app.compiling}
        <button class="ghost" onclick={() => api.cancelCompile()}>Detener</button>
      {/if}
      <div class="spacer"></div>
      <button class="icon" class:on={showProblems} title="Problemas y salida" onclick={() => (showProblems = !showProblems)}>
        ⚠{#if errors}<span class="count">{errors}</span>{/if}
      </button>
      <button class="icon" class:on={showPdf} title="Vista previa PDF" onclick={() => (showPdf = !showPdf)}>▤</button>
      <button class="icon" class:on={showSettings} title="Ajustes" onclick={() => (showSettings = !showSettings)}>⚙</button>
    </header>

    {#if showSettings}<Settings onclose={() => (showSettings = false)} />{/if}

    <div class="main" bind:this={main}>
      {#if showSidebar}
        <aside style="width:{sidebarWidth}px">
          <div class="seg">
            <button class:sel={sideTab === "files"} onclick={() => (sideTab = "files")}>Archivos</button>
            <button class:sel={sideTab === "outline"} onclick={() => (sideTab = "outline")}>Esquema</button>
          </div>
          {#if sideTab === "files"}<FileTree />{:else}<Outline />{/if}
        </aside>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="split" onpointerdown={drag("sidebar")}></div>
      {/if}
      <section class="center">
        <div class="editor"><Editor /></div>
        {#if showProblems}
          <div class="problems"><Problems onclose={() => (showProblems = false)} /></div>
        {/if}
      </section>
      {#if showPdf}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="split" onpointerdown={drag("pdf")}></div>
        <section class="pdf" style="width:{pdfWidth}%"><PdfViewer /></section>
      {/if}
    </div>

    <footer>
      <span class="lsp {app.lspStatus}" title="Autocompletado (texlab)">
        ● {app.lspStatus === "ready" ? "texlab" : app.lspStatus === "starting" ? "iniciando texlab…" : app.lspStatus === "error" ? "texlab no disponible" : ""}
      </span>
      <span>{app.settings.engine}</span>
      {#if app.lastResult}
        <button class="link" onclick={() => (showProblems = true)}>
          <span class:bad={errors > 0}>{errors} errores</span> · {warnings} advertencias
        </button>
        <span>{app.lastResult.mode} · {(app.lastResult.durationMs / 1000).toFixed(2)} s</span>
      {/if}
      <div class="spacer"></div>
      <span>Ctrl+Clic en el PDF → código · Ctrl+J → PDF</span>
    </footer>
  </div>
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
    display: grid;
    place-items: center;
    background: var(--accent);
    color: var(--accent-text);
    font: 700 26px var(--font-serif);
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
  }
  aside {
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    min-width: 0;
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
    flex: 1;
    min-width: 0;
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
  .pdf {
    flex: none;
    min-width: 0;
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

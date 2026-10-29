<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import type { FileNode } from "../api";
  import { api } from "../api";
  import { app } from "../store.svelte";

  // Archivos que genera LaTeX al compilar (de Editex van a .editex/, pero pueden venir de otros editores).
  const GENERATED =
    /\.(aux|log|fls|fdb_latexmk|synctex(\.gz)?|synctex\(busy\)|toc|lof|lot|out|bbl|blg|bcf|run\.xml|nav|snm|vrb|idx|ilg|ind|xdv|dvi|glo|gls|glg|ist|acn|acr|alg|loa|thm|mtc\d*|maf|ptc|brf|mmz|memo|xref|4ct|4tc|lg|tmp|editex-tmp)$/i;

  let showGenerated = $state(localStorage.getItem("editex.showGenerated") === "1");
  let expanded = $state<Record<string, boolean>>({});
  /** Creación en curso: tipo y carpeta destino ("" = raíz). */
  let creating = $state<null | { kind: "file" | "folder"; dir: string }>(null);
  let newName = $state("");
  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  let menu = $state<null | { x: number; y: number; node: FileNode | null }>(null);
  let drag = $state<null | { node: FileNode; x: number; y: number; target: string | null }>(null);
  let pending: { node: FileNode; x: number; y: number } | null = null;
  let suppressClick = false;

  const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

  function visible(list: FileNode[]): FileNode[] {
    return showGenerated ? list : list.filter((n) => n.is_dir || !GENERATED.test(n.name));
  }

  function toggleGenerated() {
    showGenerated = !showGenerated;
    localStorage.setItem("editex.showGenerated", showGenerated ? "1" : "0");
  }

  function startCreate(kind: "file" | "folder", dir = "") {
    menu = null;
    if (dir) expanded[dir] = true;
    creating = { kind, dir };
    newName = "";
  }

  async function create() {
    const name = newName.trim();
    const target = creating;
    creating = null;
    newName = "";
    if (!name || !target || !app.root) return;
    const path = join(target.dir, name);
    try {
      if (target.kind === "folder") await api.createFolder(app.root, path);
      else {
        const file = /\.[^/]+$/.test(name) ? path : `${path}.tex`;
        await api.writeFile(app.root, file, "");
        await app.refreshTree();
        await app.openFile(file);
      }
      await app.refreshTree();
    } catch (e) {
      app.notify(String(e));
    }
  }

  function startRename(node: FileNode) {
    menu = null;
    renaming = node.path;
    renameValue = node.name;
  }

  async function finishRename(node: FileNode) {
    const name = renameValue.trim();
    renaming = null;
    if (!name || name === node.name || name.includes("/")) return;
    await app.movePath(node.path, join(parentOf(node.path), name));
  }

  async function remove(node: FileNode) {
    menu = null;
    const what = node.is_dir ? `la carpeta «${node.name}» y todo su contenido` : `«${node.name}»`;
    if (await ask(`¿Mover ${what} a la papelera?`, { title: "Eliminar", kind: "warning", okLabel: "Mover a la papelera" })) {
      await app.trashPath(node.path);
    }
  }

  async function setMain(node: FileNode) {
    menu = null;
    app.settings.main = node.path;
    await app.saveSettings();
    await app.refreshOutline();
  }

  function openMenu(e: MouseEvent, node: FileNode | null) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, node };
  }

  // Arrastrar con eventos de puntero (más fiable que HTML5 DnD dentro del webview).
  function onPointerDown(e: PointerEvent, node: FileNode) {
    if (e.button !== 0 || renaming) return;
    pending = { node, x: e.clientX, y: e.clientY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function dropTargetAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
    if (!el) return null;
    const path = el.dataset.drop!;
    // Soltar sobre un archivo = soltar en su carpeta.
    return el.dataset.dir === "1" ? path : parentOf(path);
  }

  function onPointerMove(e: PointerEvent) {
    if (pending && !drag && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 5) {
      drag = { node: pending.node, x: e.clientX, y: e.clientY, target: null };
      document.body.classList.add("dragging-file");
    }
    if (drag) {
      const target = dropTargetAt(e.clientX, e.clientY);
      const node = drag.node;
      const valid = target !== null && target !== parentOf(node.path) && target !== node.path && !target.startsWith(node.path + "/");
      drag = { ...drag, x: e.clientX, y: e.clientY, target: valid ? target : null };
    }
  }

  async function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    pending = null;
    if (!drag) return;
    const { node, target } = drag;
    drag = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false));
    document.body.classList.remove("dragging-file");
    if (target === null) return;
    if (target) expanded[target] = true;
    await app.movePath(node.path, join(target, node.name));
  }

  function onRowClick(node: FileNode) {
    if (suppressClick) return;
    if (node.is_dir) expanded[node.path] = !expanded[node.path];
    else void app.openFile(node.path);
  }

  function onRowKey(e: KeyboardEvent, node: FileNode) {
    if (e.key === "F2") startRename(node);
    else if (e.key === "Delete") void remove(node);
  }

  function icon(node: FileNode) {
    if (node.is_dir) return expanded[node.path] ? "▾" : "▸";
    if (node.path === app.settings.main) return "★";
    if (/\.tex$/.test(node.name)) return "T";
    if (/\.bib$/.test(node.name)) return "B";
    if (/\.(png|jpe?g|pdf|svg|eps)$/i.test(node.name)) return "◫";
    return "·";
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === "Escape" && (menu = null)} />

<div class="tree">
  <div class="head">
    <span>Archivos</span>
    <button class="icon" title="Nuevo archivo" onclick={() => startCreate("file")}>＋</button>
    <button class="icon" title="Nueva carpeta" onclick={() => startCreate("folder")}>⊞</button>
    <button
      class="icon"
      class:on={showGenerated}
      title={showGenerated ? "Ocultar archivos generados (.aux, .log…)" : "Mostrar archivos generados (.aux, .log…)"}
      onclick={toggleGenerated}>◌</button
    >
  </div>

  {#snippet newInput(depth: number)}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="new"
      style="margin-left:{10 + depth * 14}px"
      autofocus
      placeholder={creating?.kind === "file" ? "nombre.tex" : "carpeta"}
      bind:value={newName}
      onkeydown={(e) => {
        if (e.key === "Enter") void create();
        if (e.key === "Escape") creating = null;
      }}
      onblur={() => void create()}
    />
  {/snippet}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="list"
    class:drop-root={drag?.target === ""}
    data-drop=""
    data-dir="1"
    oncontextmenu={(e) => openMenu(e, null)}
  >
    {#if creating?.dir === ""}{@render newInput(0)}{/if}
    {#snippet nodes(list: FileNode[], depth: number)}
      {#each visible(list) as node (node.path)}
        {#if renaming === node.path}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="new"
            style="margin-left:{10 + depth * 14}px"
            autofocus
            bind:value={renameValue}
            onfocus={(e) => {
              // Selecciona el nombre sin la extensión.
              const dot = renameValue.lastIndexOf(".");
              e.currentTarget.setSelectionRange(0, dot > 0 && !node.is_dir ? dot : renameValue.length);
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") void finishRename(node);
              if (e.key === "Escape") renaming = null;
            }}
            onblur={() => void finishRename(node)}
          />
        {:else}
          <button
            class="row"
            class:active={node.path === app.active}
            class:main={node.path === app.settings.main}
            class:drop={drag?.target === node.path}
            class:dragged={drag?.node.path === node.path}
            style="padding-left:{10 + depth * 14}px"
            title={node.path}
            data-drop={node.path}
            data-dir={node.is_dir ? "1" : "0"}
            onclick={() => onRowClick(node)}
            onpointerdown={(e) => onPointerDown(e, node)}
            oncontextmenu={(e) => openMenu(e, node)}
            onkeydown={(e) => onRowKey(e, node)}
          >
            <span class="ic" class:dir={node.is_dir}>{icon(node)}</span>
            <span class="name">{node.name}</span>
            {#if app.dirty[node.path]}<span class="dot"></span>{/if}
          </button>
        {/if}
        {#if node.is_dir && expanded[node.path]}
          {#if creating?.dir === node.path}{@render newInput(depth + 1)}{/if}
          {@render nodes(node.children, depth + 1)}
        {/if}
      {/each}
    {/snippet}
    {@render nodes(app.files, 0)}
  </div>
</div>

{#if drag}
  <div class="ghost" style="left:{drag.x + 12}px;top:{drag.y + 8}px">
    {drag.node.name}{drag.target !== null ? ` → ${drag.target || "raíz"}` : ""}
  </div>
{/if}

{#if menu}
  {@const node = menu.node}
  {@const dir = node ? (node.is_dir ? node.path : parentOf(node.path)) : ""}
  <div class="menu" style="left:{menu.x}px;top:{menu.y}px" role="menu">
    {#if node && !node.is_dir}
      <button onclick={() => ((menu = null), app.openFile(node.path))}>Abrir</button>
    {/if}
    <button onclick={() => startCreate("file", dir)}>Nuevo archivo{dir ? ` en ${dir}` : ""}</button>
    <button onclick={() => startCreate("folder", dir)}>Nueva carpeta{dir ? ` en ${dir}` : ""}</button>
    {#if node}
      <hr />
      <button onclick={() => startRename(node)}>Renombrar <kbd>F2</kbd></button>
      {#if node.name.endsWith(".tex") && node.path !== app.settings.main}
        <button onclick={() => setMain(node)}>Usar como archivo principal</button>
      {/if}
      <hr />
      <button class="danger" onclick={() => remove(node)}>Mover a la papelera <kbd>Supr</kbd></button>
    {/if}
  </div>
{/if}

<style>
  .tree {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 6px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .head span {
    flex: 1;
  }
  .new {
    display: block;
    width: calc(100% - 24px);
    margin: 2px 8px 2px 10px;
    padding: 3px 6px;
  }
  .list {
    overflow: auto;
    flex: 1;
    padding-bottom: 8px;
  }
  .list.drop-root {
    background: var(--accent-soft);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: none;
    border-radius: 0;
    padding: 4px 10px;
    text-align: left;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    touch-action: none;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--bg-selected);
    color: var(--text-strong);
  }
  .row.drop {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .row.dragged {
    opacity: 0.5;
  }
  .ic {
    width: 14px;
    flex: none;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-faint);
  }
  .ic.dir {
    font-size: 11px;
  }
  .main .ic {
    color: var(--accent);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .ghost {
    position: fixed;
    z-index: 60;
    pointer-events: none;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 12px;
    box-shadow: var(--shadow);
  }
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 210px;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    font-size: 13px;
  }
  .menu button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 5px 10px;
    border-radius: 5px;
  }
  .menu button:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
  .menu button.danger:hover {
    background: var(--danger);
    color: white;
  }
  kbd {
    font: 11px var(--font-mono);
    opacity: 0.6;
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
  :global(body.dragging-file) {
    cursor: grabbing;
    user-select: none;
  }
</style>

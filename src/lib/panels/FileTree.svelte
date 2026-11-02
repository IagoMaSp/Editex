<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import type { FileNode } from "../api";
  import { api } from "../api";
  import { app } from "../store.svelte";
  import Icon, { type IconName } from "../Icon.svelte";

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

  /** Errores/advertencias de la última compilación por archivo y carpeta. */
  const problems = $derived.by(() => {
    const out: Record<string, { error: number; warning: number }> = {};
    for (const d of app.diagnostics) {
      if (!d.file || d.file.startsWith("/") || d.severity === "info") continue;
      // Cuenta en el archivo y en cada carpeta que lo contiene.
      const parts = d.file.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const key = parts.slice(0, i).join("/");
        out[key] ??= { error: 0, warning: 0 };
        out[key][d.severity]++;
      }
    }
    return out;
  });

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

  function icon(node: FileNode): IconName {
    if (node.is_dir) return "folder";
    if (node.path === app.settings.main) return "star";
    if (/\.(tex|sty|cls)$/.test(node.name)) return "fileText";
    if (/\.bib$/.test(node.name)) return "book";
    if (/\.(png|jpe?g|pdf|svg|eps)$/i.test(node.name)) return "image";
    return "file";
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === "Escape" && (menu = null)} />

<div class="tree">
  <div class="head">
    <span>Proyecto</span>
    <button class="icon" title="Nuevo archivo" aria-label="Nuevo archivo" onclick={() => startCreate("file")}><Icon name="plus" size={14} /></button>
    <button class="icon" title="Nueva carpeta" aria-label="Nueva carpeta" onclick={() => startCreate("folder")}>
      <Icon name="folderPlus" size={14} />
    </button>
    <button
      class="icon"
      class:on={showGenerated}
      title={showGenerated ? "Ocultar archivos generados (.aux, .log…)" : "Mostrar archivos generados (.aux, .log…)"}
      aria-label="Archivos generados"
      aria-pressed={showGenerated}
      onclick={toggleGenerated}><Icon name={showGenerated ? "eye" : "eyeOff"} size={14} /></button
    >
  </div>

  {#snippet newInput(depth: number)}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="new"
      style:--depth={depth}
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
            style:--depth={depth}
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
            style:--depth={depth}
            title={node.path}
            aria-expanded={node.is_dir ? !!expanded[node.path] : undefined}
            data-drop={node.path}
            data-dir={node.is_dir ? "1" : "0"}
            onclick={() => onRowClick(node)}
            onpointerdown={(e) => onPointerDown(e, node)}
            oncontextmenu={(e) => openMenu(e, node)}
            onkeydown={(e) => onRowKey(e, node)}
          >
            <span class="chev" class:open={expanded[node.path]}>{#if node.is_dir}<Icon name="chevron" size={12} />{/if}</span>
            <span class="ic {icon(node)}"><Icon name={icon(node)} size={14} /></span>
            <span class="name" class:has-error={problems[node.path]?.error} class:has-warning={!problems[node.path]?.error && problems[node.path]?.warning}>{node.name}</span>
            {#if problems[node.path]?.error}
              <span class="badge err" title="{problems[node.path].error} errores">{problems[node.path].error}</span>
            {:else if problems[node.path]?.warning}
              <span class="badge warn" title="{problems[node.path].warning} advertencias">{problems[node.path].warning}</span>
            {/if}
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
  <div class="ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 8}px">
    {drag.node.name}{drag.target !== null ? ` → ${drag.target || "raíz"}` : ""}
  </div>
{/if}

{#if menu}
  {@const node = menu.node}
  {@const dir = node ? (node.is_dir ? node.path : parentOf(node.path)) : ""}
  <div class="menu" style:left="{menu.x}px" style:top="{menu.y}px" role="menu">
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
    /* Geometría de las filas: la sangría y las líneas guía salen de aquí. */
    --indent: 12px;
    --row-pad: var(--space-2);
    --chev: 16px;
    --guide: var(--border-subtle);
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .tree:hover {
    --guide: var(--border-strong);
  }
  .head {
    flex: none;
    height: var(--h-control);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 var(--space-1) 0 var(--space-3);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .head span {
    flex: 1;
  }
  .head button.icon {
    width: 22px;
    height: 22px;
  }
  .list {
    overflow: auto;
    flex: 1;
    padding-bottom: var(--space-2);
  }
  .list.drop-root {
    background: var(--accent-soft);
  }

  /* ── Filas ──────────────────────────────────────────────────── */

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: var(--h-row);
    min-height: 0;
    padding: 0 var(--row-pad) 0 calc(var(--row-pad) + var(--depth) * var(--indent));
    border: none;
    border-radius: 0;
    background: none;
    text-align: left;
    color: var(--text-primary);
    font-size: var(--fs-base);
    line-height: 1;
    cursor: pointer;
    touch-action: none;
    /* Solo el color de fondo, y casi inmediato: el árbol debe sentirse instantáneo. */
    transition: background-color var(--duration-fast) var(--ease);
  }
  /* Líneas guía: una por nivel de anidación, alineadas con el centro del chevron del padre. */
  .row::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--row-pad) + var(--chev) / 2 - 0.5px);
    width: calc(var(--depth) * var(--indent));
    background: repeating-linear-gradient(to right, var(--guide) 0 1px, transparent 1px var(--indent));
    pointer-events: none;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row:focus-visible {
    outline: 1px solid var(--focus-ring);
    outline-offset: -1px;
  }
  .row.active {
    background: var(--bg-active);
    color: var(--text-strong);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .row.drop {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .row.dragged {
    opacity: 0.5;
  }

  .chev {
    flex: none;
    width: var(--chev);
    display: flex;
    justify-content: center;
    color: var(--text-muted);
    transition: transform var(--duration-fast) var(--ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .ic {
    flex: none;
    display: flex;
    color: var(--text-muted);
  }
  .ic.folder {
    color: var(--text-secondary);
  }
  .ic.star {
    color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    margin-left: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .has-error {
    color: var(--danger);
  }
  .has-warning {
    color: var(--warning);
  }
  .badge {
    flex: none;
    min-width: 16px;
    height: 16px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    text-align: center;
  }
  .badge.err {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }
  .badge.warn {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 16%, transparent);
  }
  /* Cambios sin guardar. */
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-secondary);
  }

  /* Campo de nombre (crear/renombrar), alineado con el icono de la fila. */
  .new {
    display: block;
    height: 22px;
    margin: 1px var(--row-pad) 1px calc(var(--row-pad) + var(--depth) * var(--indent) + var(--chev) + var(--space-1));
    width: calc(100% - 2 * var(--row-pad) - var(--depth) * var(--indent) - var(--chev) - var(--space-1));
    padding: 0 var(--space-1);
  }

  /* ── Arrastre y menú contextual ─────────────────────────────── */

  .ghost {
    position: fixed;
    z-index: 60;
    pointer-events: none;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    box-shadow: var(--shadow-popover);
  }
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 210px;
    padding: var(--space-1);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-popover);
    font-size: var(--fs-base);
  }
  .menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    height: var(--h-row);
    min-height: 0;
    padding: 0 var(--space-2);
    text-align: left;
    border: none;
    border-radius: var(--radius);
    background: none;
  }
  .menu button:hover {
    background: var(--bg-hover);
  }
  .menu button.danger {
    color: var(--danger);
  }
  .menu button.danger:hover {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .menu kbd {
    border: none;
    padding: 0;
    color: var(--text-muted);
  }
  hr {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: var(--space-1) 0;
  }
  :global(body.dragging-file) {
    cursor: grabbing;
    user-select: none;
  }
</style>

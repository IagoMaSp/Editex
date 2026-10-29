<script lang="ts">
  import type { FileNode } from "../api";
  import { api } from "../api";
  import { app } from "../store.svelte";

  let expanded = $state<Record<string, boolean>>({});
  let creating = $state<null | "file" | "folder">(null);
  let newName = $state("");

  function toggle(path: string) {
    expanded[path] = !expanded[path];
  }

  async function create() {
    const name = newName.trim();
    const kind = creating;
    creating = null;
    newName = "";
    if (!name || !app.root) return;
    try {
      if (kind === "folder") await api.createFolder(app.root, name);
      else {
        const path = /\.[^/]+$/.test(name) ? name : `${name}.tex`;
        await api.writeFile(app.root, path, "");
        await app.refreshTree();
        await app.openFile(path);
      }
      await app.refreshTree();
    } catch (e) {
      app.notify(String(e));
    }
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

<div class="tree">
  <div class="head">
    <span>Archivos</span>
    <button class="icon" title="Nuevo archivo" onclick={() => (creating = "file")}>＋</button>
    <button class="icon" title="Nueva carpeta" onclick={() => (creating = "folder")}>⊞</button>
  </div>
  {#if creating}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="new"
      autofocus
      placeholder={creating === "file" ? "capitulos/intro.tex" : "carpeta"}
      bind:value={newName}
      onkeydown={(e) => {
        if (e.key === "Enter") void create();
        if (e.key === "Escape") creating = null;
      }}
      onblur={() => void create()}
    />
  {/if}
  <div class="list">
    {#snippet nodes(list: FileNode[], depth: number)}
      {#each list as node (node.path)}
        <button
          class="row"
          class:active={node.path === app.active}
          class:main={node.path === app.settings.main}
          style="padding-left:{10 + depth * 14}px"
          title={node.path}
          onclick={() => (node.is_dir ? toggle(node.path) : app.openFile(node.path))}
        >
          <span class="ic" class:dir={node.is_dir}>{icon(node)}</span>
          <span class="name">{node.name}</span>
          {#if app.dirty[node.path]}<span class="dot"></span>{/if}
        </button>
        {#if node.is_dir && expanded[node.path]}
          {@render nodes(node.children, depth + 1)}
        {/if}
      {/each}
    {/snippet}
    {@render nodes(app.files, 0)}
  </div>
</div>

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
    margin: 0 8px 6px;
  }
  .list {
    overflow: auto;
    flex: 1;
    padding-bottom: 8px;
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
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--bg-selected);
    color: var(--text-strong);
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
</style>

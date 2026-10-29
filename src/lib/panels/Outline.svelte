<script lang="ts">
  import { app } from "../store.svelte";
  import type { OutlineItem } from "../api";

  /** Doble clic: además del código, muestra la sección en el PDF. */
  async function showInPdf(item: OutlineItem) {
    await app.openFile(item.file, item.line);
    if (!app.ui.pdf) {
      // El visor se monta y carga el PDF antes de poder posicionarse.
      app.ui.pdf = true;
      await new Promise((r) => setTimeout(r, 800));
    }
    app.syncForward?.(item.line);
  }
</script>

<div class="outline">
  <div class="head">Esquema</div>
  <div class="list">
    {#each app.outline as item, i (i)}
      <button
        class="row level-{item.level}"
        style="padding-left:{12 + item.level * 12}px"
        title="{item.file}:{item.line} — doble clic para verlo en el PDF"
        onclick={() => app.openFile(item.file, item.line)}
        ondblclick={() => showInPdf(item)}
      >
        {item.title || "(sin título)"}
      </button>
    {:else}
      <p class="empty">Sin secciones</p>
    {/each}
  </div>
</div>

<style>
  .outline {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .head {
    padding: 8px 12px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .list {
    overflow: auto;
    flex: 1;
  }
  .row {
    display: block;
    width: 100%;
    border: none;
    border-radius: 0;
    background: none;
    text-align: left;
    padding: 4px 10px;
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .level-0,
  .level-1 {
    font-weight: 600;
    color: var(--text-strong);
  }
  .level-4,
  .level-5 {
    color: var(--text-muted);
  }
  .empty {
    padding: 4px 12px;
    color: var(--text-faint);
    font-size: 13px;
  }
</style>

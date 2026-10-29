<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../store.svelte";
  import { api } from "../api";
  import { recheckSpelling, type SpellMenuRequest } from "./spell";

  let host: HTMLDivElement;
  let menu = $state<(SpellMenuRequest & { suggestions: string[] | null }) | null>(null);

  onMount(() => {
    app.editor.mount(host);
    app.editor.onSpellMenu = async (req) => {
      menu = { ...req, suggestions: null };
      const suggestions = await api.spellSuggest(req.word, app.settings.spellLang).catch(() => []);
      if (menu?.from === req.from) menu = { ...req, suggestions };
    };
    return () => app.editor.destroy();
  });

  function replace(text: string) {
    if (!menu) return;
    menu.view.dispatch({ changes: { from: menu.from, to: menu.to, insert: text } });
    menu.view.focus();
    menu = null;
  }

  async function addWord() {
    if (!menu) return;
    const { word, view } = menu;
    menu = null;
    await api.spellAddWord(word);
    view.dispatch({ effects: recheckSpelling.of(null) });
  }
</script>

<svelte:window onclick={() => (menu = null)} onkeydown={(e) => e.key === "Escape" && (menu = null)} />

<div class="tabs">
  {#each app.openFiles as path (path)}
    <div class="tab" class:active={path === app.active}>
      <button class="label" title={path} onclick={() => app.openFile(path)}>
        {path.split("/").pop()}
      </button>
      <button class="close" title="Cerrar" onclick={() => app.closeFile(path)}>
        {app.dirty[path] ? "●" : "✕"}
      </button>
    </div>
  {/each}
</div>
<div class="host" bind:this={host} class:hidden={!app.active}></div>
{#if !app.active}
  <div class="placeholder">Abre un archivo del panel izquierdo</div>
{/if}

{#if menu}
  <div class="menu" style="left:{menu.x}px;top:{menu.y}px" role="menu">
    {#if menu.suggestions === null}
      <div class="muted">Buscando sugerencias…</div>
    {:else if menu.suggestions.length === 0}
      <div class="muted">Sin sugerencias</div>
    {:else}
      {#each menu.suggestions as s (s)}
        <button onclick={() => replace(s)}>{s}</button>
      {/each}
    {/if}
    <hr />
    <button onclick={addWord}>Añadir «{menu.word}» al diccionario</button>
  </div>
{/if}

<style>
  .tabs {
    display: flex;
    height: 36px;
    flex: none;
    overflow-x: auto;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }
  .tab {
    display: flex;
    align-items: center;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 13px;
  }
  .tab.active {
    background: var(--bg-editor);
    color: var(--text-strong);
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .tab button {
    border: none;
    background: none;
    border-radius: 0;
    color: inherit;
    height: 100%;
  }
  .label {
    padding: 0 4px 0 14px;
    white-space: nowrap;
  }
  .close {
    padding: 0 10px 0 4px;
    font-size: 11px;
    opacity: 0.7;
  }
  .close:hover {
    opacity: 1;
  }
  .host {
    flex: 1;
    min-height: 0;
  }
  .hidden {
    display: none;
  }
  .placeholder {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 200px;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    font-size: 13px;
  }
  .menu button {
    display: block;
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
  .menu .muted {
    padding: 5px 10px;
    color: var(--text-faint);
  }
  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>

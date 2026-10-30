<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { api, type FileMatches, type SearchOptions } from "../api";
  import { app } from "../store.svelte";
  import { basename } from "../platform";

  let query = $state("");
  let replacement = $state("");
  let regex = $state(false);
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let showReplace = $state(false);
  let results = $state<FileMatches[]>([]);
  let collapsed = $state<Record<string, boolean>>({});
  let error = $state<string | null>(null);
  let input: HTMLInputElement;
  let timer: number | undefined;
  let seq = 0;

  const total = $derived(results.reduce((n, f) => n + f.matches.length, 0));
  const opts = (): SearchOptions => ({ query, regex, caseSensitive, wholeWord });

  onMount(() => {
    // Si hay texto seleccionado en el editor, se usa como búsqueda inicial.
    const view = app.editor.view;
    const sel = view?.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    if (sel && !sel.includes("\n")) query = sel;
    input.focus();
    input.select();
    if (query) void run();
  });

  function schedule() {
    clearTimeout(timer);
    timer = window.setTimeout(run, 250);
  }

  async function run() {
    if (!app.root) return;
    const mine = ++seq;
    // Busca sobre lo guardado en disco: guardamos antes los cambios pendientes.
    await app.saveAll();
    try {
      const r = await api.searchProject(app.root, opts());
      if (mine !== seq) return;
      results = r;
      error = null;
    } catch (e) {
      if (mine === seq) {
        results = [];
        error = String(e);
      }
    }
  }

  async function replace(files: string[]) {
    if (!app.root || files.length === 0) return;
    const n = files.reduce((acc, f) => acc + (results.find((r) => r.file === f)?.matches.length ?? 0), 0);
    if (files.length > 1 && !(await ask(`¿Reemplazar ${n} coincidencias en ${files.length} archivos?`, { title: "Reemplazar", kind: "warning" }))) return;
    await app.saveAll();
    try {
      const done = await api.replaceInProject(app.root, opts(), replacement, files);
      app.notify(`${done} reemplazos realizados`);
      await app.reloadOpenFiles();
      await run();
    } catch (e) {
      app.notify(String(e));
    }
  }

  function highlight(text: string, from: number, to: number) {
    // Recorta el contexto para que la coincidencia quede visible.
    const start = Math.max(0, from - 12);
    return { pre: (start > 0 ? "…" : "") + text.slice(start, from).trimStart(), hit: text.slice(from, to), post: text.slice(to) };
  }
</script>

<div class="search">
  <div class="head">Buscar en el proyecto</div>
  <div class="form">
    <div class="row">
      <button class="icon small" title="Mostrar reemplazar" onclick={() => (showReplace = !showReplace)}>
        {showReplace ? "▾" : "▸"}
      </button>
      <div class="field">
        <input
          bind:this={input}
          bind:value={query}
          placeholder="Buscar"
          oninput={schedule}
          onkeydown={(e) => e.key === "Enter" && run()}
        />
        <div class="toggles">
          <button class:on={caseSensitive} title="Distinguir mayúsculas" onclick={() => ((caseSensitive = !caseSensitive), run())}>Aa</button>
          <button class:on={wholeWord} title="Palabra completa" onclick={() => ((wholeWord = !wholeWord), run())}>ab</button>
          <button class:on={regex} title="Expresión regular" onclick={() => ((regex = !regex), run())}>.*</button>
        </div>
      </div>
    </div>
    {#if showReplace}
      <div class="row">
        <span class="spacer-icon"></span>
        <div class="field">
          <input bind:value={replacement} placeholder={regex ? "Reemplazar ($1 = grupo)" : "Reemplazar"} />
          <div class="toggles">
            <button title="Reemplazar todo" disabled={!total} onclick={() => replace(results.map((r) => r.file))}>⇄</button>
          </div>
        </div>
      </div>
    {/if}
    <div class="summary">
      {#if error}<span class="err">{error}</span>
      {:else if query}{total} resultados en {results.length} archivos{total >= 5000 ? " (limitado)" : ""}{/if}
    </div>
  </div>
  <div class="list">
    {#each results as f (f.file)}
      <div class="file">
        <button class="fname" onclick={() => (collapsed[f.file] = !collapsed[f.file])}>
          <span class="chev">{collapsed[f.file] ? "▸" : "▾"}</span>
          <span class="name">{basename(f.file)}</span>
          <span class="dir">{f.file.includes("/") ? f.file.slice(0, f.file.lastIndexOf("/")) : ""}</span>
          <span class="n">{f.matches.length}</span>
        </button>
        {#if showReplace}
          <button class="icon small rep" title="Reemplazar en este archivo" onclick={() => replace([f.file])}>⇄</button>
        {/if}
      </div>
      {#if !collapsed[f.file]}
        {#each f.matches as m, i (i)}
          {@const h = highlight(m.text, m.from, m.to)}
          <button class="match" title="Línea {m.line}" onclick={() => app.openAt(f.file, m.line, m.from, m.to)}>
            <span class="ln">{m.line}</span>
            <span class="txt">{h.pre}<mark class:del={showReplace && replacement !== ""}>{h.hit}</mark>{#if showReplace && replacement !== ""}<ins>{replacement}</ins>{/if}{h.post}</span>
          </button>
        {/each}
      {/if}
    {/each}
  </div>
</div>

<style>
  .search {
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
  .form {
    padding: 0 8px 6px 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .spacer-icon {
    width: 22px;
    flex: none;
  }
  .icon.small {
    width: 22px;
    height: 22px;
    font-size: 11px;
    flex: none;
  }
  .field {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .field input {
    width: 100%;
    padding-right: 74px;
  }
  .toggles {
    position: absolute;
    right: 3px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 1px;
  }
  .toggles button {
    border: none;
    background: none;
    padding: 2px 4px;
    font: 600 11px var(--font-mono);
    color: var(--text-faint);
    border-radius: 4px;
  }
  .toggles button.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  .summary {
    font-size: 11.5px;
    color: var(--text-muted);
    padding-left: 26px;
    min-height: 15px;
  }
  .err {
    color: var(--danger);
  }
  .list {
    flex: 1;
    overflow: auto;
    padding-bottom: 8px;
  }
  .file {
    display: flex;
    align-items: center;
    padding-right: 6px;
  }
  .fname {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 0;
    background: none;
    padding: 4px 8px;
    font-size: 13px;
    text-align: left;
  }
  .fname:hover,
  .match:hover {
    background: var(--bg-hover);
  }
  .chev {
    font-size: 10px;
    color: var(--text-faint);
    width: 10px;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
  }
  .dir {
    flex: 1;
    color: var(--text-faint);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .n {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .match {
    display: flex;
    gap: 8px;
    width: 100%;
    border: none;
    border-radius: 0;
    background: none;
    padding: 2px 8px 2px 26px;
    text-align: left;
    font-size: 12.5px;
  }
  .ln {
    flex: none;
    min-width: 26px;
    text-align: right;
    color: var(--text-faint);
    font: 11px var(--font-mono);
    padding-top: 2px;
  }
  .txt {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-muted);
  }
  mark {
    background: var(--search-match);
    color: var(--text-strong);
    border-radius: 2px;
  }
  mark.del {
    text-decoration: line-through;
    background: var(--error-line);
  }
  ins {
    text-decoration: none;
    background: var(--selection);
    color: var(--text-strong);
    border-radius: 2px;
  }
</style>

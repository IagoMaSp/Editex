<script lang="ts">
  import { ask } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { api, type FileMatches, type SearchOptions } from "../api";
  import { app } from "../store.svelte";
  import { basename } from "../platform";
  import Icon from "../Icon.svelte";

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
  <div class="form">
    <div class="row">
      <button
        class="icon small chev-btn"
        class:open={showReplace}
        title="Mostrar reemplazar"
        aria-label="Mostrar reemplazar"
        aria-expanded={showReplace}
        onclick={() => (showReplace = !showReplace)}><Icon name="chevron" size={12} /></button
      >
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
            <button title="Reemplazar todo" aria-label="Reemplazar todo" disabled={!total} onclick={() => replace(results.map((r) => r.file))}
              ><Icon name="swap" size={13} /></button
            >
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
          <span class="chev" class:open={!collapsed[f.file]}><Icon name="chevron" size={12} /></span>
          <span class="name">{basename(f.file)}</span>
          <span class="dir">{f.file.includes("/") ? f.file.slice(0, f.file.lastIndexOf("/")) : ""}</span>
          <span class="n">{f.matches.length}</span>
        </button>
        {#if showReplace}
          <button class="icon small rep" title="Reemplazar en este archivo" aria-label="Reemplazar en este archivo" onclick={() => replace([f.file])}
            ><Icon name="swap" size={13} /></button
          >
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
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-2) var(--space-1) var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .spacer-icon {
    flex: none;
    width: 22px;
  }
  .icon.small {
    flex: none;
    width: 22px;
    height: 22px;
  }
  .chev-btn :global(svg),
  .chev :global(svg) {
    transition: transform var(--duration-fast) var(--ease);
  }
  .chev-btn.open :global(svg),
  .chev.open :global(svg) {
    transform: rotate(90deg);
  }
  .field {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .field input {
    width: 100%;
    padding-right: 72px;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 18px;
    min-height: 0;
    padding: 0 3px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    font: var(--fw-semibold) var(--fs-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .toggles button:hover {
    color: var(--text-primary);
  }
  .toggles button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .summary {
    min-height: 16px;
    padding-left: 24px;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .err {
    color: var(--danger);
  }

  .list {
    flex: 1;
    overflow: auto;
    padding-bottom: var(--space-2);
  }
  .file {
    display: flex;
    align-items: center;
    padding-right: var(--space-1);
  }
  .fname {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--h-row);
    min-height: 0;
    padding: 0 var(--space-2);
    border: none;
    border-radius: 0;
    background: none;
    font-size: var(--fs-base);
    text-align: left;
  }
  .fname:hover,
  .match:hover {
    background: var(--bg-hover);
  }
  .chev {
    flex: none;
    display: flex;
    color: var(--text-muted);
  }
  .name {
    font-weight: var(--fw-medium);
    white-space: nowrap;
  }
  .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .n {
    flex: none;
    min-width: 16px;
    height: 16px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--bg-active);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    text-align: center;
    color: var(--text-secondary);
  }
  .match {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 22px;
    min-height: 0;
    padding: 0 var(--space-2) 0 calc(var(--space-2) + 16px);
    border: none;
    border-radius: 0;
    background: none;
    text-align: left;
    font-size: var(--fs-sm);
  }
  .ln {
    flex: none;
    min-width: 3ch;
    text-align: right;
    font: var(--fs-xs) var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .txt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
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

<script lang="ts" module>
  import type { IconName } from "./Icon.svelte";

  export interface PaletteItem {
    label: string;
    /** Texto secundario (ruta, atajo...). */
    detail?: string;
    /** Icono a la izquierda. */
    icon?: IconName;
    /** Atajo de teclado (p. ej. el que devuelve `kbd()`). */
    shortcut?: string;
    run: () => void | Promise<void>;
  }

  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

  /** Coincidencia difusa por subsecuencia; mayor puntuación = mejor. null si no coincide. */
  export function fuzzyScore(query: string, text: string): number | null {
    const q = normalize(query).replace(/\s+/g, "");
    const t = normalize(text);
    if (!q) return 0;
    let score = 0;
    let ti = 0;
    let prev = -2;
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return null;
      if (found === prev + 1) score += 5;
      if (found === 0 || /[\s/_.\-\\]/.test(t[found - 1])) score += 8;
      score -= Math.min(found - ti, 10) * 0.5;
      prev = found;
      ti = found + 1;
    }
    return score - t.length * 0.05;
  }
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import Icon from "./Icon.svelte";

  let { items, placeholder, onclose }: { items: PaletteItem[]; placeholder: string; onclose: () => void } = $props();

  let query = $state("");
  let selected = $state(0);
  let input: HTMLInputElement;
  let list = $state<HTMLDivElement>();
  const PAGE = 8;

  const filtered = $derived.by(() => {
    if (!query.trim()) return items.slice(0, 60);
    return items
      .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.detail ?? ""}`) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, 60)
      .map((r) => r.item);
  });

  $effect(() => {
    void query;
    selected = 0;
  });

  onMount(() => input.focus());

  /** «Ctrl+Shift+P» → [Ctrl, Shift, P]; «⌘⇧P» → [⌘, ⇧, P]. */
  function keys(shortcut: string): string[] {
    if (shortcut.length > 1 && shortcut.includes("+")) return shortcut.split("+");
    return shortcut.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [shortcut];
  }

  async function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onclose();
    await item.run();
  }

  async function move(to: number) {
    const n = filtered.length;
    if (!n) return;
    selected = Math.max(0, Math.min(n - 1, to));
    await tick();
    list?.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }

  async function onKey(e: KeyboardEvent) {
    const n = filtered.length;
    if (e.key === "Escape") onclose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Las flechas dan la vuelta; Re Pág / Av Pág se paran en los extremos.
      if (n) await move((selected + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      await move(selected + (e.key === "PageDown" ? PAGE : -PAGE));
    } else if (e.key === "Enter") {
      e.preventDefault();
      await choose(filtered[selected]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="palette" role="dialog" tabindex="-1" aria-label={placeholder} onclick={(e) => e.stopPropagation()}>
    <div class="search">
      <Icon name="search" size={14} />
      <input
        bind:this={input}
        bind:value={query}
        {placeholder}
        onkeydown={onKey}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={filtered.length ? `palette-opt-${selected}` : undefined}
        aria-autocomplete="list"
        spellcheck="false"
      />
    </div>
    <div class="list" id="palette-list" role="listbox" bind:this={list}>
      {#each filtered as item, i (item.label + (item.detail ?? "") + i)}
        <!-- Selección con el ratón solo si se mueve: al desplazar con el teclado la lista pasa bajo el puntero. -->
        <button
          id="palette-opt-{i}"
          role="option"
          aria-selected={i === selected}
          tabindex="-1"
          class:sel={i === selected}
          onpointermove={() => (selected = i)}
          onclick={() => choose(item)}
        >
          {#if item.icon}<span class="ic"><Icon name={item.icon} size={14} /></span>{/if}
          <span class="label">{item.label}</span>
          {#if item.detail}<span class="detail">{item.detail}</span>{/if}
          {#if item.shortcut}
            <span class="keys">{#each keys(item.shortcut) as k, j (j)}<kbd>{k}</kbd>{/each}</span>
          {/if}
        </button>
      {:else}
        <p class="empty">Sin resultados</p>
      {/each}
    </div>
    <div class="foot" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
      <span><kbd>↵</kbd> abrir</span>
      <span><kbd>Esc</kbd> cerrar</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 14vh;
    background: var(--overlay);
    backdrop-filter: blur(4px);
  }
  .palette {
    width: min(600px, 90vw);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-popover);
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-muted);
  }
  .search input,
  .search input:focus {
    flex: 1;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: 0;
    outline: none;
    box-shadow: none;
    background: none;
    font-size: var(--fs-md);
    color: var(--text-primary);
  }

  .list {
    max-height: min(50vh, 420px);
    overflow: auto;
    padding: var(--space-1);
  }
  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 28px;
    min-height: 0;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    text-align: left;
    font-size: var(--fs-base);
    color: var(--text-primary);
    transition: none;
  }
  button:hover {
    background: none;
  }
  button.sel {
    background: var(--bg-active);
    color: var(--text-strong);
  }
  .ic {
    flex: none;
    display: flex;
    color: var(--text-muted);
  }
  .sel .ic {
    color: var(--text-secondary);
  }
  .label {
    flex: none;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .keys {
    flex: none;
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  kbd {
    min-width: 18px;
    height: 18px;
    padding: 0 var(--space-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    font: var(--fs-xs) / 1 var(--font-mono);
    color: var(--text-secondary);
  }
  .empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--fs-base);
    color: var(--text-muted);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: var(--h-row);
    padding: 0 var(--space-3);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .foot span {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .foot kbd {
    min-width: 16px;
    height: 16px;
    margin-right: 2px;
  }
</style>

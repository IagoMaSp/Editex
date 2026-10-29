<script lang="ts" module>
  export interface PaletteItem {
    label: string;
    /** Texto secundario (ruta, atajo...). */
    detail?: string;
    /** Icono o etiqueta corta a la izquierda. */
    kind?: string;
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

  let { items, placeholder, onclose }: { items: PaletteItem[]; placeholder: string; onclose: () => void } = $props();

  let query = $state("");
  let selected = $state(0);
  let input: HTMLInputElement;
  let list = $state<HTMLDivElement>();

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

  async function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onclose();
    await item.run();
  }

  async function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = filtered.length;
      if (!n) return;
      selected = (selected + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      await tick();
      list?.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      await choose(filtered[selected]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="palette" role="dialog" tabindex="-1" aria-label={placeholder} onclick={(e) => e.stopPropagation()}>
    <input bind:this={input} bind:value={query} {placeholder} onkeydown={onKey} />
    <div class="list" bind:this={list}>
      {#each filtered as item, i (item.label + (item.detail ?? "") + i)}
        <button class:sel={i === selected} onmouseenter={() => (selected = i)} onclick={() => choose(item)}>
          {#if item.kind}<span class="kind">{item.kind}</span>{/if}
          <span class="label">{item.label}</span>
          {#if item.detail}<span class="detail">{item.detail}</span>{/if}
        </button>
      {:else}
        <p class="empty">Sin resultados</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(0 0 0 / 0.15);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
  }
  .palette {
    width: min(620px, 90vw);
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  input {
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    padding: 12px 16px;
    font-size: 15px;
    background: transparent;
  }
  input:focus {
    outline: none;
  }
  .list {
    max-height: 50vh;
    overflow: auto;
    padding: 4px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    border: none;
    background: none;
    border-radius: 6px;
    padding: 7px 12px;
    text-align: left;
    font-size: 13.5px;
  }
  button.sel {
    background: var(--accent);
    color: var(--accent-text);
  }
  .kind {
    flex: none;
    width: 18px;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    opacity: 0.6;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .detail {
    margin-left: auto;
    padding-left: 12px;
    font-size: 12px;
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
  }
  .empty {
    padding: 8px 12px;
    color: var(--text-faint);
    font-size: 13px;
  }
</style>

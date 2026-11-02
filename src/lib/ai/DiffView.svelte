<script lang="ts">
  import { diffLines } from "diff";
  import { app } from "../store.svelte";
  import { relPath } from "./session.svelte";

  let { path, oldText, newText }: { path: string; oldText: string | null | undefined; newText: string } = $props();

  const CONTEXT = 3;
  const rel = $derived(app.root ? relPath(app.root, path) : null);

  type Row = { type: "add" | "del" | "same" | "gap"; text: string };

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    const parts = diffLines(oldText ?? "", newText);
    parts.forEach((part, i) => {
      const lines = part.value.replace(/\n$/, "").split("\n");
      if (part.added || part.removed) {
        for (const l of lines) out.push({ type: part.added ? "add" : "del", text: l });
        return;
      }
      // Contexto: solo unas líneas alrededor de cada cambio.
      const head = i > 0 ? lines.slice(0, CONTEXT) : [];
      const tail = i < parts.length - 1 ? lines.slice(-CONTEXT) : [];
      if (lines.length <= head.length + tail.length + 1) {
        for (const l of lines) out.push({ type: "same", text: l });
      } else {
        for (const l of head) out.push({ type: "same", text: l });
        out.push({ type: "gap", text: `${lines.length - head.length - tail.length} líneas sin cambios` });
        for (const l of tail) out.push({ type: "same", text: l });
      }
    });
    return out;
  });

  const stats = $derived({
    add: rows.filter((r) => r.type === "add").length,
    del: rows.filter((r) => r.type === "del").length,
  });
</script>

<div class="diff">
  <div class="head">
    {#if rel}
      <button class="link" onclick={() => app.openFile(rel)}>{rel}</button>
    {:else}
      <span>{path}</span>
    {/if}
    <span class="stats"><span class="a">+{stats.add}</span> <span class="d">−{stats.del}</span></span>
    {#if !oldText}<span class="new">nuevo</span>{/if}
  </div>
  <div class="body">
    {#each rows as r, i (i)}
      <div class="row {r.type}"><span class="sign">{r.type === "add" ? "+" : r.type === "del" ? "−" : ""}</span><span class="text">{r.text || " "}</span></div>
    {/each}
  </div>
</div>

<style>
  .diff {
    margin: var(--space-1) 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    overflow: hidden;
    font-size: var(--fs-sm);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--h-row);
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .head .link {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: inherit;
    color: var(--text-primary);
  }
  .head .link:hover {
    color: var(--accent);
  }
  .stats {
    margin-left: auto;
    display: flex;
    gap: var(--space-2);
    font-variant-numeric: tabular-nums;
  }
  .a {
    color: var(--ok);
  }
  .d {
    color: var(--danger);
  }
  .new {
    padding: 0 var(--space-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
  }
  /* Rejilla monoespaciada estricta: misma altura de línea, sin ligaduras, tabulador de 2. */
  .body {
    max-height: 320px;
    overflow: auto;
    background: var(--bg-inset);
    font: var(--fs-sm) / 18px var(--font-mono);
    font-variant-ligatures: none;
    tab-size: 2;
  }
  .row {
    display: flex;
    min-height: 18px;
    padding-right: var(--space-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sign {
    flex: none;
    width: 2ch;
    text-align: center;
    color: var(--text-muted);
    user-select: none;
  }
  .add {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  .add .sign {
    color: var(--ok);
  }
  .del {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .del .sign {
    color: var(--danger);
  }
  .gap {
    color: var(--text-muted);
    background: var(--bg-hover);
  }
</style>

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
      <div class="row {r.type}"><span class="sign">{r.type === "add" ? "+" : r.type === "del" ? "−" : ""}</span>{r.text || " "}</div>
    {/each}
  </div>
</div>

<style>
  .diff {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    margin: 6px 0;
    font-size: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--bg-hover);
    font-family: var(--font-mono);
  }
  .head .link {
    color: var(--accent);
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .stats {
    margin-left: auto;
  }
  .a {
    color: var(--ok);
  }
  .d {
    color: var(--danger);
  }
  .new {
    font-size: 10.5px;
    padding: 0 5px;
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .body {
    max-height: 320px;
    overflow: auto;
    font-family: var(--font-mono);
    background: var(--bg-editor);
  }
  .row {
    white-space: pre-wrap;
    word-break: break-word;
    padding: 0 8px 0 0;
    line-height: 1.5;
  }
  .sign {
    display: inline-block;
    width: 18px;
    text-align: center;
    color: var(--text-faint);
    user-select: none;
  }
  .add {
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .del {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .gap {
    color: var(--text-faint);
    font-style: italic;
    padding-left: 18px;
    background: var(--bg-panel);
  }
</style>

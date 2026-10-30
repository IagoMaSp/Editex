<script lang="ts">
  import { app } from "../store.svelte";
  import { explain } from "../errors";

  let { onclose }: { onclose: () => void } = $props();
  let tab = $state<"problems" | "log">("problems");
  let showInfo = $state(false);

  const list = $derived(app.diagnostics.filter((d) => showInfo || d.severity !== "info"));
  const counts = $derived({
    error: app.diagnostics.filter((d) => d.severity === "error").length,
    warning: app.diagnostics.filter((d) => d.severity === "warning").length,
    info: app.diagnostics.filter((d) => d.severity === "info").length,
  });

  function open(file: string | null, line: number | null) {
    if (file && !file.startsWith("/")) void app.openFile(file, line ?? 1);
  }
</script>

<div class="panel">
  <div class="tabs">
    <button class:sel={tab === "problems"} onclick={() => (tab = "problems")}>
      Problemas <span class="badge err">{counts.error}</span><span class="badge warn">{counts.warning}</span>
    </button>
    <button class:sel={tab === "log"} onclick={() => (tab = "log")}>Salida</button>
    <div class="spacer"></div>
    {#if tab === "problems"}
      <span class="hint">F8 / Shift+F8 para recorrerlos</span>
      <label><input type="checkbox" bind:checked={showInfo} /> Cajas over/underfull ({counts.info})</label>
    {/if}
    <button class="icon" title="Cerrar" onclick={onclose}>✕</button>
  </div>
  <div class="body">
    {#if tab === "problems"}
      {#each list as d, i (i)}
        <button class="item {d.severity}" onclick={() => open(d.file, d.line)}>
          <span class="sev">{d.severity === "error" ? "●" : d.severity === "warning" ? "▲" : "○"}</span>
          <span class="msg">
            {d.message}
            {#if explain(d.message)}<small class="why">{explain(d.message)}</small>{/if}
          </span>
          <span class="loc">{d.file ?? ""}{d.line ? `:${d.line}` : ""}</span>
        </button>
      {:else}
        <p class="empty">{app.lastResult ? "Sin problemas 🎉" : "Aún no se ha compilado"}</p>
      {/each}
    {:else}
      <pre>{app.lastResult?.output || "Sin salida"}</pre>
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-panel);
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    height: 34px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .tabs > button:not(.icon) {
    border: none;
    background: none;
    padding: 6px 10px;
    color: var(--text-muted);
    border-radius: 6px;
  }
  .tabs > button.sel {
    color: var(--text-strong);
    background: var(--bg-hover);
  }
  .spacer {
    flex: 1;
  }
  .hint {
    color: var(--text-faint);
    margin-right: 12px;
  }
  label {
    display: flex;
    gap: 4px;
    align-items: center;
    color: var(--text-muted);
    margin-right: 8px;
  }
  .badge {
    display: inline-block;
    min-width: 18px;
    padding: 0 5px;
    margin-left: 4px;
    border-radius: 9px;
    font-size: 11px;
    color: white;
  }
  .badge.err {
    background: var(--danger);
  }
  .badge.warn {
    background: var(--warning);
  }
  .body {
    flex: 1;
    overflow: auto;
  }
  .item {
    display: flex;
    gap: 10px;
    width: 100%;
    border: none;
    border-radius: 0;
    background: none;
    padding: 5px 12px;
    text-align: left;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .sev {
    flex: none;
    width: 12px;
  }
  .error .sev {
    color: var(--danger);
  }
  .warning .sev {
    color: var(--warning);
  }
  .info .sev {
    color: var(--text-faint);
  }
  .msg {
    flex: 1;
    word-break: break-word;
  }
  .why {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .loc {
    flex: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  pre {
    margin: 0;
    padding: 10px 12px;
    font-size: 12px;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    color: var(--text-muted);
  }
  .empty {
    padding: 10px 12px;
    color: var(--text-faint);
    font-size: 13px;
  }
</style>

<script lang="ts">
  import { app } from "../store.svelte";
  import { explain } from "../errors";
  import TerminalView from "../ai/TerminalView.svelte";
  import { loadAgents } from "../ai/agents";

  let { onclose }: { onclose: () => void } = $props();
  const ui = app.ui;
  const agents = loadAgents();
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
    <button class:sel={ui.bottomTab === "problems"} title="F8 / Shift+F8 para recorrerlos" onclick={() => (ui.bottomTab = "problems")}>
      Problemas <span class="badge err">{counts.error}</span><span class="badge warn">{counts.warning}</span>
    </button>
    <button class:sel={ui.bottomTab === "log"} onclick={() => (ui.bottomTab = "log")}>Salida</button>
    <button class:sel={ui.bottomTab === "terminal"} onclick={() => app.openTerminal()}>Terminal</button>
    <div class="spacer"></div>
    {#if ui.bottomTab === "terminal"}
      {#each agents as a (a.id)}
        <button class="launch" title="Ejecuta «{a.terminalCommand}» en la terminal" onclick={() => app.terminal?.run(a.terminalCommand)}>
          ▸ {a.name}
        </button>
      {/each}
      <button class="icon" title="Reiniciar terminal" onclick={() => app.terminal?.restart()}>⟳</button>
    {/if}
    {#if ui.bottomTab === "problems" && (counts.error || counts.warning)}
      <button
        class="launch"
        title="Pide al agente de IA que los corrija ahora"
        onclick={() =>
          app.askAi(
            counts.error
              ? "Corrige los errores de la última compilación. Explica brevemente qué cambiaste."
              : "Revisa las advertencias de la última compilación y corrige las que tengan solución.",
            true,
          )}
      >
        ✦ Arreglar con IA
      </button>
      <button class="launch" title="Adjunta todos los problemas al chat para preguntar lo que quieras" onclick={() => app.attachToAi(list.filter((d) => d.severity !== "info"))}>
        ＋ Añadir al chat
      </button>
    {/if}
    {#if ui.bottomTab === "problems"}
      <label title="Mostrar cajas over/underfull"><input type="checkbox" bind:checked={showInfo} /> Cajas ({counts.info})</label>
    {/if}
    <button class="icon" title="Cerrar" onclick={onclose}>✕</button>
  </div>
  <div class="body" class:hidden={ui.bottomTab === "terminal"}>
    {#if ui.bottomTab === "problems"}
      {#each list as d, i (i)}
        <button class="item {d.severity}" onclick={() => open(d.file, d.line)}>
          <span class="sev">{d.severity === "error" ? "●" : d.severity === "warning" ? "▲" : "○"}</span>
          <span class="msg">
            {d.message}
            {#if explain(d.message)}<small class="why">{explain(d.message)}</small>{/if}
          </span>
          <span class="loc">{d.file ?? ""}{d.line ? `:${d.line}` : ""}</span>
          <span
            class="to-ai"
            role="button"
            tabindex="0"
            title="Añadir este problema al chat de IA"
            onclick={(e) => {
              e.stopPropagation();
              app.attachToAi([d]);
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                app.attachToAi([d]);
              }
            }}>✦</span
          >
        </button>
      {:else}
        <p class="empty">{app.lastResult ? "Sin problemas 🎉" : "Aún no se ha compilado"}</p>
      {/each}
    {:else}
      <pre>{app.lastResult?.output || "Sin salida"}</pre>
    {/if}
  </div>
  <!-- La terminal sigue viva aunque se cambie de pestaña o se cierre el panel. -->
  {#if ui.terminalStarted && app.root}
    <div class="term" class:hidden={ui.bottomTab !== "terminal"}>
      {#key app.root}
        <TerminalView cwd={app.root} visible={ui.problems && ui.bottomTab === "terminal"} />
      {/key}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-panel);
  }
  .tabs {
    white-space: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
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
  .hidden {
    display: none !important;
  }
  .term {
    flex: 1;
    min-height: 0;
  }
  .launch {
    flex: none;
    white-space: nowrap;
    border: none;
    background: var(--bg-hover);
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 6px;
    margin-right: 2px;
  }
  .launch:hover {
    background: var(--accent);
    color: var(--accent-text);
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
  .to-ai {
    flex: none;
    opacity: 0;
    color: var(--accent);
    padding: 0 4px;
    border-radius: 4px;
  }
  .item:hover .to-ai,
  .to-ai:focus {
    opacity: 1;
  }
  .to-ai:hover {
    background: var(--accent);
    color: var(--accent-text);
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

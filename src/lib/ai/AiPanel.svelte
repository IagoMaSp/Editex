<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { tick } from "svelte";
  import { app } from "../store.svelte";
  import { kbd } from "../platform";
  import { ai, relPath, type ChatItem, type PromptContext } from "./session.svelte";
  import { DEFAULT_AGENTS, loadAgents, saveAgents, selectAgent, selectedAgentId, type AgentConfig } from "./agents";
  import { renderMarkdown } from "./markdown";
  import DiffView from "./DiffView.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let agents = $state<AgentConfig[]>(loadAgents());
  let agentId = $state(selectedAgentId());
  let input = $state("");
  let ctx = $state<PromptContext>({ file: true, selection: true, errors: false });
  let editingAgents = $state(false);
  let agentsJson = $state("");
  let agentsError = $state<string | null>(null);
  let list = $state<HTMLDivElement>();
  let textarea = $state<HTMLTextAreaElement>();

  const agent = $derived(agents.find((a) => a.id === agentId) ?? agents[0]);
  const connected = $derived(ai.status === "ready" || ai.status === "busy");
  const hasSelection = $derived.by(() => {
    void app.active;
    const v = app.editor.view;
    return !!v && !v.state.selection.main.empty;
  });
  const problemCount = $derived(app.diagnostics.filter((d) => d.severity !== "info").length);

  // Segundos que lleva conectando (la primera conexión descarga ~270 MB).
  let now = $state(Date.now());
  $effect(() => {
    if (ai.status !== "connecting") return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const elapsed = $derived(ai.connectingSince ? Math.round((now - ai.connectingSince) / 1000) : 0);

  const SUGGESTIONS = [
    "Corrige los errores de la última compilación",
    "Revisa la redacción y la ortografía del texto seleccionado",
    "Convierte la selección en una tabla LaTeX con booktabs",
    "Explica qué hace el preámbulo de main.tex",
  ];

  const ICONS: Record<string, string> = {
    read: "📖",
    edit: "✎",
    delete: "🗑",
    move: "↦",
    search: "🔍",
    execute: "▶",
    think: "💭",
    fetch: "🌐",
    switch_mode: "⇄",
    other: "•",
  };

  // Desplaza al final cuando llega contenido nuevo, si ya se estaba al final.
  let stick = true;
  $effect(() => {
    void ai.items.length;
    void ai.items[ai.items.length - 1];
    const last = ai.items[ai.items.length - 1];
    if (last && "text" in last) void last.text;
    void ai.permission;
    if (stick) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  // «Arreglar con IA» y similares llegan por app.aiRequest.
  $effect(() => {
    const req = app.aiRequest;
    if (!req) return;
    app.aiRequest = null;
    ctx.errors = req.errors;
    void send(req.text);
  });

  function onScroll() {
    if (!list) return;
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  async function connect() {
    selectAgent(agent.id);
    await ai.connect(agent);
  }

  async function send(text = input) {
    if (!text.trim()) return;
    if (!connected) {
      await connect();
      if (ai.status !== "ready") return;
    }
    input = "";
    stick = true;
    const attachments = app.aiAttachments;
    app.aiAttachments = [];
    await ai.send(
      text,
      {
        file: ctx.file,
        selection: ctx.selection && hasSelection,
        errors: ctx.errors,
      },
      attachments,
    );
    textarea?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape" && ai.status === "busy") void ai.cancel();
  }

  // Los enlaces de las respuestas se abren en el navegador del sistema.
  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a[data-external]") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    void openUrl(a.href);
  }

  function openLocation(path: string, line?: number | null) {
    const rel = app.root ? relPath(app.root, path) : null;
    if (rel) void app.openFile(rel, line ?? undefined);
  }

  function editAgents() {
    agentsJson = JSON.stringify(agents, null, 2);
    agentsError = null;
    editingAgents = true;
  }

  function saveAgentsJson() {
    try {
      const parsed = JSON.parse(agentsJson) as AgentConfig[];
      if (!Array.isArray(parsed) || parsed.some((a) => !a.id || !a.name || !a.command || !Array.isArray(a.args)))
        throw new Error("Cada agente necesita id, name, command y args (lista).");
      agents = parsed;
      saveAgents(parsed);
      if (!parsed.some((a) => a.id === agentId)) agentId = parsed[0].id;
      editingAgents = false;
    } catch (e) {
      agentsError = String((e as Error).message ?? e);
    }
  }

  function resetAgents() {
    agentsJson = JSON.stringify(DEFAULT_AGENTS, null, 2);
  }

  function statusLabel() {
    return {
      off: "Desconectado",
      connecting: "Conectando…",
      ready: "Listo",
      busy: "Trabajando…",
      auth: "Necesita iniciar sesión",
      error: "Error",
    }[ai.status];
  }

  const itemKey = (item: ChatItem) => item.id;
</script>

<div class="ai">
  <div class="head">
    <span class="title">✦ IA</span>
    <select bind:value={agentId} disabled={ai.status === "connecting" || ai.status === "busy"} onchange={() => selectAgent(agentId)}>
      {#each agents as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
    </select>
    <span class="status {ai.status}" title={statusLabel()}>●</span>
    <div class="spacer"></div>
    {#if connected}
      <button class="icon" title="Nueva conversación" onclick={() => ai.newChat()}>＋</button>
      <button class="icon" title="Desconectar" onclick={() => ai.disconnect()}>⏻</button>
    {/if}
    <button class="icon" title="Configurar agentes" onclick={editAgents}>⚙</button>
    <button class="icon" title="Cerrar panel" onclick={onclose}>✕</button>
  </div>

  {#if connected && ai.modes.length > 1}
    <div class="modes">
      <span>Modo</span>
      <select value={ai.currentMode} onchange={(e) => ai.setMode((e.target as HTMLSelectElement).value)}>
        {#each ai.modes as m (m.id)}<option value={m.id} title={m.description ?? ""}>{m.name}</option>{/each}
      </select>
    </div>
  {/if}

  {#if editingAgents}
    <div class="agents-editor">
      <p>
        Cualquier agente compatible con <strong>ACP</strong>. <code>command</code>/<code>args</code>: proceso que habla ACP;
        <code>terminalCommand</code>: para la terminal; <code>loginCommand</code>: para iniciar sesión.
      </p>
      <textarea bind:value={agentsJson} spellcheck="false"></textarea>
      {#if agentsError}<p class="err">{agentsError}</p>{/if}
      <div class="row">
        <button onclick={resetAgents}>Restaurar predeterminados</button>
        <div class="spacer"></div>
        <button onclick={() => (editingAgents = false)}>Cancelar</button>
        <button class="primary" onclick={saveAgentsJson}>Guardar</button>
      </div>
    </div>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="messages" bind:this={list} onscroll={onScroll} onclick={onClick}>
    {#if ai.items.length === 0}
      <div class="empty">
        {#if ai.status === "off" || ai.status === "error"}
          <p>
            Conecta <strong>{agent?.name}</strong> para pedirle cambios en el documento. Usa tu propia cuenta: la misma
            sesión que en la terminal.
          </p>
          <button class="primary" onclick={connect}>Conectar {agent?.name}</button>
          <p class="small">
            La primera vez descarga el adaptador ACP con <code>npx</code> (necesita Node.js). ¿Prefieres la terminal?
            <button class="link" onclick={() => app.openTerminal(agent?.terminalCommand)}>Abrir {agent?.terminalCommand} en la terminal</button>
          </p>
        {:else if ai.status === "connecting"}
          <p><span class="spin"></span> Iniciando {agent?.name}… {elapsed > 3 ? `${elapsed} s` : ""}</p>
          {#if elapsed > 8}
            <p class="small">
              La primera vez se descarga el adaptador y el motor de {agent?.name} (unos 270 MB): puede tardar un par de
              minutos. Las siguientes veces arranca en segundos.
            </p>
          {/if}
          <button onclick={() => ai.disconnect()}>Cancelar</button>
        {:else}
          <p>¿Qué quieres hacer?</p>
          {#each SUGGESTIONS as s (s)}
            <button class="suggestion" onclick={() => send(s)}>{s}</button>
          {/each}
        {/if}
      </div>
    {/if}

    {#each ai.items as item (itemKey(item))}
      {#if item.kind === "user"}
        <div class="user">
          {#if item.context.length}
            <div class="chips">{#each item.context as c (c)}<span class="chip">{c}</span>{/each}</div>
          {/if}
          {item.text}
        </div>
      {:else if item.kind === "agent"}
        <div class="agent md">{@html renderMarkdown(item.text)}</div>
      {:else if item.kind === "thought"}
        <details class="thought"><summary>Razonamiento</summary><div class="md">{@html renderMarkdown(item.text)}</div></details>
      {:else if item.kind === "tool"}
        <div class="tool {item.status}">
          <div class="tool-head">
            <span class="ic">{ICONS[item.toolKind ?? "other"] ?? "•"}</span>
            <span class="tool-title">{item.title}</span>
            <span class="tool-status">
              {item.status === "completed" ? "✓" : item.status === "failed" ? "✕" : item.status === "in_progress" ? "…" : ""}
            </span>
          </div>
          {#each item.locations.filter((l) => !item.content.some((c) => c.type === "diff")) as loc, i (i)}
            <button class="loc" onclick={() => openLocation(loc.path, loc.line)}>
              {(app.root && relPath(app.root, loc.path)) || loc.path}{loc.line ? `:${loc.line}` : ""}
            </button>
          {/each}
          {#each item.content as c, i (i)}
            {#if c.type === "diff" && ai.permission?.request.toolCall.toolCallId !== item.toolCallId}
              <DiffView path={c.path} oldText={c.oldText} newText={c.newText} />
            {:else if c.type === "content" && c.content.type === "text" && c.content.text.trim()}
              <details class="tool-out"><summary>Resultado</summary><pre>{c.content.text}</pre></details>
            {/if}
          {/each}
        </div>
      {:else if item.kind === "plan"}
        <div class="plan">
          <div class="plan-title">Plan</div>
          {#each item.entries as e, i (i)}
            <div class="plan-entry {e.status}">
              <span>{e.status === "completed" ? "☑" : e.status === "in_progress" ? "◐" : "☐"}</span>
              {e.content}
            </div>
          {/each}
        </div>
      {:else if item.kind === "notice"}
        <div class="notice" class:error={item.error}>{item.text}</div>
      {/if}
    {/each}

    {#if ai.status === "busy" && !ai.permission}
      <div class="working"><span class="spin"></span> {ai.agentName} está trabajando…</div>
    {/if}

    {#if ai.permission}
      {@const p = ai.permission}
      <div class="permission">
        <div class="perm-title">{ai.agentName} quiere: <strong>{p.request.toolCall.title ?? "realizar una acción"}</strong></div>
        {#each p.request.toolCall.content ?? [] as c, i (i)}
          {#if c.type === "diff"}<DiffView path={c.path} oldText={c.oldText} newText={c.newText} />{/if}
        {/each}
        <div class="perm-options">
          {#each p.request.options as o (o.optionId)}
            <button
              class:primary={o.kind === "allow_once"}
              class:danger={o.kind.startsWith("reject")}
              onclick={() => p.resolve(o.optionId)}>{o.name}</button
            >
          {/each}
        </div>
      </div>
    {/if}

    {#if ai.status === "auth"}
      <div class="auth">
        <p>Inicia sesión en {ai.agentName} y vuelve a intentarlo.</p>
        <div class="row">
          {#each ai.authMethods as m (m.id)}
            <button onclick={() => ai.authenticate(m.id)} title={m.description ?? ""}>{m.name}</button>
          {/each}
          {#if agent?.loginCommand}
            <button onclick={() => app.openTerminal(agent.loginCommand)}>Iniciar sesión en la terminal</button>
          {/if}
          <button class="primary" onclick={() => ai.retry()}>Reintentar</button>
        </div>
      </div>
    {/if}

    {#if ai.edited.length}
      <div class="edited">
        Archivos modificados:
        {#each ai.edited as f (f)}<button class="link" onclick={() => app.openFile(f)}>{f}</button>{/each}
        <span class="hint">({kbd("Ctrl+Z")} en el editor deshace los cambios en archivos abiertos)</span>
      </div>
    {/if}

    {#if ai.status === "error" && ai.items.length}
      <div class="row"><button class="primary" onclick={connect}>Reintentar</button></div>
    {/if}

    {#if ai.log.length && (ai.status === "connecting" || ai.status === "error" || ai.status === "auth")}
      <details class="log" open={ai.status === "error"}>
        <summary>Registro del agente</summary>
        <pre>{ai.log.slice(-40).join("\n")}</pre>
      </details>
    {/if}
  </div>

  <div class="composer">
    {#if app.aiAttachments.length}
      <div class="attachments">
        {#each app.aiAttachments as d, i (i)}
          <span class="att {d.severity}" title={d.message}>
            {d.severity === "error" ? "●" : "▲"}
            {d.file ? d.file.split("/").pop() : "?"}{d.line ? `:${d.line}` : ""} — {d.message.slice(0, 60)}{d.message.length > 60 ? "…" : ""}
            <button title="Quitar" onclick={() => (app.aiAttachments = app.aiAttachments.filter((_, j) => j !== i))}>✕</button>
          </span>
        {/each}
      </div>
    {/if}
    <div class="ctx">
      <label class:off={!app.active}><input type="checkbox" bind:checked={ctx.file} disabled={!app.active} /> Archivo actual</label>
      <label class:off={!hasSelection}><input type="checkbox" bind:checked={ctx.selection} disabled={!hasSelection} /> Selección</label>
      <label class:off={!app.diagnostics.length}>
        <input type="checkbox" bind:checked={ctx.errors} disabled={!app.diagnostics.length} /> Todos los errores y advertencias{problemCount ? ` (${problemCount})` : ""}
      </label>
    </div>
    <div class="input">
      <textarea
        bind:this={textarea}
        bind:value={input}
        rows="3"
        placeholder={app.aiAttachments.length
          ? "¿Qué quieres hacer con estos problemas? (p. ej. «corrígelos» o «explícame qué pasa»)"
          : connected
            ? `Pide algo a ${ai.agentName}… (Enter envía, Shift+Enter salto de línea)`
            : `Escribe y se conectará ${agent?.name}`}
        onkeydown={onKey}
        disabled={ai.status === "connecting"}
      ></textarea>
      {#if ai.status === "busy"}
        <button class="stop" title="Detener (Esc)" onclick={() => ai.cancel()}>■</button>
      {:else}
        <button class="primary send" title="Enviar (Enter)" disabled={!input.trim()} onclick={() => send()}>↑</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .ai {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-panel);
    font-size: 13.5px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .title {
    font-weight: 700;
    color: var(--accent);
  }
  .head select {
    font-size: 12.5px;
    padding: 2px 6px;
  }
  .status {
    font-size: 10px;
    color: var(--text-faint);
  }
  .status.ready {
    color: var(--ok);
  }
  .status.busy,
  .status.connecting {
    color: var(--warning);
  }
  .status.error,
  .status.auth {
    color: var(--danger);
  }
  .spacer {
    flex: 1;
  }
  .modes {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }
  .modes select {
    font-size: 12px;
    padding: 2px 6px;
  }
  .agents-editor {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .agents-editor p {
    margin: 0;
  }
  .agents-editor textarea {
    height: 220px;
    font: 12px var(--font-mono);
    background: var(--bg-editor);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px;
    resize: vertical;
  }
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .err {
    color: var(--danger);
  }
  .messages {
    flex: 1;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .empty {
    margin: auto 0;
    text-align: center;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .empty p {
    margin: 0;
  }
  .small {
    font-size: 12px;
    color: var(--text-faint);
  }
  .suggestion {
    width: 100%;
    text-align: left;
    font-size: 12.5px;
  }
  .user {
    align-self: flex-end;
    max-width: 90%;
    padding: 8px 12px;
    border-radius: 12px 12px 4px 12px;
    background: var(--accent);
    color: var(--accent-text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 4px;
  }
  .chip {
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent-text) 20%, transparent);
  }
  .agent {
    line-height: 1.55;
    word-break: break-word;
  }
  .md :global(p) {
    margin: 0 0 0.6em;
  }
  .md :global(p:last-child) {
    margin-bottom: 0;
  }
  .md :global(pre) {
    background: var(--bg-editor);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    overflow-x: auto;
    font-size: 12px;
  }
  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--bg-hover);
    padding: 0 3px;
    border-radius: 3px;
  }
  .md :global(pre code) {
    background: none;
    padding: 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0.3em 0;
    padding-left: 1.4em;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .md :global(table) {
    border-collapse: collapse;
    font-size: 12px;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: 2px 6px;
  }
  .thought {
    font-size: 12px;
    color: var(--text-muted);
  }
  .thought summary {
    cursor: pointer;
    color: var(--text-faint);
  }
  .tool {
    border-left: 2px solid var(--border-strong);
    padding: 2px 0 2px 10px;
    font-size: 12.5px;
  }
  .tool.completed {
    border-left-color: var(--ok);
  }
  .tool.failed {
    border-left-color: var(--danger);
  }
  .tool-head {
    display: flex;
    gap: 6px;
    align-items: baseline;
    color: var(--text-muted);
  }
  .tool-title {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
  }
  .tool-status {
    color: var(--text-faint);
  }
  .loc {
    border: none;
    background: none;
    padding: 0;
    font: 11.5px var(--font-mono);
    color: var(--accent);
    display: block;
  }
  .tool-out summary {
    cursor: pointer;
    color: var(--text-faint);
    font-size: 11.5px;
  }
  .tool-out pre {
    max-height: 200px;
    overflow: auto;
    font-size: 11.5px;
    background: var(--bg-editor);
    padding: 6px;
    border-radius: 6px;
    white-space: pre-wrap;
  }
  .plan {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12.5px;
  }
  .plan-title {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .plan-entry {
    display: flex;
    gap: 6px;
  }
  .plan-entry.completed {
    color: var(--text-faint);
    text-decoration: line-through;
  }
  .notice {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
  .notice.error {
    color: var(--danger);
    white-space: pre-wrap;
    text-align: left;
  }
  .working {
    color: var(--text-muted);
    font-size: 12.5px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .permission,
  .auth {
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 10px;
    background: var(--bg-editor);
  }
  .auth p {
    margin: 0 0 8px;
  }
  .perm-title {
    margin-bottom: 6px;
  }
  .perm-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .perm-options button {
    font-size: 12.5px;
  }
  .perm-options .danger:hover {
    background: var(--danger);
    color: white;
  }
  .edited {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }
  .edited .link {
    color: var(--accent);
    font: 12px var(--font-mono);
  }
  .hint {
    color: var(--text-faint);
  }
  .log summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--text-faint);
  }
  .log pre {
    font-size: 11px;
    max-height: 180px;
    overflow: auto;
    white-space: pre-wrap;
    color: var(--text-muted);
  }
  .composer {
    border-top: 1px solid var(--border);
    padding: 8px;
    flex: none;
  }
  .attachments {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
    max-height: 120px;
    overflow: auto;
  }
  .att {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    padding: 3px 4px 3px 8px;
    border-radius: 6px;
    background: var(--error-line);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .att.warning {
    background: var(--warning-line);
  }
  .att.error {
    color: var(--text);
  }
  .att button {
    margin-left: auto;
    border: none;
    background: none;
    padding: 0 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .ctx {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 11.5px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .ctx label {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .ctx label.off {
    opacity: 0.45;
  }
  .input {
    position: relative;
  }
  .input textarea {
    width: 100%;
    resize: none;
    font: inherit;
    font-size: 13px;
    padding: 8px 44px 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-editor);
    color: var(--text);
  }
  .input textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .send,
  .stop {
    position: absolute;
    right: 8px;
    bottom: 10px;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 8px;
  }
  .stop {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }
  .spin {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { tick } from "svelte";
  import { app } from "../store.svelte";
  import { kbd } from "../platform";
  import { ai, relPath, type ChatItem, type PromptContext } from "./session.svelte";
  import { DEFAULT_AGENTS, loadAgents, saveAgents, selectAgent, selectedAgentId, type AgentConfig } from "./agents";
  import { renderMarkdown } from "./markdown";
  import DiffView from "./DiffView.svelte";
  import Icon, { type IconName } from "../Icon.svelte";

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

  const ICONS: Record<string, IconName> = {
    read: "fileText",
    edit: "pencil",
    delete: "trash",
    move: "arrowRight",
    search: "search",
    execute: "terminal",
    think: "sparkle",
    fetch: "globe",
    switch_mode: "swap",
    other: "chevron",
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
    <span class="title"><Icon name="sparkle" size={14} /> IA</span>
    <select bind:value={agentId} disabled={ai.status === "connecting" || ai.status === "busy"} onchange={() => selectAgent(agentId)}>
      {#each agents as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
    </select>
    <span class="status {ai.status}" title={statusLabel()} role="status" aria-label={statusLabel()}></span>
    <div class="spacer"></div>
    {#if connected}
      <button class="icon" title="Nueva conversación" aria-label="Nueva conversación" onclick={() => ai.newChat()}><Icon name="plus" size={14} /></button>
      <button class="icon" title="Desconectar" aria-label="Desconectar" onclick={() => ai.disconnect()}><Icon name="power" size={14} /></button>
    {/if}
    <button class="icon" class:on={editingAgents} title="Configurar agentes" aria-label="Configurar agentes" onclick={editAgents}>
      <Icon name="sliders" size={14} />
    </button>
    <button class="icon" title="Cerrar panel" aria-label="Cerrar panel" onclick={onclose}><Icon name="x" size={14} /></button>
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
          <p class="connecting"><span class="spin"></span> Iniciando {agent?.name}… {elapsed > 3 ? `${elapsed} s` : ""}</p>
          {#if elapsed > 8}
            <p class="small">
              La primera vez se descarga el adaptador y el motor de {agent?.name} (unos 270 MB): puede tardar un par de
              minutos. Las siguientes veces arranca en segundos.
            </p>
          {/if}
          <button onclick={() => ai.disconnect()}>Cancelar</button>
        {:else}
          <p class="label">Sugerencias</p>
          <div class="suggestions">
            {#each SUGGESTIONS as s (s)}
              <button class="suggestion" onclick={() => send(s)}><Icon name="arrowRight" size={12} />{s}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#each ai.items as item (itemKey(item))}
      {#if item.kind === "user"}
        <div class="user">
          <div class="who">
            Tú
            {#each item.context as c (c)}<span class="chip">{c}</span>{/each}
          </div>
          <div class="user-text">{item.text}</div>
        </div>
      {:else if item.kind === "agent"}
        <div class="agent md">{@html renderMarkdown(item.text)}</div>
      {:else if item.kind === "thought"}
        <details class="fold thought">
          <summary><Icon name="chevron" size={12} />Razonamiento</summary>
          <div class="md">{@html renderMarkdown(item.text)}</div>
        </details>
      {:else if item.kind === "tool"}
        <div class="tool {item.status}">
          <div class="tool-head">
            <span class="ic"><Icon name={ICONS[item.toolKind ?? "other"] ?? "chevron"} size={13} /></span>
            <span class="tool-title">{item.title}</span>
            <span class="tool-status" title={item.status}>
              {#if item.status === "completed"}<Icon name="check" size={13} />
              {:else if item.status === "failed"}<Icon name="x" size={13} />
              {:else if item.status === "in_progress"}<span class="spin"></span>{/if}
            </span>
          </div>
          {#each item.locations.filter((l) => !item.content.some((c) => c.type === "diff")) as loc, i (i)}
            <button class="loc" onclick={() => openLocation(loc.path, loc.line)}>
              {(app.root && relPath(app.root, loc.path)) || loc.path}{loc.line ? `:${loc.line}` : ""}
            </button>
          {/each}
          {#each item.content as c, i (i)}
            {#if c.type === "diff" && ai.permission?.request.toolCall.toolCallId !== item.toolCallId}
              <div class="tool-body"><DiffView path={c.path} oldText={c.oldText} newText={c.newText} /></div>
            {:else if c.type === "content" && c.content.type === "text" && c.content.text.trim()}
              <details class="fold tool-out">
                <summary><Icon name="chevron" size={12} />Resultado</summary>
                <pre>{c.content.text}</pre>
              </details>
            {/if}
          {/each}
        </div>
      {:else if item.kind === "plan"}
        <div class="plan">
          <div class="block-head">Plan</div>
          {#each item.entries as e, i (i)}
            <div class="plan-entry {e.status}">
              <Icon name={e.status === "completed" ? "check" : e.status === "in_progress" ? "circleDot" : "circle"} size={13} />
              <span>{e.content}</span>
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
      <div class="action">
        <div class="block-head">Permiso</div>
        <div class="action-body">
          <p>{ai.agentName} quiere: <strong>{p.request.toolCall.title ?? "realizar una acción"}</strong></p>
          {#each p.request.toolCall.content ?? [] as c, i (i)}
            {#if c.type === "diff"}<DiffView path={c.path} oldText={c.oldText} newText={c.newText} />{/if}
          {/each}
          <div class="row">
            {#each p.request.options as o (o.optionId)}
              <button
                class:primary={o.kind === "allow_once"}
                class:danger={o.kind.startsWith("reject")}
                onclick={() => p.resolve(o.optionId)}>{o.name}</button
              >
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if ai.status === "auth"}
      <div class="action">
        <div class="block-head">Inicio de sesión</div>
        <div class="action-body">
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
      </div>
    {/if}

    {#if ai.edited.length}
      <div class="edited">
        <div class="block-head">Archivos modificados</div>
        {#each ai.edited as f (f)}
          <button class="file" onclick={() => app.openFile(f)}><Icon name="fileText" size={12} />{f}</button>
        {/each}
        <p class="hint">{kbd("Ctrl+Z")} en el editor deshace los cambios en archivos abiertos.</p>
      </div>
    {/if}

    {#if ai.status === "error" && ai.items.length}
      <div class="row"><button class="primary" onclick={connect}>Reintentar</button></div>
    {/if}

    {#if ai.log.length && (ai.status === "connecting" || ai.status === "error" || ai.status === "auth")}
      <details class="fold log" open={ai.status === "error"}>
        <summary><Icon name="chevron" size={12} />Registro del agente</summary>
        <pre>{ai.log.slice(-40).join("\n")}</pre>
      </details>
    {/if}
  </div>

  <div class="composer">
    {#if app.aiAttachments.length}
      <div class="attachments">
        {#each app.aiAttachments as d, i (i)}
          <div class="att {d.severity}" title={d.message}>
            <span class="sev"></span>
            <span class="att-loc">{d.file ? d.file.split("/").pop() : "?"}{d.line ? `:${d.line}` : ""}</span>
            <span class="att-msg">{d.message}</span>
            <button
              class="icon"
              title="Quitar"
              aria-label="Quitar"
              onclick={() => (app.aiAttachments = app.aiAttachments.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button
            >
          </div>
        {/each}
      </div>
    {/if}
    <div class="input">
      <textarea
        bind:this={textarea}
        bind:value={input}
        rows="2"
        placeholder={app.aiAttachments.length
          ? "¿Qué quieres hacer con estos problemas? (p. ej. «corrígelos»)"
          : connected
            ? `Pide algo a ${ai.agentName}…`
            : `Escribe y se conectará ${agent?.name}`}
        onkeydown={onKey}
        disabled={ai.status === "connecting"}
      ></textarea>
      <div class="toolbar">
        <!-- Contexto que se adjunta al mensaje. -->
        <button
          class="toggle"
          class:on={ctx.file && !!app.active}
          aria-pressed={ctx.file}
          disabled={!app.active}
          title="Adjuntar el archivo actual"
          onclick={() => (ctx.file = !ctx.file)}>Archivo</button
        >
        <button
          class="toggle"
          class:on={ctx.selection && hasSelection}
          aria-pressed={ctx.selection}
          disabled={!hasSelection}
          title="Adjuntar la selección del editor"
          onclick={() => (ctx.selection = !ctx.selection)}>Selección</button
        >
        <button
          class="toggle"
          class:on={ctx.errors && !!app.diagnostics.length}
          aria-pressed={ctx.errors}
          disabled={!app.diagnostics.length}
          title="Adjuntar todos los errores y advertencias de la última compilación"
          onclick={() => (ctx.errors = !ctx.errors)}>Problemas{problemCount ? ` ${problemCount}` : ""}</button
        >
        <div class="spacer"></div>
        <span class="keys"><kbd>↵</kbd> enviar <kbd>⇧↵</kbd> línea</span>
        {#if ai.status === "busy"}
          <button class="icon stop" title="Detener (Esc)" aria-label="Detener" onclick={() => ai.cancel()}><Icon name="stop" size={12} /></button>
        {:else}
          <button class="icon send" title="Enviar (Enter)" aria-label="Enviar" disabled={!input.trim()} onclick={() => send()}>
            <Icon name="arrowUp" size={14} />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .ai {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-surface);
    font-size: var(--fs-base);
  }

  /* ── Cabecera ───────────────────────────────────────────────── */

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--h-header);
    padding: 0 var(--space-1) 0 var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-right: var(--space-1);
    font-size: var(--fs-sm);
    font-weight: var(--fw-semibold);
    color: var(--text-primary);
  }
  .head select,
  .modes select {
    height: 22px;
    font-size: var(--fs-sm);
    padding: 0 var(--space-1);
  }
  .head button.icon {
    width: 24px;
    height: 24px;
  }
  .status {
    width: 6px;
    height: 6px;
    margin-left: var(--space-1);
    border-radius: 50%;
    background: var(--text-muted);
  }
  .status.ready {
    background: var(--ok);
  }
  .status.busy,
  .status.connecting {
    background: var(--warning);
  }
  .status.error,
  .status.auth {
    background: var(--danger);
  }
  .spacer {
    flex: 1;
  }
  .modes {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--h-control);
    padding: 0 var(--space-3);
    font-size: var(--fs-sm);
    color: var(--text-muted);
    border-bottom: 1px solid var(--border-subtle);
  }
  .agents-editor {
    flex: none;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--fs-sm);
    line-height: var(--lh-base);
    color: var(--text-secondary);
  }
  .agents-editor p {
    margin: 0;
  }
  .agents-editor textarea {
    height: 220px;
    padding: var(--space-2);
    font: var(--fs-sm) / 1.5 var(--font-mono);
    font-variant-ligatures: none;
    tab-size: 2;
    resize: vertical;
  }
  .row {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    align-items: center;
  }
  .err {
    color: var(--danger);
  }

  /* ── Historial ──────────────────────────────────────────────── */

  .messages {
    flex: 1;
    overflow: auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .empty {
    margin: auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
    line-height: var(--lh-base);
    color: var(--text-secondary);
  }
  .empty p {
    margin: 0;
  }
  .empty .label {
    align-self: stretch;
    text-align: left;
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: calc(-1 * var(--space-2));
  }
  .connecting {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .small {
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .suggestions {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .suggestion {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: 0;
    background: none;
    text-align: left;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .suggestion + .suggestion {
    border-top: 1px solid var(--border-subtle);
  }
  .suggestion:hover {
    color: var(--text-primary);
  }
  .suggestion :global(svg) {
    color: var(--text-muted);
  }

  /* Prompt del usuario: bloque con borde y fondo apenas elevado; nada de burbujas. */
  .user {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    background: var(--bg-hover);
    padding: var(--space-2) var(--space-3);
  }
  .who {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-1);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    color: var(--text-muted);
  }
  .chip {
    padding: 0 var(--space-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font: var(--fw-regular) var(--fs-xs) / 16px var(--font-mono);
    color: var(--text-secondary);
  }
  .user-text {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: var(--lh-base);
    color: var(--text-primary);
  }
  /* Respuesta: texto corrido alineado con el del prompt. */
  .agent {
    padding: 0 calc(var(--space-3) + 1px);
    line-height: 1.55;
    word-break: break-word;
    color: var(--text-primary);
  }

  /* Markdown de las respuestas. */
  .md :global(p) {
    margin: 0 0 0.6em;
  }
  .md :global(p:last-child) {
    margin-bottom: 0;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3) {
    margin: 0.8em 0 0.4em;
    font-size: var(--fs-md);
    font-weight: var(--fw-semibold);
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0.3em 0 0.6em;
    padding-left: 1.4em;
  }
  .md :global(a) {
    color: var(--accent);
    text-underline-offset: 2px;
  }
  .md :global(pre),
  .tool-out pre,
  .log pre {
    margin: var(--space-2) 0;
    padding: var(--space-2) var(--space-3);
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    background: var(--bg-inset);
    color: var(--text-primary);
    font: var(--fs-sm) / 1.5 var(--font-mono);
    font-variant-ligatures: none;
    tab-size: 2;
    white-space: pre;
  }
  .md :global(code) {
    padding: 0 3px;
    border-radius: var(--radius-sm);
    background: var(--bg-active);
    font-family: var(--font-mono);
    font-size: 0.9em;
    font-variant-ligatures: none;
  }
  .md :global(pre code) {
    padding: 0;
    background: none;
    font-size: inherit;
  }
  .md :global(table) {
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border-subtle);
    padding: 2px var(--space-2);
    text-align: left;
  }
  .md :global(th) {
    background: var(--bg-hover);
    font-weight: var(--fw-semibold);
  }

  /* Plegables (razonamiento, resultado de herramienta, registro). */
  .fold summary {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    cursor: pointer;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .fold summary::-webkit-details-marker {
    display: none;
  }
  .fold summary:hover {
    color: var(--text-secondary);
  }
  .fold summary :global(svg) {
    transition: transform var(--duration-fast) var(--ease);
  }
  .fold[open] > summary :global(svg) {
    transform: rotate(90deg);
  }
  .thought {
    padding: 0 calc(var(--space-3) + 1px);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .thought .md {
    margin-top: var(--space-1);
    padding-left: var(--space-3);
    border-left: 1px solid var(--border-subtle);
    line-height: var(--lh-base);
  }

  /* Llamadas a herramientas: fila técnica con borde, estado a la derecha. */
  .tool {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    font-size: var(--fs-sm);
  }
  .tool-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--h-row);
    padding: var(--space-1) var(--space-2);
    color: var(--text-secondary);
  }
  .ic {
    flex: none;
    display: flex;
    color: var(--text-muted);
  }
  .tool-title {
    flex: 1;
    min-width: 0;
    font: var(--fs-sm) / 1.35 var(--font-mono);
    font-variant-ligatures: none;
    overflow-wrap: anywhere;
  }
  .tool-status {
    flex: none;
    display: flex;
    color: var(--text-muted);
  }
  .tool.completed .tool-status {
    color: var(--ok);
  }
  .tool.failed {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .tool.failed .tool-status {
    color: var(--danger);
  }
  .loc {
    display: block;
    min-height: 0;
    padding: 0 var(--space-2) var(--space-1) calc(var(--space-2) + 13px + var(--space-2));
    border: none;
    background: none;
    font: var(--fs-xs) var(--font-mono);
    color: var(--text-secondary);
    text-align: left;
  }
  .loc:hover {
    color: var(--accent);
    background: none;
  }
  .tool-body {
    padding: 0 var(--space-2) var(--space-2);
  }
  .tool-out {
    padding: 0 var(--space-2) var(--space-1);
  }
  .tool-out pre {
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    font-size: var(--fs-xs);
  }

  /* Bloques con cabecera (plan, permisos, archivos modificados). */
  .plan,
  .action,
  .edited {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
    font-size: var(--fs-sm);
  }
  .block-head {
    display: flex;
    align-items: center;
    height: var(--h-row);
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .plan-entry {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    line-height: 1.35;
  }
  .plan-entry :global(svg) {
    margin-top: 1px;
    color: var(--text-muted);
  }
  .plan-entry.in_progress :global(svg) {
    color: var(--accent);
  }
  .plan-entry.completed {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  /* Requiere una respuesta: el único bloque que lleva el acento. */
  .action {
    border-color: var(--border-strong);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .action-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }
  .action-body p {
    margin: 0;
    line-height: var(--lh-base);
  }
  .action .danger {
    color: var(--danger);
  }
  .action .danger:hover {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .edited .file {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--h-row);
    padding: 0 var(--space-2);
    border: none;
    border-radius: 0;
    background: none;
    font: var(--fs-sm) var(--font-mono);
    color: var(--text-primary);
    text-align: left;
  }
  .edited .file:hover {
    background: var(--bg-hover);
  }
  .edited .file :global(svg) {
    color: var(--text-muted);
  }
  .hint {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .notice {
    padding: 0 calc(var(--space-3) + 1px);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .notice.error {
    color: var(--danger);
    white-space: pre-wrap;
  }
  .working {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 calc(var(--space-3) + 1px);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .log pre {
    max-height: 180px;
    overflow: auto;
    white-space: pre-wrap;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  /* ── Entrada ────────────────────────────────────────────────── */

  .composer {
    flex: none;
    padding: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }
  .attachments {
    display: flex;
    flex-direction: column;
    max-height: 120px;
    overflow: auto;
    margin-bottom: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius);
  }
  .att {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--h-row);
    padding: 0 2px 0 var(--space-2);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .att + .att {
    border-top: 1px solid var(--border-subtle);
  }
  .sev {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--warning);
  }
  .att.error .sev {
    background: var(--danger);
  }
  .att-loc {
    flex: none;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }
  .att-msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .att button.icon {
    width: 20px;
    height: 20px;
  }

  /* Caja de entrada: borde neutro; el acento solo con foco de teclado/escritura. */
  .input {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-inset);
    transition: border-color var(--duration-fast) var(--ease);
  }
  .input:has(textarea:focus-visible) {
    border-color: var(--focus-ring);
  }
  .input textarea {
    display: block;
    width: 100%;
    min-height: 44px;
    max-height: 200px;
    field-sizing: content;
    padding: var(--space-2) var(--space-2) var(--space-1);
    border: none;
    border-radius: var(--radius) var(--radius) 0 0;
    background: none;
    resize: none;
    font-size: var(--fs-base);
    line-height: var(--lh-base);
  }
  .input textarea:focus {
    border: none;
    box-shadow: none;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    padding: 0 2px 0 var(--space-1);
  }
  .toggle {
    min-height: 0;
    height: 20px;
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .toggle:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .toggle.on {
    border-color: var(--border-strong);
    background: var(--bg-active);
    color: var(--text-primary);
  }
  .toggle:disabled {
    opacity: 0.4;
  }
  .keys {
    margin-right: var(--space-1);
    font-size: var(--fs-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .keys kbd {
    font-family: var(--font-mono);
    margin-left: var(--space-1);
  }
  .toolbar button.icon {
    width: 24px;
    height: 24px;
  }
  .send:not(:disabled) {
    background: var(--accent);
    color: var(--accent-text);
  }
  .send:not(:disabled):hover {
    background: var(--accent-hover);
    color: var(--accent-text);
  }
  .stop {
    color: var(--danger);
  }
  .stop:hover {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
  }
  /* Con el panel estrecho sobran las pistas de teclado. */
  @container (max-width: 360px) {
    .keys {
      display: none;
    }
  }
  .composer {
    container-type: inline-size;
  }

  .spin {
    display: inline-block;
    flex: none;
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--border-strong);
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

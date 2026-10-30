// Sesión con un agente ACP: lanza el proceso (Rust), habla el protocolo con el SDK oficial
// y expone el estado reactivo que pinta el panel de chat.
import { Channel, invoke } from "@tauri-apps/api/core";
import * as acp from "@agentclientprotocol/sdk";
import { api } from "../api";
import { app } from "../store.svelte";
import { fileUri, isMac, isWindows } from "../platform";
import type { AgentConfig } from "./agents";

export type ChatItem =
  | { kind: "user"; id: number; text: string; context: string[] }
  | { kind: "agent"; id: number; text: string }
  | { kind: "thought"; id: number; text: string }
  | {
      kind: "tool";
      id: number;
      toolCallId: string;
      title: string;
      toolKind: acp.ToolKind | null;
      status: acp.ToolCallStatus;
      content: acp.ToolCallContent[];
      locations: acp.ToolCallLocation[];
    }
  | { kind: "plan"; id: number; entries: acp.PlanEntry[] }
  | { kind: "notice"; id: number; text: string; error?: boolean };

export interface PendingPermission {
  request: acp.RequestPermissionRequest;
  resolve: (optionId: string | null) => void;
}

export type SessionStatus = "off" | "connecting" | "ready" | "busy" | "auth" | "error";

/** Contexto opcional que acompaña a un mensaje. */
export interface PromptContext {
  file: boolean;
  selection: boolean;
  errors: boolean;
}

let nextId = 1;

function findLast<T>(list: T[], pred: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i];
  return undefined;
}

/** Ruta absoluta de un archivo del proyecto (con el separador del sistema). */
export function absPath(root: string, rel: string) {
  const sep = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + rel.replace(/\//g, sep);
}

/** Ruta relativa al proyecto de una ruta absoluta, o null si está fuera. */
export function relPath(root: string, abs: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const a = norm(abs);
  const insensitive = isWindows || isMac;
  const [rr, aa] = insensitive ? [r.toLowerCase(), a.toLowerCase()] : [r, a];
  if (!aa.startsWith(rr + "/")) return null;
  const rel = a.slice(r.length + 1);
  return rel.split("/").some((p) => p === "..") ? null : rel;
}

class AiSession {
  status = $state<SessionStatus>("off");
  items = $state<ChatItem[]>([]);
  agent = $state<AgentConfig | null>(null);
  agentName = $state("");
  modes = $state<acp.SessionMode[]>([]);
  currentMode = $state<string | null>(null);
  permission = $state<PendingPermission | null>(null);
  authMethods = $state<acp.AuthMethod[]>([]);
  /** Últimas líneas de stderr del agente (progreso de npx, errores). */
  log = $state<string[]>([]);
  /** Archivos que el agente modificó en esta conversación. */
  edited = $state<string[]>([]);

  private conn: acp.ClientSideConnection | null = null;
  private procId: number | null = null;
  private sessionId: string | null = null;
  private root: string | null = null;
  private firstPrompt = true;

  private push(item: ChatItem) {
    this.items.push(item);
  }

  private notice(text: string, error = false) {
    this.push({ kind: "notice", id: nextId++, text, error });
  }

  /** Lanza el agente y abre una sesión en la carpeta del proyecto. */
  async connect(agent: AgentConfig) {
    await this.disconnect();
    if (!app.root) return;
    this.root = app.root;
    this.agent = agent;
    this.agentName = agent.name;
    this.status = "connecting";
    this.log = [];
    this.authMethods = [];

    const lines = new Channel<string>();
    const stderr = new Channel<string>();
    const exit = new Channel<number | null>();
    let controller!: ReadableStreamDefaultController<acp.AnyMessage>;
    const readable = new ReadableStream<acp.AnyMessage>({ start: (c) => (controller = c) });
    lines.onmessage = (line) => {
      try {
        controller.enqueue(JSON.parse(line));
      } catch {
        // Algunos adaptadores escriben texto suelto en stdout: se muestra en el registro.
        this.addLog(line);
      }
    };
    stderr.onmessage = (line) => this.addLog(line);
    exit.onmessage = () => {
      try {
        controller.close();
      } catch {
        /* ya cerrado */
      }
      if (this.procId !== null) {
        this.procId = null;
        this.conn = null;
        if (this.status !== "off") {
          this.status = "error";
          this.notice(`${agent.name} se cerró.${this.log.length ? " Revisa el registro." : ""}`, true);
        }
      }
    };

    try {
      this.procId = await invoke<number>("acp_spawn", {
        command: agent.command,
        args: agent.args,
        cwd: app.root,
        onLine: lines,
        onStderr: stderr,
        onExit: exit,
      });
    } catch (e) {
      this.status = "error";
      this.notice(String(e), true);
      return;
    }

    const procId = this.procId;
    const writable = new WritableStream<acp.AnyMessage>({
      write: (msg) => invoke("acp_send", { id: procId, line: JSON.stringify(msg) }),
    });
    this.conn = new acp.ClientSideConnection(() => this.client(), { readable, writable });

    try {
      const init = await this.conn.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "editex", version: "0.1.0" },
      });
      this.authMethods = init.authMethods ?? [];
      if (init.agentInfo?.title || init.agentInfo?.name) this.agentName = init.agentInfo.title ?? init.agentInfo.name;
      await this.newSession();
    } catch (e) {
      this.handleError(e);
    }
  }

  private async newSession() {
    if (!this.conn || !this.root) return;
    const s = await this.conn.newSession({ cwd: this.root, mcpServers: [] });
    this.sessionId = s.sessionId;
    this.modes = s.modes?.availableModes ?? [];
    this.currentMode = s.modes?.currentModeId ?? null;
    this.firstPrompt = true;
    this.status = "ready";
  }

  private handleError(e: unknown) {
    const err = e as { code?: number; message?: string };
    const msg = err?.message ?? String(e);
    // -32000 = autenticación requerida en ACP.
    if (err?.code === -32000 || /auth/i.test(msg)) {
      this.status = "auth";
      this.notice(`${this.agentName} necesita que inicies sesión.`);
    } else {
      this.status = this.conn ? "ready" : "error";
      this.notice(msg, true);
    }
  }

  async authenticate(methodId: string) {
    if (!this.conn) return;
    this.status = "connecting";
    try {
      await this.conn.authenticate({ methodId });
      await this.newSession();
      this.notice("Sesión iniciada.");
    } catch (e) {
      this.handleError(e);
    }
  }

  /** Reintenta abrir la sesión (tras iniciar sesión desde la terminal). */
  async retry() {
    if (this.conn) {
      this.status = "connecting";
      try {
        await this.newSession();
      } catch (e) {
        this.handleError(e);
      }
    } else if (this.agent) await this.connect(this.agent);
  }

  async disconnect() {
    this.permission?.resolve(null);
    this.permission = null;
    const id = this.procId;
    this.procId = null;
    this.conn = null;
    this.sessionId = null;
    this.status = "off";
    if (id !== null) await invoke("acp_kill", { id }).catch(() => {});
  }

  /** Nueva conversación con el mismo agente (sin relanzar el proceso). */
  async newChat() {
    this.items = [];
    this.edited = [];
    if (this.conn) {
      try {
        await this.newSession();
      } catch (e) {
        this.handleError(e);
      }
    } else if (this.agent) await this.connect(this.agent);
  }

  async setMode(modeId: string) {
    if (!this.conn || !this.sessionId) return;
    try {
      await this.conn.setSessionMode({ sessionId: this.sessionId, modeId });
      this.currentMode = modeId;
    } catch (e) {
      this.notice(String((e as Error)?.message ?? e), true);
    }
  }

  async cancel() {
    this.permission?.resolve(null);
    this.permission = null;
    if (this.conn && this.sessionId) await this.conn.cancel({ sessionId: this.sessionId });
  }

  private buildContext(ctx: PromptContext): { blocks: acp.ContentBlock[]; labels: string[] } {
    const blocks: acp.ContentBlock[] = [];
    const labels: string[] = [];
    const view = app.editor.view;
    if (this.firstPrompt) {
      blocks.push({
        type: "text",
        text:
          `Contexto: estás ayudando en un proyecto LaTeX abierto en el editor Editex (carpeta ${this.root}). ` +
          `Archivo principal: ${app.settings.main ?? "desconocido"}. Motor: ${app.settings.engine}. ` +
          "El usuario compila desde el editor; no hace falta que compiles tú salvo que te lo pida. Responde en el idioma del usuario.",
      });
    }
    if (ctx.file && app.active && this.root) {
      const line = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
      blocks.push({ type: "resource_link", uri: fileUri(absPath(this.root, app.active)), name: app.active });
      blocks.push({ type: "text", text: `El usuario está editando ${app.active} (cursor en la línea ${line}).` });
      labels.push(app.active);
    }
    if (ctx.selection && view && app.active) {
      const sel = view.state.selection.main;
      if (!sel.empty) {
        const from = view.state.doc.lineAt(sel.from).number;
        const to = view.state.doc.lineAt(sel.to).number;
        blocks.push({
          type: "text",
          text: `Texto seleccionado en ${app.active} (líneas ${from}-${to}):\n\`\`\`latex\n${view.state.sliceDoc(sel.from, sel.to)}\n\`\`\``,
        });
        labels.push(`selección ${from}-${to}`);
      }
    }
    if (ctx.errors) {
      const problems = app.diagnostics.filter((d) => d.severity !== "info").slice(0, 40);
      if (problems.length) {
        blocks.push({
          type: "text",
          text:
            "Errores y advertencias de la última compilación:\n" +
            problems.map((d) => `- [${d.severity}] ${d.file ?? "?"}:${d.line ?? "?"}: ${d.message}`).join("\n"),
        });
        labels.push(`${problems.length} problemas`);
      }
    }
    return { blocks, labels };
  }

  async send(text: string, ctx: PromptContext) {
    if (!this.conn || !this.sessionId || this.status !== "ready" || !text.trim()) return;
    // El agente lee de disco: guardamos antes lo que haya pendiente.
    await app.saveAll();
    const { blocks, labels } = this.buildContext(ctx);
    this.push({ kind: "user", id: nextId++, text, context: labels });
    this.firstPrompt = false;
    this.status = "busy";
    try {
      const res = await this.conn.prompt({ sessionId: this.sessionId, prompt: [...blocks, { type: "text", text }] });
      if (res.stopReason === "cancelled") this.notice("Detenido.");
      else if (res.stopReason === "max_tokens" || res.stopReason === "max_turn_requests")
        this.notice("El agente se detuvo por llegar a su límite.");
      else if (res.stopReason === "refusal") this.notice("El agente rechazó la petición.", true);
      this.status = "ready";
    } catch (e) {
      this.handleError(e);
    }
    if (this.edited.length) void app.refreshTree();
  }

  private addLog(line: string) {
    this.log = [...this.log.slice(-200), line];
  }

  /** Último bloque del tipo indicado si es el último del chat (para ir acumulando texto). */
  private lastOf<K extends ChatItem["kind"]>(kind: K): Extract<ChatItem, { kind: K }> | null {
    const last = this.items[this.items.length - 1];
    return last?.kind === kind ? (last as Extract<ChatItem, { kind: K }>) : null;
  }

  private onUpdate(u: acp.SessionUpdate) {
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        if (u.content.type !== "text") break;
        const kind = u.sessionUpdate === "agent_message_chunk" ? "agent" : "thought";
        const last = this.lastOf(kind);
        if (last) last.text += u.content.text;
        else this.push({ kind, id: nextId++, text: u.content.text } as ChatItem);
        break;
      }
      case "tool_call":
        this.push({
          kind: "tool",
          id: nextId++,
          toolCallId: u.toolCallId,
          title: u.title,
          toolKind: u.kind ?? null,
          status: u.status ?? "pending",
          content: u.content ?? [],
          locations: u.locations ?? [],
        });
        break;
      case "tool_call_update": {
        const item = findLast(this.items, (i) => i.kind === "tool" && i.toolCallId === u.toolCallId);
        if (item?.kind !== "tool") break;
        if (u.title) item.title = u.title;
        if (u.status) item.status = u.status;
        if (u.kind) item.toolKind = u.kind;
        if (u.content) item.content = u.content;
        if (u.locations) item.locations = u.locations;
        break;
      }
      case "plan": {
        const last = findLast(this.items, (i) => i.kind === "plan");
        if (last?.kind === "plan") last.entries = u.entries;
        else this.push({ kind: "plan", id: nextId++, entries: u.entries });
        break;
      }
      case "current_mode_update":
        this.currentMode = u.currentModeId;
        break;
      default:
        break;
    }
  }

  private client(): acp.Client {
    return {
      requestPermission: (params) =>
        new Promise((resolve) => {
          this.permission = {
            request: params,
            resolve: (optionId) => {
              this.permission = null;
              resolve({ outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
            },
          };
        }),
      sessionUpdate: async (n) => this.onUpdate(n.update),
      readTextFile: async ({ path, line, limit }) => {
        const rel = this.root ? relPath(this.root, path) : null;
        if (!rel || !this.root) throw acp.RequestError.invalidParams(undefined, `Fuera del proyecto: ${path}`);
        // Si está abierto en el editor, el agente ve también lo que no se ha guardado.
        const text = app.editor.has(rel) ? app.editor.content(rel) : await api.readFile(this.root, rel);
        if (line == null && limit == null) return { content: text };
        const lines = text.split("\n");
        const start = Math.max(0, (line ?? 1) - 1);
        return { content: lines.slice(start, limit != null ? start + limit : undefined).join("\n") };
      },
      writeTextFile: async ({ path, content }) => {
        const rel = this.root ? relPath(this.root, path) : null;
        if (!rel || !this.root) throw acp.RequestError.invalidParams(undefined, `Fuera del proyecto: ${path}`);
        if (app.editor.has(rel)) {
          // Pasa por el editor: el cambio se puede deshacer con Ctrl+Z.
          app.editor.applyExternalEdit(rel, content);
          await app.save(rel);
        } else {
          await api.writeFile(this.root, rel, content);
        }
        if (!this.edited.includes(rel)) this.edited.push(rel);
        return {};
      },
    };
  }
}

export const ai = new AiSession();

// Agente ACP simulado (solo desarrollo, modo ?mock): habla el protocolo real con el SDK oficial
// para probar el panel de IA sin descargar ni ejecutar agentes externos.
import * as acp from "@agentclientprotocol/sdk";

type Ch = { onmessage: (m: unknown) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const procs = new Map<number, (line: string) => void>();
let nextProc = 1;

export function spawnMockAgent(args: { cwd: string; onLine: Ch; onStderr: Ch; onExit: Ch }): number {
  const id = nextProc++;
  let toAgent!: ReadableStreamDefaultController<acp.AnyMessage>;
  const readable = new ReadableStream<acp.AnyMessage>({ start: (c) => (toAgent = c) });
  const writable = new WritableStream<acp.AnyMessage>({
    write: (msg) => args.onLine.onmessage(JSON.stringify(msg)),
  });
  procs.set(id, (line) => toAgent.enqueue(JSON.parse(line)));
  args.onStderr.onmessage("[simulado] agente iniciado en " + args.cwd);

  let cancelled = false;
  new acp.AgentSideConnection(
    (conn) => ({
      initialize: async () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {},
        agentInfo: { name: "simulado", title: "Agente simulado", version: "0" },
        authMethods: [],
      }),
      newSession: async () => ({
        sessionId: "s-" + Date.now(),
        modes: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "Preguntar antes de editar" },
            { id: "acceptEdits", name: "Aceptar ediciones" },
          ],
        },
      }),
      authenticate: async () => ({}),
      setSessionMode: async () => ({}),
      cancel: async () => {
        cancelled = true;
      },
      prompt: async ({ sessionId, prompt }) => {
        cancelled = false;
        const say = async (sessionUpdate: "agent_message_chunk" | "agent_thought_chunk", text: string) => {
          for (const word of text.split(/(?<= )/)) {
            if (cancelled) return;
            await conn.sessionUpdate({ sessionId, update: { sessionUpdate, content: { type: "text", text: word } } });
            await sleep(15);
          }
        };
        const userText = prompt.map((b) => (b.type === "text" ? b.text : "")).join("\n");
        await say("agent_thought_chunk", "El usuario quiere cambios en el documento. Primero leo el capítulo.");
        await conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: "Leer conclusiones.tex", priority: "high", status: "in_progress" },
              { content: "Proponer la corrección", priority: "high", status: "pending" },
            ],
          },
        });
        const path = `${args.cwd}/capitulos/conclusiones.tex`;
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Leer capitulos/conclusiones.tex", kind: "read", status: "in_progress", locations: [{ path }] },
        });
        const { content } = await conn.readTextFile({ sessionId, path });
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } });
        if (cancelled) return { stopReason: "cancelled" };

        const fixed = content.replace("Esta palabra esta mal escrita: ortografia.", "Esta palabra está bien escrita: ortografía.");
        const diff = { type: "diff" as const, path, oldText: content, newText: fixed };
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "tool_call", toolCallId: "t2", title: "Editar capitulos/conclusiones.tex", kind: "edit", status: "pending", content: [diff] },
        });
        const perm = await conn.requestPermission({
          sessionId,
          toolCall: { toolCallId: "t2", title: "Editar capitulos/conclusiones.tex", kind: "edit", content: [diff] },
          options: [
            { optionId: "yes", name: "Permitir", kind: "allow_once" },
            { optionId: "always", name: "Permitir siempre", kind: "allow_always" },
            { optionId: "no", name: "Rechazar", kind: "reject_once" },
          ],
        });
        const allowed = perm.outcome.outcome === "selected" && perm.outcome.optionId !== "no";
        if (allowed) await conn.writeTextFile({ sessionId, path, content: fixed });
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "tool_call_update", toolCallId: "t2", status: allowed ? "completed" : "failed" },
        });
        await conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: "Leer conclusiones.tex", priority: "high", status: "completed" },
              { content: "Proponer la corrección", priority: "high", status: "completed" },
            ],
          },
        });
        await say(
          "agent_message_chunk",
          allowed
            ? `Listo: corregí **dos tildes** en \`conclusiones.tex\`.\n\n- «esta» → «está»\n- «ortografia» → «ortografía»\n\nPrueba de seguridad: <img src=x onerror="alert(1)"> y [enlace](https://tug.org) y [malo](javascript:alert(1)).\n\nTu mensaje tenía ${userText.length} caracteres.`
            : "Entendido, no cambié nada.",
        );
        return { stopReason: cancelled ? "cancelled" : "end_turn" };
      },
    }),
    { readable, writable },
  );
  return id;
}

export function sendToMockAgent(id: number, line: string) {
  procs.get(id)?.(line);
}

export function killMockAgent(id: number) {
  procs.delete(id);
}

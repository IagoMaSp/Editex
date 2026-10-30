// Agentes de IA compatibles con ACP (Agent Client Protocol) y sus comandos.
// Las versiones van fijadas: el adaptador se descarga con npx la primera vez.

export interface AgentConfig {
  id: string;
  name: string;
  /** Proceso que habla ACP por stdin/stdout. */
  command: string;
  args: string[];
  /** Variables de entorno extra para el proceso (opcional). */
  env?: Record<string, string>;
  /** Comando para usar el agente directamente en la terminal integrada. */
  terminalCommand: string;
  /** Cómo iniciar sesión si el agente lo pide. */
  loginCommand: string;
}

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.93.0"],
    terminalCommand: "claude",
    loginCommand: "claude",
  },
  {
    id: "codex",
    name: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp@2.2.2"],
    terminalCommand: "codex",
    loginCommand: "codex login",
  },
];

const KEY = "editex.agents";
const SELECTED = "editex.agent";

/** Agentes configurados (los predeterminados + los que el usuario añada o modifique). */
export function loadAgents(): AgentConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as AgentConfig[] | null;
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    /* configuración corrupta: se usan los predeterminados */
  }
  return DEFAULT_AGENTS.map((a) => ({ ...a, args: [...a.args] }));
}

export function saveAgents(agents: AgentConfig[]) {
  localStorage.setItem(KEY, JSON.stringify(agents));
}

export function selectedAgentId(): string {
  return localStorage.getItem(SELECTED) ?? "claude";
}

export function selectAgent(id: string) {
  localStorage.setItem(SELECTED, id);
}

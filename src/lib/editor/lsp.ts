// Conecta @codemirror/lsp-client con texlab a través del backend (eventos Tauri).
import { LSPClient, languageServerExtensions, type Transport } from "@codemirror/lsp-client";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { fileUri } from "../platform";

let unlisten: (() => void) | null = null;

export async function startLsp(root: string): Promise<LSPClient | null> {
  unlisten?.();
  try {
    await invoke("lsp_start", { root });
  } catch (e) {
    console.warn("texlab:", e);
    return null;
  }
  const handlers = new Set<(msg: string) => void>();
  unlisten = await listen<string>("lsp-message", (e) => handlers.forEach((h) => h(e.payload)));
  const transport: Transport = {
    send(message) {
      invoke("lsp_send", { message }).catch((e) => console.warn("lsp_send:", e));
    },
    subscribe: (h) => handlers.add(h),
    unsubscribe: (h) => handlers.delete(h),
  };
  const client = new LSPClient({
    rootUri: fileUri(root),
    timeout: 8000,
    extensions: languageServerExtensions(),
    initializationOptions: {},
  }).connect(transport);
  await Promise.race([client.initializing, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
  return client;
}

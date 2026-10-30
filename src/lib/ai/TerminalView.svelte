<script lang="ts">
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { app } from "../store.svelte";
  import { theme } from "../theme.svelte";

  let { cwd, visible }: { cwd: string; visible: boolean } = $props();

  let host: HTMLDivElement;
  let term: Terminal;
  let fit: FitAddon;
  let id: number | null = null;
  let exited = $state(false);

  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      background: v("--bg-editor"),
      foreground: v("--text"),
      cursor: v("--accent"),
      cursorAccent: v("--bg-editor"),
      selectionBackground: v("--selection"),
    };
  }

  async function start() {
    exited = false;
    const onData = new Channel<ArrayBuffer | number[]>();
    onData.onmessage = (data) => term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data));
    const onExit = new Channel<null>();
    onExit.onmessage = () => {
      exited = true;
      id = null;
      term.write("\r\n\x1b[2m[la terminal se cerró]\x1b[0m\r\n");
    };
    try {
      id = await invoke<number>("pty_spawn", { cwd, cols: term.cols, rows: term.rows, onData, onExit });
    } catch (e) {
      term.write(`\x1b[31m${e}\x1b[0m\r\n`);
      exited = true;
    }
  }

  async function restart() {
    if (id !== null) await invoke("pty_kill", { id }).catch(() => {});
    id = null;
    term.reset();
    await start();
    term.focus();
  }

  /** Escribe un comando en la shell y lo ejecuta. */
  async function run(command: string) {
    if (id === null) await restart();
    await invoke("pty_write", { id, data: command + "\r" });
    term.focus();
  }

  onMount(() => {
    const css = getComputedStyle(document.documentElement);
    term = new Terminal({
      fontFamily: css.getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: readTheme(),
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.onData((data) => {
      if (id !== null) void invoke("pty_write", { id, data });
    });
    term.onResize(({ cols, rows }) => {
      if (id !== null) void invoke("pty_resize", { id, cols, rows });
    });
    // Ctrl+Shift+C / Ctrl+Shift+V copian/pegan (Ctrl+C se envía a la shell).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      return true;
    });
    const ro = new ResizeObserver(() => requestAnimationFrame(() => visible && fit.fit()));
    ro.observe(host);
    app.terminal = { run, restart };
    void start();
    return () => {
      ro.disconnect();
      if (app.terminal?.run === run) app.terminal = null;
      if (id !== null) void invoke("pty_kill", { id });
      term.dispose();
    };
  });

  $effect(() => {
    if (visible && term) {
      requestAnimationFrame(() => {
        fit.fit();
        term.focus();
      });
    }
  });

  $effect(() => {
    void theme.resolved;
    if (term) requestAnimationFrame(() => (term.options.theme = readTheme()));
  });
</script>

<div class="wrap">
  <div class="host" bind:this={host}></div>
  {#if exited}
    <button class="again" onclick={restart}>Abrir otra terminal</button>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    height: 100%;
    background: var(--bg-editor);
    padding: 4px 0 0 8px;
  }
  .host {
    height: 100%;
  }
  .again {
    position: absolute;
    right: 12px;
    bottom: 12px;
    font-size: 12px;
  }
</style>

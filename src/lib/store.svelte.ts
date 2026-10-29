// Estado global de la app y acciones de alto nivel (proyecto, archivos, compilación).
import { listen } from "@tauri-apps/api/event";
import { api, type AutoCompile, type CompileResult, type Diagnostic, type Engine, type FileNode, type OutlineItem, type SpellLang } from "./api";
import { EditorManager } from "./editor/manager";
import { startLsp } from "./editor/lsp";

export interface ProjectSettings {
  main: string | null;
  engine: Engine;
  autoCompile: AutoCompile;
  fastMode: boolean;
  spellLang: SpellLang;
  shellEscape: boolean;
  precompiledPreamble: boolean;
  draftImages: boolean;
}

const DEFAULT_SETTINGS: ProjectSettings = {
  main: null,
  engine: "pdflatex",
  autoCompile: "save",
  fastMode: true,
  spellLang: "es+en",
  shellEscape: false,
  precompiledPreamble: false,
  draftImages: false,
};

const SETTINGS_FILE = ".editex/settings.json";
const RECENTS_KEY = "editex.recent";

const TEXT_EXT = /\.(tex|sty|cls|bib|bst|txt|md|cfg|def|ltx|dtx|ins|bbx|cbx|lbx|csv|dat|json|yaml|yml|lua|py|tikz|pgf)$/i;

export function isTextFile(path: string) {
  return TEXT_EXT.test(path) || !/\.[^/]+$/.test(path);
}

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

class AppState {
  root = $state<string | null>(null);
  files = $state<FileNode[]>([]);
  outline = $state<OutlineItem[]>([]);
  openFiles = $state<string[]>([]);
  active = $state<string | null>(null);
  dirty = $state<Record<string, boolean>>({});
  settings = $state<ProjectSettings>({ ...DEFAULT_SETTINGS });
  diagnostics = $state<Diagnostic[]>([]);
  compiling = $state(false);
  lastResult = $state<CompileResult | null>(null);
  pdfPath = $state<string | null>(null);
  /** Se incrementa en cada PDF nuevo para que el visor recargue. */
  pdfVersion = $state(0);
  lspStatus = $state<"off" | "starting" | "ready" | "error">("off");
  recents = $state<string[]>(loadRecents());
  toast = $state<string | null>(null);

  editor = new EditorManager({
    onDirty: (path, dirty) => (this.dirty[path] = dirty),
    onIdle: (path) => {
      if (this.settings.autoCompile === "idle") void this.save(path).then(() => this.compile());
    },
    onSave: () => void this.saveActive(),
    onCompile: (full) => void this.compile(full),
    onSyncForward: (line) => this.syncForward?.(line),
    spellLang: () => this.settings.spellLang,
  });

  /** Lo registra el visor PDF para hacer forward search. */
  syncForward: ((line: number) => void) | null = null;

  private unlisten: (() => void) | null = null;
  private running = 0;
  private treeTimer: number | undefined;

  notify(msg: string) {
    this.toast = msg;
    setTimeout(() => {
      if (this.toast === msg) this.toast = null;
    }, 4000);
  }

  async openProject(root: string) {
    if (this.root && !(await this.saveAll())) return;
    this.unlisten?.();
    this.editor.reset();
    this.root = root;
    this.openFiles = [];
    this.active = null;
    this.dirty = {};
    this.diagnostics = [];
    this.lastResult = null;
    this.pdfPath = null;
    this.recents = [root, ...this.recents.filter((r) => r !== root)].slice(0, 10);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents));

    try {
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await api.readFile(root, SETTINGS_FILE)) };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    if (!this.settings.main) this.settings.main = await api.detectMain(root);

    await this.refreshTree();
    await this.refreshOutline();
    await api.watchProject(root);
    this.unlisten = await listen<string[]>("fs-changed", (e) => this.onFsChanged(e.payload));

    this.lspStatus = "starting";
    startLsp(root)
      .then((client) => {
        this.editor.setLspClient(client, root);
        this.lspStatus = client ? "ready" : "error";
      })
      .catch(() => (this.lspStatus = "error"));

    if (this.settings.main) {
      await this.openFile(this.settings.main);
      void this.compile(true);
    }
  }

  async saveSettings() {
    if (!this.root) return;
    await api.writeFile(this.root, SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
  }

  async refreshTree() {
    if (this.root) this.files = await api.listFiles(this.root);
  }

  async refreshOutline() {
    if (this.root && this.settings.main) this.outline = await api.outline(this.root, this.settings.main);
  }

  private onFsChanged(paths: string[]) {
    clearTimeout(this.treeTimer);
    this.treeTimer = window.setTimeout(() => {
      void this.refreshTree();
      if (paths.some((p) => p.endsWith(".tex"))) void this.refreshOutline();
    }, 200);
    // Recarga archivos abiertos modificados fuera de la app (si no hay cambios locales).
    for (const p of paths) {
      if (this.openFiles.includes(p) && !this.dirty[p] && this.root) {
        api.readFile(this.root, p).then((text) => this.editor.reloadIfChanged(p, text)).catch(() => {});
      }
    }
  }

  async openFile(path: string, line?: number) {
    if (!this.root) return;
    if (!isTextFile(path)) {
      this.notify(`No se puede editar ${path} como texto`);
      return;
    }
    if (!this.editor.has(path)) {
      const text = await api.readFile(this.root, path);
      this.editor.load(path, text);
    }
    if (!this.openFiles.includes(path)) this.openFiles = [...this.openFiles, path];
    this.active = path;
    this.editor.show(path);
    this.editor.setCompileDiagnostics(this.diagnostics.filter((d) => d.file === path));
    if (line) this.editor.gotoLine(line);
  }

  async closeFile(path: string) {
    if (this.dirty[path]) await this.save(path);
    const idx = this.openFiles.indexOf(path);
    this.openFiles = this.openFiles.filter((p) => p !== path);
    this.editor.unload(path);
    delete this.dirty[path];
    if (this.active === path) {
      const next = this.openFiles[Math.min(idx, this.openFiles.length - 1)];
      this.active = null;
      if (next) await this.openFile(next);
    }
  }

  async save(path: string) {
    if (!this.root || !this.dirty[path]) return;
    await api.writeFile(this.root, path, this.editor.content(path));
    this.editor.markSaved(path);
  }

  async saveActive() {
    if (!this.active) return;
    const wasDirty = this.dirty[this.active];
    await this.save(this.active);
    if (wasDirty && this.settings.autoCompile !== "off") void this.compile();
  }

  async saveAll(): Promise<boolean> {
    try {
      for (const p of Object.keys(this.dirty)) if (this.dirty[p]) await this.save(p);
      return true;
    } catch (e) {
      this.notify(`Error al guardar: ${e}`);
      return false;
    }
  }

  async compile(full = false) {
    if (!this.root) return;
    if (!this.settings.main) {
      this.notify("No se encontró el archivo principal (\\documentclass)");
      return;
    }
    await this.saveAll();
    this.running++;
    this.compiling = true;
    try {
      const result = await api.compile({
        root: this.root,
        main: this.settings.main,
        engine: this.settings.engine,
        fast: !full && this.settings.fastMode,
        activeFile: this.active,
        shellEscape: this.settings.shellEscape,
        precompiledPreamble: this.settings.precompiledPreamble,
        draftImages: !full && this.settings.draftImages,
      });
      if (result.status === "cancelled") return;
      this.lastResult = result;
      this.diagnostics = result.diagnostics;
      if (this.active) this.editor.setCompileDiagnostics(result.diagnostics.filter((d) => d.file === this.active));
      if (result.pdf) {
        this.pdfPath = result.pdf;
        this.pdfVersion++;
      }
    } catch (e) {
      this.notify(String(e));
    } finally {
      // Una compilación cancelada termina mientras la nueva sigue en curso.
      this.compiling = --this.running > 0;
    }
  }
}

export const app = new AppState();

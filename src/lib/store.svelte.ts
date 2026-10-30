// Estado global de la app y acciones de alto nivel (proyecto, archivos, compilación).
import { kbd } from "./platform";
import { listen } from "@tauri-apps/api/event";
import { api, type AutoCompile, type CompileResult, type Diagnostic, type Engine, type FileNode, type OutlineItem, type SpellLang } from "./api";
import { EditorManager } from "./editor/manager";
import { startLsp } from "./editor/lsp";
import { FIGURES_DIR } from "./editor/images";
import { parseMacros, setMathMacros } from "./editor/math";
import { BUILTIN_SNIPPETS, parseUserSnippets, USER_SNIPPETS_TEMPLATE, type SnippetDef } from "./editor/snippets";

export interface ProjectSettings {
  main: string | null;
  engine: Engine;
  autoCompile: AutoCompile;
  fastMode: boolean;
  spellLang: SpellLang;
  shellEscape: boolean;
  precompiledPreamble: boolean;
  draftImages: boolean;
  mathPreview: boolean;
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
  mathPreview: true,
};

const SETTINGS_FILE = ".editex/settings.json";
export const SNIPPETS_FILE = ".editex/snippets.json";
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
  /** Archivos abiertos con cambios locales que además cambiaron en disco (p. ej. por un agente). */
  conflicts = $state<Record<string, boolean>>({});
  /** Último contenido guardado/leído de cada archivo abierto: distingue nuestras escrituras de las ajenas. */
  private savedText = new Map<string, string>();

  /** Estado de la interfaz que también controla la paleta de comandos. */
  ui = $state({
    sidebar: true,
    sideTab: "files" as "files" | "outline" | "search",
    pdf: true,
    problems: false,
    settings: false,
    palette: null as null | "commands" | "files" | "snippets",
    bottomTab: "problems" as "problems" | "log" | "terminal",
    /** La terminal se crea la primera vez que se abre y luego se mantiene viva. */
    terminalStarted: false,
    ai: localStorage.getItem("editex.aiOpen") === "1",
  });

  constructor() {
    $effect.root(() => {
      $effect(() => {
        localStorage.setItem("editex.aiOpen", this.ui.ai ? "1" : "0");
      });
    });
  }

  /** Petición pendiente para el panel de IA (p. ej. «Arreglar con IA» desde Problemas). */
  aiRequest = $state<{ text: string; errors: boolean } | null>(null);

  /** Problemas de compilación adjuntos al próximo mensaje del chat de IA. */
  aiAttachments = $state<Diagnostic[]>([]);

  /** Adjunta errores/advertencias al chat de IA (sin enviar) y abre el panel. */
  attachToAi(diags: Diagnostic[]) {
    this.ui.ai = true;
    const key = (d: Diagnostic) => `${d.file}:${d.line}:${d.message}`;
    const have = new Set(this.aiAttachments.map(key));
    this.aiAttachments = [...this.aiAttachments, ...diags.filter((d) => !have.has(key(d)))];
  }

  askAi(text: string, errors = false) {
    this.ui.ai = true;
    this.aiRequest = { text, errors };
  }

  /** Lo registra la terminal integrada. */
  terminal: { run: (command: string) => Promise<void>; restart: () => Promise<void> } | null = null;

  /** Abre la terminal integrada y, opcionalmente, ejecuta un comando en ella. */
  async openTerminal(command?: string) {
    this.ui.terminalStarted = true;
    this.ui.problems = true;
    this.ui.bottomTab = "terminal";
    if (!command) return;
    // La terminal se monta en el siguiente ciclo.
    for (let i = 0; i < 50 && !this.terminal; i++) await new Promise((r) => setTimeout(r, 40));
    await this.terminal?.run(command);
  }

  editor = new EditorManager({
    onDirty: (path, dirty) => (this.dirty[path] = dirty),
    onIdle: (path) => {
      if (this.settings.autoCompile === "idle") void this.save(path).then(() => this.compile());
    },
    onSave: () => void this.saveActive(),
    onCompile: (full) => void this.compile(full),
    onSyncForward: (line) => this.syncForward?.(line),
    spellLang: () => this.settings.spellLang,
    snippets: () => this.snippets,
    mathPreview: () => this.settings.mathPreview,
    onNextProblem: (dir) => void this.nextProblem(dir),
    saveImage: async (stem, ext, data) => {
      if (!this.root) return null;
      try {
        const path = await api.saveBinary(this.root, FIGURES_DIR, stem, ext, data);
        this.notify(`Imagen guardada en ${path}`);
        return path;
      } catch (e) {
        this.notify(`No se pudo guardar la imagen: ${e}`);
        return null;
      }
    },
  });

  /** Snippets incluidos + los del proyecto (.editex/snippets.json). */
  snippets: SnippetDef[] = BUILTIN_SNIPPETS;
  /** Índice del último problema visitado con F8. */
  private problemIndex = -1;

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
    await this.loadUserSnippets();
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
    await this.refreshMacros();
  }

  /** Texto actual de un archivo: el del editor si está abierto, si no el del disco. */
  private async text(path: string) {
    return this.editor.has(path) ? this.editor.content(path) : api.readFile(this.root!, path);
  }

  /** Macros del preámbulo (y de los archivos que incluye) para la vista previa de fórmulas. */
  async refreshMacros() {
    if (!this.root || !this.settings.main) return;
    try {
      const main = await this.text(this.settings.main);
      const end = main.indexOf("\\begin{document}");
      const preamble = end >= 0 ? main.slice(0, end) : main;
      let all = preamble;
      for (const m of preamble.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) {
        const name = m[1].trim();
        all += "\n" + (await this.text(name.endsWith(".tex") ? name : `${name}.tex`).catch(() => ""));
      }
      setMathMacros(parseMacros(all));
    } catch {
      setMathMacros({});
    }
  }

  async loadUserSnippets() {
    this.snippets = BUILTIN_SNIPPETS;
    if (!this.root) return;
    try {
      const user = parseUserSnippets(await api.readFile(this.root, SNIPPETS_FILE));
      // Los del usuario tienen prioridad sobre los incluidos con el mismo prefijo.
      const prefixes = new Set(user.map((s) => s.prefix));
      this.snippets = [...user, ...BUILTIN_SNIPPETS.filter((s) => !prefixes.has(s.prefix))];
    } catch (e) {
      if (!String(e).includes("No such file") && !String(e).includes("no existe")) this.notify(`snippets.json no es válido: ${e}`);
    }
  }

  /** Abre (creándolo si hace falta) el archivo de snippets del proyecto. */
  async editUserSnippets() {
    if (!this.root) return;
    try {
      await api.readFile(this.root, SNIPPETS_FILE);
    } catch {
      await api.writeFile(this.root, SNIPPETS_FILE, USER_SNIPPETS_TEMPLATE);
    }
    await this.openFile(SNIPPETS_FILE);
  }

  /** Salta al siguiente/anterior error o advertencia (F8 / Shift+F8). */
  async nextProblem(dir: 1 | -1) {
    const list = this.diagnostics.filter((d) => d.file && !d.file.startsWith("/") && d.line && d.severity !== "info");
    if (!list.length) {
      this.notify(this.lastResult ? "No hay errores ni advertencias" : `Compila primero (${kbd("Ctrl+Enter")})`);
      return;
    }
    // Errores primero, luego advertencias; dentro de cada grupo, en orden de aparición.
    const sorted = [...list.filter((d) => d.severity === "error"), ...list.filter((d) => d.severity === "warning")];
    this.problemIndex = (this.problemIndex + dir + sorted.length) % sorted.length;
    const d = sorted[this.problemIndex];
    await this.openFile(d.file!, d.line!);
    this.ui.problems = true;
    this.notify(`${this.problemIndex + 1}/${sorted.length}: ${d.message}`);
  }

  private onFsChanged(paths: string[]) {
    clearTimeout(this.treeTimer);
    this.treeTimer = window.setTimeout(() => {
      void this.refreshTree();
      if (paths.some((p) => p.endsWith(".tex"))) void this.refreshOutline();
    }, 200);
    for (const p of paths) {
      if (this.openFiles.includes(p) && this.root) void this.syncFromDisk(p);
    }
  }

  /** Un archivo abierto cambió en disco: recargar si no hay cambios locales, o marcar conflicto. */
  private async syncFromDisk(path: string) {
    let disk: string;
    try {
      disk = await api.readFile(this.root!, path);
    } catch {
      return;
    }
    // Eco de nuestra propia escritura.
    if (disk === this.savedText.get(path)) return;
    if (this.dirty[path]) {
      this.conflicts[path] = true;
      this.notify(`${path} cambió en disco mientras tenías cambios sin guardar`);
      return;
    }
    this.savedText.set(path, disk);
    this.editor.reloadIfChanged(path, disk);
  }

  /** Resuelve un conflicto: quedarse con lo del disco o sobrescribirlo con lo del editor. */
  async resolveConflict(path: string, keep: "disk" | "mine") {
    if (!this.root) return;
    if (keep === "disk") {
      const disk = await api.readFile(this.root, path);
      this.savedText.set(path, disk);
      this.editor.reloadIfChanged(path, disk);
      this.editor.markSaved(path);
    } else {
      await this.save(path);
    }
    delete this.conflicts[path];
  }

  async openFile(path: string, line?: number) {
    if (!this.root) return;
    if (!isTextFile(path)) {
      this.notify(`No se puede editar ${path} como texto`);
      return;
    }
    if (!this.editor.has(path)) {
      const text = await api.readFile(this.root, path);
      this.savedText.set(path, text);
      this.editor.load(path, text);
    }
    if (!this.openFiles.includes(path)) this.openFiles = [...this.openFiles, path];
    this.active = path;
    this.editor.show(path);
    this.editor.setCompileDiagnostics(this.diagnostics.filter((d) => d.file === path));
    if (line) this.editor.gotoLine(line);
  }

  /** Abre un archivo y selecciona `from..to` (columnas UTF-16) en la línea indicada. */
  async openAt(path: string, line: number, from: number, to: number) {
    await this.openFile(path);
    this.editor.selectInLine(line, from, to);
  }

  /** Rutas abiertas afectadas al mover/borrar `path` (archivo o carpeta). */
  private affected(path: string) {
    return this.openFiles.filter((p) => p === path || p.startsWith(path + "/"));
  }

  async movePath(from: string, to: string) {
    if (!this.root || from === to) return;
    const moved = this.affected(from);
    for (const p of moved) await this.save(p);
    try {
      await api.renamePath(this.root, from, to);
    } catch (e) {
      this.notify(String(e));
      return;
    }
    const remap = (p: string) => to + p.slice(from.length);
    const wasActive = this.active;
    for (const p of moved) this.editor.unload(p);
    this.openFiles = this.openFiles.map((p) => (moved.includes(p) ? remap(p) : p));
    for (const p of moved) delete this.dirty[p];
    if (this.settings.main && (this.settings.main === from || this.settings.main.startsWith(from + "/"))) {
      this.settings.main = remap(this.settings.main);
      await this.saveSettings();
    }
    await this.refreshTree();
    await this.refreshOutline();
    if (wasActive && moved.includes(wasActive)) {
      this.active = null;
      await this.openFile(remap(wasActive));
    }
  }

  async trashPath(path: string) {
    if (!this.root) return;
    try {
      await api.trashPath(this.root, path);
    } catch (e) {
      this.notify(String(e));
      return;
    }
    for (const p of this.affected(path)) {
      this.dirty[p] = false;
      await this.closeFile(p);
    }
    await this.refreshTree();
    await this.refreshOutline();
    this.notify(`«${path}» movido a la papelera`);
  }

  /** Tras reemplazar en disco: recarga los archivos abiertos (sin cambios locales). */
  async reloadOpenFiles() {
    if (!this.root) return;
    for (const p of this.openFiles) {
      if (!this.dirty[p]) this.editor.reloadIfChanged(p, await api.readFile(this.root, p));
    }
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
    const content = this.editor.content(path);
    this.savedText.set(path, content);
    await api.writeFile(this.root, path, content);
    this.editor.markSaved(path);
    delete this.conflicts[path];
    if (path === SNIPPETS_FILE) await this.loadUserSnippets();
    if (path === this.settings.main) await this.refreshMacros();
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
      this.problemIndex = -1;
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

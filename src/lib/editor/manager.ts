// Gestiona una única EditorView de CodeMirror y un EditorState por archivo abierto.
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import type { LSPClient } from "@codemirror/lsp-client";
import type { Diagnostic } from "../api";
import { latexLanguage, latexHighlight, closeEnvironmentOnEnter } from "./latex";
import { compileDiagnostics, setCompileDiagnostics } from "./diagnostics";
import { spellChecker, type SpellMenuRequest } from "./spell";
import { editorTheme } from "./theme";
import { fileUri } from "../platform";
import { pasteImages } from "./images";
import { mathPreview } from "./math";
import { expandSnippet, snippetSource, type SnippetDef } from "./snippets";

export interface EditorCallbacks {
  onDirty(path: string, dirty: boolean): void;
  onIdle(path: string): void;
  onSave(): void;
  onCompile(full: boolean): void;
  onSyncForward(line: number): void;
  spellLang(): string;
  saveImage(stem: string, ext: string, data: Uint8Array): Promise<string | null>;
  snippets(): SnippetDef[];
  mathPreview(): boolean;
  onNextProblem(dir: 1 | -1): void;
}

const IDLE_MS = 1200;

export class EditorManager {
  view: EditorView | null = null;
  private states = new Map<string, EditorState>();
  private dirty = new Set<string>();
  private current: string | null = null;
  private lsp = new Compartment();
  private client: LSPClient | null = null;
  private root: string | null = null;
  private idleTimer: number | undefined;
  /** El componente Svelte lo asigna para mostrar el menú de sugerencias. */
  onSpellMenu: ((req: SpellMenuRequest) => void) | null = null;

  constructor(private cb: EditorCallbacks) {}

  mount(parent: HTMLElement) {
    this.view = new EditorView({ parent, state: EditorState.create({ extensions: [editorTheme, EditorView.editable.of(false)] }) });
    if (this.current) this.show(this.current);
  }

  destroy() {
    this.view?.destroy();
    this.view = null;
  }

  reset() {
    this.states.clear();
    this.dirty.clear();
    this.current = null;
    this.client = null;
    this.view?.setState(EditorState.create({ extensions: [editorTheme, EditorView.editable.of(false)] }));
  }

  private uri(path: string) {
    return fileUri(`${this.root}/${path}`);
  }

  private lspExtension(path: string): Extension {
    return this.client && /\.(tex|bib|sty|cls)$/.test(path) ? this.client.plugin(this.uri(path), path.endsWith(".bib") ? "bibtex" : "latex") : [];
  }

  setLspClient(client: LSPClient | null, root: string) {
    this.client = client;
    this.root = root;
    for (const [path, state] of this.states) {
      const effects = this.lsp.reconfigure(this.lspExtension(path));
      if (path === this.current && this.view) this.view.dispatch({ effects });
      else this.states.set(path, state.update({ effects }).state);
    }
  }

  private extensions(path: string): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of("  "),
      latexLanguage,
      latexHighlight,
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, maxRenderedOptions: 80 }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: "Mod-s", run: () => (this.cb.onSave(), true) },
          { key: "Mod-Enter", run: () => (this.cb.onCompile(false), true) },
          { key: "Shift-Mod-Enter", run: () => (this.cb.onCompile(true), true) },
          {
            key: "Mod-j",
            run: (v) => (this.cb.onSyncForward(v.state.doc.lineAt(v.state.selection.main.head).number), true),
          },
          { key: "Enter", run: closeEnvironmentOnEnter },
          { key: "Tab", run: (v) => acceptCompletion(v) || expandSnippet(() => this.cb.snippets())(v) },
          { key: "F8", run: () => (this.cb.onNextProblem(1), true) },
          { key: "Shift-F8", run: () => (this.cb.onNextProblem(-1), true) },
        ]),
      ),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      editorTheme,
      compileDiagnostics,
      /\.tex$/.test(path) ? mathPreview(() => this.cb.mathPreview()) : [],
      EditorState.languageData.of(() => [{ autocomplete: snippetSource(() => this.cb.snippets()) }]),
      /\.(tex|txt|md)$/.test(path) ? spellChecker(() => this.cb.spellLang(), (req) => this.onSpellMenu?.(req)) : [],
      /\.tex$/.test(path) ? pasteImages((stem, ext, data) => this.cb.saveImage(stem, ext, data)) : [],
      this.lsp.of(this.lspExtension(path)),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged || this.current !== path) return;
        if (!this.dirty.has(path)) {
          this.dirty.add(path);
          this.cb.onDirty(path, true);
        }
        clearTimeout(this.idleTimer);
        this.idleTimer = window.setTimeout(() => this.cb.onIdle(path), IDLE_MS);
      }),
    ];
  }

  has(path: string) {
    return this.states.has(path) || this.current === path;
  }

  load(path: string, text: string) {
    this.states.set(path, EditorState.create({ doc: text, extensions: this.extensions(path) }));
  }

  unload(path: string) {
    this.states.delete(path);
    this.dirty.delete(path);
    if (this.current === path) this.current = null;
  }

  /** Cambia el archivo visible guardando el estado (undo, selección, scroll) del anterior. */
  show(path: string) {
    if (!this.view) {
      this.current = path;
      return;
    }
    if (this.current && this.current !== path && this.states.has(this.current)) {
      this.states.set(this.current, this.view.state);
    }
    const state = this.states.get(path);
    if (!state) return;
    this.current = path;
    this.view.setState(state);
    this.view.focus();
  }

  private stateOf(path: string) {
    return path === this.current && this.view ? this.view.state : this.states.get(path);
  }

  content(path: string) {
    return this.stateOf(path)?.doc.toString() ?? "";
  }

  markSaved(path: string) {
    this.dirty.delete(path);
    this.cb.onDirty(path, false);
  }

  reloadIfChanged(path: string, text: string) {
    const state = this.stateOf(path);
    if (!state || state.doc.toString() === text) return;
    const tr = { changes: { from: 0, to: state.doc.length, insert: text } };
    if (path === this.current && this.view) {
      this.view.dispatch(tr);
      this.markSaved(path);
    } else {
      this.states.set(path, state.update(tr).state);
    }
  }

  gotoLine(line: number) {
    const view = this.view;
    if (!view) return;
    const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    view.dispatch({
      selection: EditorSelection.cursor(l.from),
      effects: EditorView.scrollIntoView(l.from, { y: "center" }),
    });
    view.focus();
  }

  selectInLine(line: number, from: number, to: number) {
    const view = this.view;
    if (!view) return;
    const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    const a = Math.min(l.from + from, l.to);
    const b = Math.min(l.from + to, l.to);
    view.dispatch({ selection: EditorSelection.range(a, b), effects: EditorView.scrollIntoView(a, { y: "center" }) });
  }

  setCompileDiagnostics(diags: Diagnostic[]) {
    this.view?.dispatch({ effects: setCompileDiagnostics.of(diags) });
  }
}

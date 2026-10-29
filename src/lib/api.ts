// Envoltorios tipados de los comandos del backend Rust.
import { invoke } from "@tauri-apps/api/core";

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

export interface OutlineItem {
  level: number;
  title: string;
  file: string;
  line: number;
}

export interface Diagnostic {
  file: string | null;
  line: number | null;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface CompileResult {
  status: "ok" | "error" | "cancelled";
  pdf: string | null;
  diagnostics: Diagnostic[];
  durationMs: number;
  mode: string;
  output: string;
}

export interface CompileRequest {
  root: string;
  main: string;
  engine: Engine;
  fast: boolean;
  activeFile: string | null;
  shellEscape: boolean;
  precompiledPreamble: boolean;
  draftImages: boolean;
}

export interface Misspelling {
  from: number;
  to: number;
  word: string;
}

export interface PdfLocation {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SearchMatch {
  line: number;
  from: number;
  to: number;
  text: string;
}

export interface FileMatches {
  file: string;
  matches: SearchMatch[];
}

export type Engine = "pdflatex" | "xelatex" | "lualatex";
export type SpellLang = "es" | "en" | "es+en" | "off";
export type AutoCompile = "off" | "save" | "idle";

export const api = {
  initialProject: () => invoke<string | null>("initial_project"),
  listFiles: (root: string) => invoke<FileNode[]>("list_files", { root }),
  detectMain: (root: string) => invoke<string | null>("detect_main", { root }),
  readFile: (root: string, path: string) => invoke<string>("read_file", { root, path }),
  writeFile: (root: string, path: string, content: string) => invoke<void>("write_file", { root, path, content }),
  createFolder: (root: string, path: string) => invoke<void>("create_folder", { root, path }),
  renamePath: (root: string, from: string, to: string) => invoke<void>("rename_path", { root, from, to }),
  trashPath: (root: string, path: string) => invoke<void>("trash_path", { root, path }),
  importFile: (root: string, source: string, dir: string) => invoke<string>("import_file", { root, source, dir }),
  /** Guarda bytes en `dir/stem.ext` (sin sobrescribir) y devuelve la ruta relativa final. */
  saveBinary: (root: string, dir: string, stem: string, ext: string, data: Uint8Array) =>
    invoke<string>("save_binary", data, {
      headers: { "x-root": encodeURIComponent(root), "x-dir": encodeURIComponent(dir), "x-stem": encodeURIComponent(stem), "x-ext": encodeURIComponent(ext) },
    }),
  searchProject: (root: string, opts: SearchOptions) => invoke<FileMatches[]>("search_project", { root, opts }),
  replaceInProject: (root: string, opts: SearchOptions, replacement: string, files: string[]) =>
    invoke<number>("replace_in_project", { root, opts, replacement, files }),
  readBinary: (path: string) => invoke<ArrayBuffer>("read_binary", { path }),
  outline: (root: string, main: string) => invoke<OutlineItem[]>("outline", { root, main }),
  importZip: (zipPath: string, dest: string) => invoke<string>("import_zip", { zipPath, dest }),
  exportZip: (root: string, zipPath: string) => invoke<void>("export_zip", { root, zipPath }),
  watchProject: (root: string) => invoke<void>("watch_project", { root }),
  compile: (req: CompileRequest) => invoke<CompileResult>("compile", { req }),
  cancelCompile: () => invoke<void>("cancel_compile"),
  spellCheck: (text: string, lang: string) => invoke<Misspelling[]>("spell_check", { text, lang }),
  spellSuggest: (word: string, lang: string) => invoke<string[]>("spell_suggest", { word, lang }),
  spellAddWord: (word: string) => invoke<void>("spell_add_word", { word }),
  synctexForward: (root: string, pdf: string, file: string, line: number) =>
    invoke<PdfLocation | null>("synctex_forward", { root, pdf, file, line }),
  synctexInverse: (root: string, pdf: string, page: number, x: number, y: number) =>
    invoke<{ file: string; line: number } | null>("synctex_inverse", { root, pdf, page, x, y }),
};

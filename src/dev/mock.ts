// Backend simulado para probar la interfaz en un navegador normal (`pnpm dev` y abrir `/?mock`).
// Usa examples/tesis como proyecto; solo existe en desarrollo.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const ROOT = "/mock/tesis";
const files = new Map<string, string | null>(); // ruta -> contenido (null = sin cargar)
for (const f of [
  "main.tex",
  "referencias.bib",
  "capitulos/introduccion.tex",
  "capitulos/metodos.tex",
  "capitulos/resultados.tex",
  "capitulos/conclusiones.tex",
  "main.aux",
])
  files.set(f, null);

async function read(path: string) {
  if (!files.has(path)) throw new Error(`no existe ${path}`);
  if (files.get(path) == null) files.set(path, await (await fetch(`/examples/tesis/${path}`)).text());
  return files.get(path)!;
}

function tree() {
  type Node = { name: string; path: string; is_dir: boolean; children: Node[] };
  const root: Node[] = [];
  for (const path of [...files.keys()].sort()) {
    let level = root;
    const parts = path.split("/");
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join("/");
      let node = level.find((n) => n.name === name);
      if (!node) {
        node = { name, path: p, is_dir: i < parts.length - 1, children: [] };
        level.push(node);
      }
      level = node.children;
    });
  }
  const sort = (l: Node[]) => {
    l.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
    l.forEach((n) => sort(n.children));
    return l;
  };
  return sort(root);
}

mockWindows("main");
mockIPC(
  async (cmd, args: any) => {
    switch (cmd) {
      case "initial_project":
        return ROOT;
      case "list_files":
        return tree();
      case "detect_main":
        return "main.tex";
      case "read_file":
        return read(args.path);
      case "write_file":
        files.set(args.path, args.content);
        return;
      case "rename_path":
        for (const k of [...files.keys()])
          if (k === args.from || k.startsWith(args.from + "/")) {
            files.set(args.to + k.slice(args.from.length), files.get(k)!);
            files.delete(k);
          }
        return;
      case "trash_path":
        for (const k of [...files.keys()]) if (k === args.path || k.startsWith(args.path + "/")) files.delete(k);
        return;
      case "outline": {
        const out: unknown[] = [];
        for (const f of [...files.keys()].filter((f) => f.endsWith(".tex"))) {
          (await read(f)).split("\n").forEach((l, i) => {
            const m = /\\(chapter|section)\{([^}]*)\}/.exec(l);
            if (m) out.push({ level: m[1] === "chapter" ? 1 : 2, title: m[2], file: f, line: i + 1 });
          });
        }
        return out;
      }
      case "search_project": {
        const q = args.opts.query.toLowerCase();
        const res: unknown[] = [];
        for (const f of [...files.keys()].filter((f) => /\.(tex|bib)$/.test(f))) {
          const matches: unknown[] = [];
          (await read(f)).split("\n").forEach((l, i) => {
            const at = l.toLowerCase().indexOf(q);
            if (q && at >= 0) matches.push({ line: i + 1, from: at, to: at + q.length, text: l });
          });
          if (matches.length) res.push({ file: f, matches });
        }
        return res;
      }
      case "compile":
        await new Promise((r) => setTimeout(r, 400));
        return {
          status: "error",
          pdf: "/mock.pdf",
          diagnostics: [
            { file: "capitulos/metodos.tex", line: 4, severity: "error", message: "Undefined control sequence. — La energía \\foo" },
            { file: "capitulos/resultados.tex", line: 3, severity: "warning", message: "Reference `fig:curva' on page 5 undefined on input line 3." },
            { file: "main.tex", line: 30, severity: "error", message: "Missing $ inserted. — x_1" },
          ],
          durationMs: 400,
          mode: "completo (simulado)",
          output: "",
        };
      case "read_binary":
        return (await fetch("/node_modules/.cache/mock.pdf")).arrayBuffer();
      case "save_binary":
        files.set("figuras/imagen-pegada.png", "");
        return "figuras/imagen-pegada.png";
      case "spell_check":
        return [];
      case "lsp_start":
        throw new Error("sin texlab en modo simulado");
      case "synctex_forward":
        return { page: 2, x: 72, y: 200, width: 300, height: 12 };
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

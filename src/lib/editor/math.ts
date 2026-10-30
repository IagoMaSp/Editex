// Vista previa de fórmulas con KaTeX: al poner el cursor (o el ratón) sobre matemáticas.
import katex from "katex";
import "katex/dist/katex.min.css";
import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from "@codemirror/view";

export interface MathRange {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/** Entornos matemáticos y cómo traducirlos a algo que KaTeX entienda. */
const ENVS: Record<string, string | null> = {
  equation: null,
  displaymath: null,
  math: null,
  align: "aligned",
  flalign: "aligned",
  alignat: "aligned",
  gather: "gathered",
  multline: "gathered",
  eqnarray: "array",
};
const ENV_NAMES = Object.keys(ENVS).flatMap((e) => [e, `${e}*`]);
const ENV_RE = new RegExp(`\\\\(begin|end)\\{(${ENV_NAMES.map((e) => e.replace("*", "\\*")).join("|")})\\}`, "g");
const WINDOW = 6000;

let macros: Record<string, string> = {};

/** Macros del documento (\newcommand, \DeclareMathOperator...) para que KaTeX las conozca. */
export function setMathMacros(m: Record<string, string>) {
  macros = m;
}

/** Contenido de un grupo `{...}` balanceado que empieza en `start` (posición de `{`). */
function group(text: string, start: number): [string, number] | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return [text.slice(start + 1, i), i + 1];
  }
  return null;
}

export function parseMacros(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z]+)\}?\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*(?=\{)|\\DeclareMathOperator\*?\s*\{\\([A-Za-z]+)\}\s*(?=\{)|\\def\s*\\([A-Za-z]+)\s*(?:#\d)*\s*(?=\{)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = group(text, re.lastIndex);
    if (!body) continue;
    if (m[1]) out[`\\${m[1]}`] = body[0];
    else if (m[3]) out[`\\${m[3]}`] = `\\operatorname{${body[0]}}`;
    else if (m[4]) out[`\\${m[4]}`] = body[0];
    re.lastIndex = body[1];
  }
  return out;
}

function toKatex(env: string, body: string): string {
  const base = env.replace("*", "");
  let content = body
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\(nonumber|notag)\b/g, "")
    .replace(/\\tag\*?\s*\{[^}]*\}/g, "");
  if (base === "alignat") content = content.replace(/^\s*\{\d+\}/, "");
  const target = ENVS[base];
  if (!target) return content;
  if (target === "array") return `\\begin{array}{rcl}${content}\\end{array}`;
  return `\\begin{${target}}${content}\\end{${target}}`;
}

/** Busca un entorno matemático que contenga `pos`. */
function findEnv(doc: string, offset: number, pos: number): MathRange | null {
  let open: { env: string; at: number; inner: number } | null = null;
  ENV_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENV_RE.exec(doc))) {
    const at = offset + m.index;
    if (m[1] === "begin") {
      if (at > pos) break;
      open = { env: m[2], at, inner: at + m[0].length };
    } else if (open && m[2] === open.env) {
      const end = at + m[0].length;
      if (pos >= open.at && pos <= end) {
        return { from: open.at, to: end, tex: toKatex(open.env, doc.slice(open.inner - offset, at - offset)), display: true };
      }
      open = null;
    }
  }
  return null;
}

/** Busca \[...\], $$...$$ o $...$ alrededor de `pos` dentro del texto `doc` (que empieza en `offset`). */
function findDelimited(doc: string, offset: number, pos: number): MathRange | null {
  const rel = pos - offset;
  let i = 0;
  while (i < doc.length) {
    const c = doc[i];
    if (c === "%") {
      const nl = doc.indexOf("\n", i);
      if (nl < 0) break;
      i = nl + 1;
      continue;
    }
    let open = "";
    let close = "";
    if (c === "\\" && (doc[i + 1] === "[" || doc[i + 1] === "(")) {
      open = doc.slice(i, i + 2);
      close = doc[i + 1] === "[" ? "\\]" : "\\)";
    } else if (c === "\\") {
      i += 2;
      continue;
    } else if (c === "$") {
      open = doc[i + 1] === "$" ? "$$" : "$";
      close = open;
    }
    if (!open) {
      if (i > rel) break;
      i++;
      continue;
    }
    // Busca el cierre saltando escapes.
    let j = i + open.length;
    let end = -1;
    while (j < doc.length) {
      if (doc[j] === "\\" && doc.slice(j, j + close.length) !== close) {
        j += 2;
        continue;
      }
      if (doc.startsWith(close, j)) {
        end = j;
        break;
      }
      // Las fórmulas en línea no cruzan párrafos.
      if (open === "$" && doc[j] === "\n" && doc[j + 1] === "\n") break;
      j++;
    }
    if (end < 0) {
      i += open.length;
      continue;
    }
    const stop = end + close.length;
    if (rel >= i && rel <= stop) {
      return {
        from: offset + i,
        to: offset + stop,
        tex: doc.slice(i + open.length, end),
        display: open === "$$" || open === "\\[",
      };
    }
    if (i > rel) break;
    i = stop;
  }
  return null;
}

export function findMath(state: EditorState, pos: number): MathRange | null {
  // Solo una ventana alrededor del cursor: barato incluso en documentos grandes.
  const from = Math.max(0, pos - WINDOW);
  // Empezar el escaneo de $ en un inicio de línea evita desfasar los pares.
  const start = state.doc.lineAt(from).from;
  const to = Math.min(state.doc.length, pos + WINDOW);
  const text = state.sliceDoc(start, to);
  const found = findEnv(text, start, pos) ?? findDelimited(text, start, pos);
  return found && found.tex.trim() ? found : null;
}

function render(range: MathRange): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-math-preview";
  katex.render(range.tex, dom, {
    displayMode: range.display,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    macros: { ...macros },
  });
  return dom;
}

function tooltipFor(range: MathRange): Tooltip {
  return { pos: range.to, above: false, strictSide: false, arrow: true, create: () => ({ dom: render(range) }) };
}

const cursorMath = (enabled: () => boolean) =>
  StateField.define<{ range: MathRange; tooltip: Tooltip } | null>({
    create: () => null,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      const sel = tr.state.selection.main;
      if (!enabled() || !sel.empty) return null;
      const range = findMath(tr.state, sel.head);
      if (!range) return null;
      // Mismo contenido: reutilizar el tooltip para no re-renderizar.
      if (value && value.range.tex === range.tex && value.range.from === range.from) return value;
      return { range, tooltip: tooltipFor(range) };
    },
    provide: (f) => showTooltip.from(f, (v) => v?.tooltip ?? null),
  });

export function mathPreview(enabled: () => boolean): Extension {
  return [
    cursorMath(enabled),
    hoverTooltip(
      (view, pos) => {
        if (!enabled()) return null;
        const range = findMath(view.state, pos);
        const head = view.state.selection.main.head;
        // Si el cursor ya está dentro, ya se muestra la vista previa.
        if (!range || (head >= range.from && head <= range.to)) return null;
        return { ...tooltipFor(range), pos: range.from, end: range.to, above: true };
      },
      { hoverTime: 350 },
    ),
    EditorView.baseTheme({
      ".cm-math-preview": {
        padding: "8px 14px",
        maxWidth: "640px",
        overflowX: "auto",
        fontSize: "1.15em",
        color: "var(--text-strong)",
      },
      ".cm-math-preview .katex-display": { margin: "0" },
    }),
  ];
}

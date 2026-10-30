// Snippets: escribes un prefijo (p. ej. `eq`) y Tab/Enter lo expande. Sintaxis de CodeMirror:
// `${1:texto}` campos en orden, `${0}` posición final; las llaves sueltas son literales.
import { snippet, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

export interface SnippetDef {
  prefix: string;
  body: string;
  description: string;
}

export const BUILTIN_SNIPPETS: SnippetDef[] = [
  // Entornos
  { prefix: "eq", description: "Ecuación numerada", body: "\\begin{equation}\n\t${1}\n\t\\label{eq:${2}}\n\\end{equation}${0}" },
  { prefix: "eq*", description: "Ecuación sin número", body: "\\begin{equation*}\n\t${1}\n\\end{equation*}${0}" },
  { prefix: "ali", description: "Ecuaciones alineadas (align)", body: "\\begin{align}\n\t${1} &= ${2} \\\\\n\t${3} &= ${4}\n\\end{align}${0}" },
  { prefix: "ali*", description: "align sin números", body: "\\begin{align*}\n\t${1} &= ${2} \\\\\n\t${3} &= ${4}\n\\end{align*}${0}" },
  { prefix: "gat", description: "gather", body: "\\begin{gather}\n\t${1}\n\\end{gather}${0}" },
  { prefix: "cases", description: "Función a trozos", body: "\\begin{cases}\n\t${1} & \\text{si } ${2} \\\\\n\t${3} & \\text{si } ${4}\n\\end{cases}${0}" },
  { prefix: "beg", description: "Entorno genérico", body: "\\begin{${1:entorno}}\n\t${2}\n\\end{${1:entorno}}${0}" },
  { prefix: "fig", description: "Figura con imagen", body: "\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{${1:figuras/}}\n\t\\caption{${2}}\n\t\\label{fig:${3}}\n\\end{figure}${0}" },
  { prefix: "tab", description: "Tabla", body: "\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${1}}\n\t\\label{tab:${2}}\n\t\\begin{tabular}{${3:c c c}}\n\t\t\\hline\n\t\t${4} \\\\\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}${0}" },
  { prefix: "item", description: "Lista con viñetas", body: "\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}${0}" },
  { prefix: "enum", description: "Lista numerada", body: "\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}${0}" },
  { prefix: "mini", description: "Dos columnas (minipage)", body: "\\begin{minipage}{0.48\\textwidth}\n\t${1}\n\\end{minipage}\\hfill\n\\begin{minipage}{0.48\\textwidth}\n\t${2}\n\\end{minipage}${0}" },
  // Estructura
  { prefix: "cap", description: "Capítulo", body: "\\chapter{${1}}\n\\label{cap:${2}}\n${0}" },
  { prefix: "sec", description: "Sección", body: "\\section{${1}}\n\\label{sec:${2}}\n${0}" },
  { prefix: "ssec", description: "Subsección", body: "\\subsection{${1}}\n\\label{sec:${2}}\n${0}" },
  { prefix: "sssec", description: "Subsubsección", body: "\\subsubsection{${1}}\n${0}" },
  // Matemáticas
  { prefix: "mk", description: "Fórmula en línea $…$", body: "$${1}$${0}" },
  { prefix: "dm", description: "Fórmula destacada \\[…\\]", body: "\\[\n\t${1}\n\\]${0}" },
  { prefix: "frac", description: "Fracción", body: "\\frac{${1}}{${2}}${0}" },
  { prefix: "dfrac", description: "Fracción grande", body: "\\dfrac{${1}}{${2}}${0}" },
  { prefix: "sqrt", description: "Raíz", body: "\\sqrt{${1}}${0}" },
  { prefix: "sum", description: "Sumatoria", body: "\\sum_{${1:i=1}}^{${2:n}} ${0}" },
  { prefix: "prod", description: "Productoria", body: "\\prod_{${1:i=1}}^{${2:n}} ${0}" },
  { prefix: "int", description: "Integral definida", body: "\\int_{${1:a}}^{${2:b}} ${3} \\, d${4:x}${0}" },
  { prefix: "iint", description: "Integral doble", body: "\\iint_{${1}} ${2} \\, dA${0}" },
  { prefix: "oint", description: "Integral de línea cerrada", body: "\\oint_{${1:C}} ${2} \\cdot d\\vec{${3:r}}${0}" },
  { prefix: "lim", description: "Límite", body: "\\lim_{${1:x} \\to ${2:\\infty}} ${0}" },
  { prefix: "der", description: "Derivada", body: "\\frac{d${1}}{d${2:x}}${0}" },
  { prefix: "par", description: "Derivada parcial", body: "\\frac{\\partial ${1}}{\\partial ${2:x}}${0}" },
  { prefix: "vec", description: "Vector", body: "\\vec{${1}}${0}" },
  { prefix: "hat", description: "Versor", body: "\\hat{${1}}${0}" },
  { prefix: "abs", description: "Valor absoluto", body: "\\left| ${1} \\right|${0}" },
  { prefix: "norm", description: "Norma", body: "\\left\\| ${1} \\right\\|${0}" },
  { prefix: "lr", description: "Paréntesis ajustables", body: "\\left( ${1} \\right)${0}" },
  { prefix: "pmat", description: "Matriz ( )", body: "\\begin{pmatrix}\n\t${1} & ${2} \\\\\n\t${3} & ${4}\n\\end{pmatrix}${0}" },
  { prefix: "bmat", description: "Matriz [ ]", body: "\\begin{bmatrix}\n\t${1} & ${2} \\\\\n\t${3} & ${4}\n\\end{bmatrix}${0}" },
  { prefix: "unit", description: "Valor con unidad (siunitx)", body: "\\qty{${1}}{${2}}${0}" },
  { prefix: "text", description: "Texto dentro de fórmula", body: "\\text{${1}}${0}" },
  // Formato y referencias
  { prefix: "bf", description: "Negrita", body: "\\textbf{${1}}${0}" },
  { prefix: "it", description: "Cursiva", body: "\\textit{${1}}${0}" },
  { prefix: "emph", description: "Énfasis", body: "\\emph{${1}}${0}" },
  { prefix: "ref", description: "Referencia", body: "\\ref{${1}}${0}" },
  { prefix: "eqref", description: "Referencia a ecuación", body: "\\eqref{eq:${1}}${0}" },
  { prefix: "cite", description: "Cita bibliográfica", body: "\\cite{${1}}${0}" },
  { prefix: "foot", description: "Nota al pie", body: "\\footnote{${1}}${0}" },
];

/** Plantilla de ejemplo para `.editex/snippets.json`. */
export const USER_SNIPPETS_TEMPLATE = `{
  "// Tus snippets": "prefijo -> cuerpo. \${1:texto} = campo (Tab salta al siguiente), \${0} = posición final. Usa \\\\ para una barra invertida.",
  "ley": {
    "description": "Ley de Newton",
    "body": "\\\\vec{F} = m \\\\vec{a}"
  },
  "teo": {
    "description": "Teorema",
    "body": ["\\\\begin{teorema}", "\\t\${1}", "\\\\end{teorema}\${0}"]
  }
}
`;

/** Lee el JSON de snippets del usuario. Las claves que empiezan por "//" son comentarios. */
export function parseUserSnippets(json: string): SnippetDef[] {
  const data = JSON.parse(json) as Record<string, unknown>;
  const out: SnippetDef[] = [];
  for (const [prefix, value] of Object.entries(data)) {
    if (prefix.startsWith("//")) continue;
    if (typeof value === "string") out.push({ prefix, body: value, description: "Snippet propio" });
    else if (value && typeof value === "object") {
      const v = value as { body?: string | string[]; description?: string };
      const body = Array.isArray(v.body) ? v.body.join("\n") : v.body;
      if (typeof body === "string") out.push({ prefix, body, description: v.description ?? "Snippet propio" });
    }
  }
  return out;
}

const WORD_BEFORE = /[A-Za-z][A-Za-z*]*$/;

function toCompletion(s: SnippetDef): Completion {
  return snippetCompletion(s.body.replace(/\t/g, "  "), { label: s.prefix, detail: s.description, type: "snippet", boost: 10 });
}

/**
 * Tab tras un prefijo exacto (que no vaya después de `\`) expande el snippet.
 * No se usa Enter a propósito: escribir «par» + Enter en un párrafo no debe insertar nada.
 */
export function expandSnippet(get: () => SnippetDef[]) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const line = view.state.doc.lineAt(sel.head);
    const m = WORD_BEFORE.exec(line.text.slice(0, sel.head - line.from));
    if (!m) return false;
    const from = sel.head - m[0].length;
    if (from > line.from && line.text[from - line.from - 1] === "\\") return false;
    const def = get().find((s) => s.prefix === m[0]);
    if (!def) return false;
    snippet(def.body.replace(/\t/g, "  "))(view, null, from, sel.head);
    return true;
  };
}

/** Lista de snippets en el autocompletado, solo al pedirla con Ctrl+Espacio. */
export function snippetSource(get: () => SnippetDef[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    if (!ctx.explicit) return null;
    const word = ctx.matchBefore(WORD_BEFORE);
    if (word && word.from > 0 && ctx.state.sliceDoc(word.from - 1, word.from) === "\\") return null;
    return { from: word?.from ?? ctx.pos, options: get().map(toCompletion), validFor: /^[A-Za-z*]*$/ };
  };
}

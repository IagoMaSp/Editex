// Lenguaje LaTeX (modo stex), colores y cierre automático de entornos.
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";
import type { EditorView } from "@codemirror/view";

export const latexLanguage = StreamLanguage.define(stex);

export const latexHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.tagName, color: "var(--syn-command)" },
    { tag: t.keyword, color: "var(--syn-math)" },
    { tag: t.atom, color: "var(--syn-arg)" },
    { tag: t.standard(t.name), color: "var(--syn-arg)" },
    { tag: t.number, color: "var(--syn-number)" },
    { tag: t.bracket, color: "var(--syn-bracket)" },
    { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: t.string, color: "var(--syn-math)" },
    { tag: t.invalid, color: "var(--danger)" },
  ]),
);

/** Enter tras `\begin{env}` inserta la línea interior y el `\end{env}` correspondiente. */
export function closeEnvironmentOnEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const after = line.text.slice(sel.head - line.from);
  const m = /\\begin\{([^}]+)\}(?:\[[^\]]*\]|\{[^}]*\})*\s*$/.exec(before);
  if (!m || after.trim() !== "") return false;
  const env = m[1];
  // Si los \begin y \end de este entorno ya están equilibrados, no duplicar.
  const doc = state.doc.toString();
  const esc = env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const begins = doc.match(new RegExp(`\\\\begin\\{${esc}\\}`, "g"))?.length ?? 0;
  const ends = doc.match(new RegExp(`\\\\end\\{${esc}\\}`, "g"))?.length ?? 0;
  if (ends >= begins) return false;
  const indent = /^\s*/.exec(line.text)![0];
  const inner = indent + "  ";
  view.dispatch({
    changes: { from: sel.head, insert: `\n${inner}\n${indent}\\end{${env}}` },
    selection: { anchor: sel.head + 1 + inner.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

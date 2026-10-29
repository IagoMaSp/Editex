// Tema del editor basado en las variables CSS de la app (claro/oscuro).
import { EditorView } from "@codemirror/view";

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size)",
    backgroundColor: "var(--bg-editor)",
    color: "var(--text)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--accent)", padding: "12px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-editor)",
    color: "var(--text-faint)",
    border: "none",
    paddingLeft: "6px",
  },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--bg-hover)", border: "none", color: "var(--text-muted)" },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", maxHeight: "18em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-text)" },
  ".cm-completionDetail": { color: "var(--text-muted)", fontStyle: "normal", marginLeft: "1em" },
  ".cm-completionInfo": { padding: "8px 10px", maxWidth: "420px" },
  ".cm-panels": { backgroundColor: "var(--bg-panel)", color: "var(--text)" },
  ".cm-panels input, .cm-panels button": { fontSize: "13px" },
  ".cm-searchMatch": { backgroundColor: "var(--search-match)" },
  ".cm-selectionMatch": { backgroundColor: "var(--selection-match)" },
  ".cm-matchingBracket": { backgroundColor: "var(--selection-match)", outline: "1px solid var(--border-strong)" },
  ".cm-misspelled": {
    textDecoration: "underline wavy var(--spell)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-compile-error": { backgroundColor: "var(--error-line)", boxShadow: "inset 3px 0 0 var(--danger)" },
  ".cm-compile-warning": { backgroundColor: "var(--warning-line)", boxShadow: "inset 3px 0 0 var(--warning)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--danger)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warning)" },
});

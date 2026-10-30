// Resalta en el editor las líneas con errores/advertencias de la última compilación.
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { Diagnostic } from "../api";
import { explain } from "../errors";

export const setCompileDiagnostics = StateEffect.define<Diagnostic[]>();

const RANK = { error: 3, warning: 2, info: 1 } as const;

export const compileDiagnostics = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setCompileDiagnostics)) continue;
      // Una decoración por línea, con la severidad más alta.
      const byLine = new Map<number, Diagnostic[]>();
      for (const d of e.value) {
        if (!d.line || d.line > tr.state.doc.lines || d.severity === "info") continue;
        byLine.set(d.line, [...(byLine.get(d.line) ?? []), d]);
      }
      const builder = new RangeSetBuilder<Decoration>();
      for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
        const list = byLine.get(line)!;
        const worst = list.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a));
        builder.add(
          tr.state.doc.line(line).from,
          tr.state.doc.line(line).from,
          Decoration.line({
            class: `cm-compile-${worst.severity}`,
            attributes: { title: list.map((d) => d.message + (explain(d.message) ? `\n→ ${explain(d.message)}` : "")).join("\n\n") },
          }),
        );
      }
      deco = builder.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

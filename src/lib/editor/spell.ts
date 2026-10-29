// Corrector ortográfico: subrayado de palabras desconocidas (cálculo en Rust) y menú de sugerencias.
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { api, type Misspelling } from "../api";

export interface SpellMenuRequest {
  x: number;
  y: number;
  word: string;
  from: number;
  to: number;
  view: EditorView;
}

const setMisspellings = StateEffect.define<Misspelling[]>();
const DEBOUNCE_MS = 500;

const misspellings = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setMisspellings)) {
        deco = Decoration.set(
          e.value
            .filter((m) => m.to <= tr.state.doc.length)
            .map((m) => Decoration.mark({ class: "cm-misspelled" }).range(m.from, m.to)),
          true,
        );
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Fuerza una nueva revisión (p. ej. al cambiar de idioma o añadir una palabra). */
export const recheckSpelling = StateEffect.define<null>();

export function spellChecker(lang: () => string, onMenu: (req: SpellMenuRequest) => void): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: number | undefined;
      constructor(readonly view: EditorView) {
        this.schedule(50);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(recheckSpelling)))) this.schedule(DEBOUNCE_MS);
      }
      schedule(ms: number) {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.run(), ms);
      }
      async run() {
        const l = lang();
        const doc = this.view.state.doc;
        if (l === "off") {
          this.view.dispatch({ effects: setMisspellings.of([]) });
          return;
        }
        try {
          const result = await api.spellCheck(doc.toString(), l);
          // Si el documento cambió mientras tanto, la próxima revisión ya está programada.
          if (this.view.state.doc === doc) this.view.dispatch({ effects: setMisspellings.of(result) });
        } catch (e) {
          console.warn("spell:", e);
        }
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );

  const menu = EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      let hit: { from: number; to: number } | null = null;
      view.state.field(misspellings).between(pos, pos, (from, to) => {
        hit = { from, to };
        return false;
      });
      if (!hit) return false;
      const { from, to } = hit;
      event.preventDefault();
      onMenu({ x: event.clientX, y: event.clientY, word: view.state.sliceDoc(from, to), from, to, view });
      return true;
    },
  });

  return [misspellings, plugin, menu];
}

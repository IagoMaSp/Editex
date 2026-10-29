// Pegar imágenes del portapapeles en el editor: se guardan en figuras/ y se inserta un entorno figure.
import { EditorView } from "@codemirror/view";

export const FIGURES_DIR = "figuras";
export const IMAGE_EXT = /\.(png|jpe?g|pdf|eps)$/i;

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };

/** Inserta un entorno figure con la imagen y deja el cursor en el \caption. */
export function insertFigure(view: EditorView, path: string, pos = view.state.selection.main.head) {
  const name = path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const line = view.state.doc.lineAt(pos);
  const indent = /^\s*/.exec(line.text)![0];
  // Si la línea tiene texto, la figura va en una línea nueva.
  const prefix = line.text.trim() ? "\n" + indent : "";
  const before = `${prefix}\\begin{figure}[htbp]\n${indent}  \\centering\n${indent}  \\includegraphics[width=0.8\\textwidth]{${path}}\n${indent}  \\caption{`;
  const after = `}\n${indent}  \\label{fig:${name}}\n${indent}\\end{figure}`;
  const at = line.text.trim() ? line.to : pos;
  view.dispatch({
    changes: { from: at, insert: before + after },
    selection: { anchor: at + before.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** `save` guarda los bytes y devuelve la ruta relativa final (o null si falla). */
export function pasteImages(save: (stem: string, ext: string, data: Uint8Array) => Promise<string | null>) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const item = [...(event.clipboardData?.items ?? [])].find((i) => i.kind === "file" && MIME_EXT[i.type]);
      const file = item?.getAsFile();
      if (!item || !file) return false;
      event.preventDefault();
      void file.arrayBuffer().then(async (buf) => {
        const path = await save(`imagen-${timestamp()}`, MIME_EXT[item.type], new Uint8Array(buf));
        if (path) insertFigure(view, path);
      });
      return true;
    },
  });
}

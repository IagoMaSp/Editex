// Markdown de las respuestas del agente → HTML seguro: sin HTML crudo ni enlaces peligrosos
// (el webview puede invocar comandos de la app, así que no se confía en el texto del agente).
import { Marked } from "marked";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escape(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href)) return label;
      return `<a href="${escape(href)}" data-external>${label}</a>`;
    },
    image({ href, text }) {
      // Sin cargar recursos remotos: solo el texto alternativo.
      return escape(text || href);
    },
  },
});

export function renderMarkdown(text: string): string {
  return md.parse(text, { async: false }) as string;
}

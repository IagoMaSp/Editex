// Diferencias de plataforma en la interfaz: atajos (⌘ en macOS) y rutas de Windows.
const ua = navigator.userAgent;
export const isMac = /Macintosh|Mac OS X/.test(ua);
export const isWindows = /Windows/.test(ua);

/** Texto de un atajo: "Ctrl+Shift+Enter" → "⌘⇧↩" en macOS. */
export function kbd(shortcut: string): string {
  if (!isMac) return shortcut;
  return shortcut
    .replace(/Ctrl\+/g, "⌘")
    .replace(/Shift\+/g, "⇧")
    .replace(/Alt\+/g, "⌥")
    .replace(/Enter/g, "↩")
    .replace(/Clic/g, "clic");
}

/** Último componente de una ruta con `/` o `\`. */
export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** URI `file://` válida también para rutas de Windows (C:\… → file:///C:/…). */
export function fileUri(path: string): string {
  let p = path.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return "file://" + encodeURI(p).replace(/[?#]/g, encodeURIComponent);
}

// Explicaciones en lenguaje claro de los errores y advertencias más comunes de LaTeX.
import { kbd } from "./platform";


interface Rule {
  re: RegExp;
  explain: (m: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  {
    re: /Undefined control sequence(?:\.)?(?:\s*—\s*.*(\\[A-Za-z@]+))?/,
    explain: (m) =>
      `Comando desconocido${m[1] ? ` (probablemente ${m[1]})` : ""}: revisa que esté bien escrito o añade el \\usepackage que lo define.`,
  },
  { re: /Missing \$ inserted/, explain: () => "Hay un símbolo matemático (_, ^, \\alpha…) fuera de una fórmula: enciérralo entre $…$." },
  { re: /Display math should end with \$\$/, explain: () => "Una fórmula $$…$$ no está bien cerrada." },
  {
    re: /File [`'"]?([^'`"]+)['"]? not found/,
    explain: (m) => `No se encuentra «${m[1]}»: revisa el nombre y la ruta (relativa a la carpeta del proyecto) o instala el paquete.`,
  },
  { re: /Environment (\S+) undefined/, explain: (m) => `El entorno «${m[1]}» no existe: falta el paquete que lo define o el nombre está mal escrito.` },
  {
    re: /\\begin\{(\S+?)\} (?:on input line \d+ )?ended by \\end\{(\S+?)\}/,
    explain: (m) => `Abriste «${m[1]}» pero lo cerraste con «${m[2]}»: los \\begin y \\end no coinciden.`,
  },
  { re: /\\begin\{document\} ended by \\end/, explain: () => "Sobra un \\end{…} o falta su \\begin{…}." },
  { re: /Missing \} inserted|Extra \{|Missing \{ inserted/, explain: () => "Llaves desbalanceadas: falta o sobra una { o }." },
  { re: /Extra \}, or forgotten|Too many \}'s/, explain: () => "Sobra una } (o falta su { correspondiente)." },
  {
    re: /Runaway argument|Paragraph ended before (\\\S+) was complete|File ended while scanning/,
    explain: () => "Un argumento no se cerró: probablemente falta una } antes de una línea en blanco o del final del archivo.",
  },
  { re: /Misplaced alignment tab character &/, explain: () => "Un & fuera de una tabla o align: si quieres el símbolo, escribe \\&." },
  { re: /Extra alignment tab has been changed/, explain: () => "Una fila de la tabla tiene más columnas (&) que las declaradas." },
  { re: /There's no line here to end/, explain: () => "Un \\\\ (salto de línea) en un lugar sin texto antes: usa una línea en blanco para separar párrafos." },
  { re: /Double (superscript|subscript)/, explain: (m) => `Doble ${m[1] === "superscript" ? "superíndice" : "subíndice"}: agrupa con llaves, p. ej. x^{a^b} o x_{i_j}.` },
  { re: /Missing number, treated as zero/, explain: () => "Se esperaba un número o una longitud (p. ej. 2cm) y no se encontró." },
  { re: /Illegal unit of measure/, explain: () => "Unidad no válida: usa pt, cm, mm, in, em, ex o \\textwidth." },
  { re: /Can be used only in preamble/, explain: () => "Este comando debe ir antes de \\begin{document}." },
  { re: /Command (\\\S+) already defined/, explain: (m) => `${m[1]} ya existe: usa \\renewcommand o elige otro nombre.` },
  { re: /Option clash for package (\S+)/, explain: (m) => `El paquete ${m[1]} se carga dos veces con opciones distintas.` },
  { re: /Unicode character (.) \(U\+[0-9A-F]+\)\s*not set up/, explain: (m) => `El carácter «${m[1]}» no está soportado por pdfLaTeX: usa su comando LaTeX o compila con XeLaTeX/LuaLaTeX.` },
  { re: /Undefined color/, explain: () => "Color no definido: defínelo con \\definecolor o carga xcolor con la opción adecuada." },
  { re: /Missing \\begin\{document\}/, explain: () => "Hay texto antes de \\begin{document} o el archivo principal no es el correcto." },
  { re: /Emergency stop/, explain: () => "La compilación se detuvo por un error anterior: corrige el primer error de la lista." },
  { re: /Citation [`'](.+?)' .*undefined/, explain: (m) => `La cita «${m[1]}» no está en el .bib, o falta una compilación completa (${kbd("Ctrl+Shift+Enter")}).` },
  { re: /Reference [`'](.+?)' .*undefined/, explain: (m) => `No existe \\label{${m[1]}}, o falta una compilación completa (${kbd("Ctrl+Shift+Enter")}).` },
  { re: /There were undefined references/, explain: () => "Hay referencias sin resolver: revisa los \\ref/\\cite o haz una compilación completa." },
  { re: /Label [`'](.+?)' multiply defined/, explain: (m) => `La etiqueta «${m[1]}» está repetida: cada \\label debe ser único.` },
  { re: /Font shape .* undefined/, explain: () => "La combinación de fuente pedida no existe; se usa una parecida. Normalmente no es grave." },
  { re: /Float too large for page/, explain: () => "Una figura o tabla es más alta que la página: reduce su tamaño." },
  { re: /h' float specifier changed to `ht'/, explain: () => "No cabía la figura justo ahí; LaTeX la movió. Usa [htbp] para darle más opciones." },
  { re: /Overfull \\hbox/, explain: () => "Una línea sobresale del margen (palabra que no se puede cortar, URL o fórmula larga)." },
  { re: /Underfull \\hbox/, explain: () => "Una línea quedó con demasiado espacio entre palabras. Normalmente no es grave." },
];

export function explain(message: string): string | null {
  for (const rule of RULES) {
    const m = message.match(rule.re);
    if (m) return rule.explain(m);
  }
  return null;
}

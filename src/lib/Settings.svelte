<script lang="ts">
  import { app } from "./store.svelte";
  import type { FileNode } from "./api";
  import { recheckSpelling } from "./editor/spell";

  let { onclose }: { onclose: () => void } = $props();

  function texFiles(nodes: FileNode[]): string[] {
    return nodes.flatMap((n) => (n.is_dir ? texFiles(n.children) : n.path.endsWith(".tex") ? [n.path] : []));
  }

  async function changed(kind?: "main" | "spell") {
    await app.saveSettings();
    if (kind === "main") await app.refreshOutline();
    if (kind === "spell") app.editor.view?.dispatch({ effects: recheckSpelling.of(null) });
  }
</script>

<div class="pop" role="dialog" aria-label="Ajustes del proyecto">
  <h3>Ajustes del proyecto</h3>
  <label>
    Archivo principal
    <select bind:value={app.settings.main} onchange={() => changed("main")}>
      {#each texFiles(app.files) as f (f)}<option value={f}>{f}</option>{/each}
    </select>
  </label>
  <label>
    Motor
    <select bind:value={app.settings.engine} onchange={() => changed()}>
      <option value="pdflatex">pdfLaTeX</option>
      <option value="xelatex">XeLaTeX</option>
      <option value="lualatex">LuaLaTeX</option>
    </select>
  </label>
  <label>
    Compilar automáticamente
    <select bind:value={app.settings.autoCompile} onchange={() => changed()}>
      <option value="off">Nunca</option>
      <option value="save">Al guardar (Ctrl+S)</option>
      <option value="idle">Al dejar de escribir</option>
    </select>
  </label>
  <label>
    Ortografía
    <select bind:value={app.settings.spellLang} onchange={() => changed("spell")}>
      <option value="es+en">Español + Inglés</option>
      <option value="es">Español</option>
      <option value="en">Inglés</option>
      <option value="off">Desactivada</option>
    </select>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={app.settings.mathPreview} onchange={() => changed()} />
    <span>Vista previa de fórmulas<small>Muestra la fórmula renderizada al poner el cursor o el ratón encima.</small></span>
  </label>
  <button class="link" onclick={() => (onclose(), app.editUserSnippets())}>Editar mis snippets…</button>
  <h4>Velocidad</h4>
  <label class="check">
    <input type="checkbox" bind:checked={app.settings.fastMode} onchange={() => changed()} />
    <span>Modo rápido<small>Compila solo el capítulo (\include) que estás editando.</small></span>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={app.settings.precompiledPreamble} onchange={() => changed()} />
    <span>Preámbulo precompilado<small>Guarda los paquetes cargados en un formato (.fmt). pdfLaTeX/XeLaTeX.</small></span>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={app.settings.draftImages} onchange={() => changed()} />
    <span>Imágenes en borrador<small>En compilaciones rápidas las imágenes se muestran como cajas.</small></span>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={app.settings.shellEscape} onchange={() => changed()} />
    <span>Permitir shell-escape<small>Necesario para minted y la caché de TikZ (memoize/externalize). Ejecuta comandos del documento.</small></span>
  </label>
  <button class="primary" onclick={onclose}>Listo</button>
</div>

<style>
  .pop {
    position: absolute;
    top: 46px;
    right: 10px;
    z-index: 40;
    width: 340px;
    padding: 14px 16px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
  }
  h4 {
    margin: 6px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  label.check {
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;
    color: var(--text);
    font-size: 13px;
  }
  .check input {
    margin-top: 3px;
  }
  small {
    display: block;
    color: var(--text-faint);
    font-size: 11.5px;
    margin-top: 1px;
  }
  .primary {
    align-self: flex-end;
  }
</style>

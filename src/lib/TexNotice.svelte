<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { TexInfo } from "./api";

  let { info }: { info: TexInfo } = $props();
  let dismissed = $state(sessionStorage.getItem("editex.texNotice") === "1");

  const missingTex = $derived(!info.pdflatex);
  const missingLatexmk = $derived(info.pdflatex && !info.latexmk);

  const install = $derived(
    info.os === "macos"
      ? { name: "MacTeX", url: "https://tug.org/mactex/", extra: "o con Homebrew: brew install --cask mactex-no-gui" }
      : info.os === "windows"
        ? { name: "MiKTeX", url: "https://miktex.org/download", extra: "o TeX Live: https://tug.org/texlive/windows.html" }
        : { name: "TeX Live", url: "https://tug.org/texlive/", extra: "Arch: sudo pacman -S texlive texlive-lang biber · Debian/Ubuntu: sudo apt install texlive-full latexmk" },
  );

  function dismiss() {
    dismissed = true;
    sessionStorage.setItem("editex.texNotice", "1");
  }
</script>

{#if !dismissed && (missingTex || missingLatexmk || info.distribution === "MiKTeX")}
  <div class="notice" class:warn={!missingTex}>
    {#if missingTex}
      <strong>No se encontró LaTeX en este equipo.</strong>
      Instala <button class="link" onclick={() => openUrl(install.url)}>{install.name}</button> ({install.extra}) y reinicia Editex.
    {:else if missingLatexmk}
      <strong>Falta latexmk:</strong> se compila con una sola pasada (índices, referencias y bibliografía pueden quedar incompletos).
      {#if info.distribution === "MiKTeX"}latexmk en MiKTeX necesita Perl (p. ej. Strawberry Perl).{/if}
    {:else}
      <strong>MiKTeX:</strong> activa «Instalar paquetes que falten: Siempre» en la consola de MiKTeX, o la compilación se quedará esperando.
    {/if}
    <button class="icon close" title="Ocultar" onclick={dismiss}>✕</button>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 8px 12px;
    font-size: 13px;
    background: var(--error-line);
    border-bottom: 1px solid var(--border);
  }
  .notice.warn {
    background: var(--warning-line);
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
    font-size: inherit;
  }
  .close {
    margin-left: auto;
    width: 22px;
    height: 22px;
  }
</style>

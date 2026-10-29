<script lang="ts">
  import * as pdfjs from "pdfjs-dist";
  import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
  import { onMount, tick } from "svelte";
  import { api } from "../api";
  import { app } from "../store.svelte";

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  interface PageSize {
    w: number;
    h: number;
  }

  let container: HTMLDivElement;
  let pageEls: HTMLDivElement[] = $state([]);
  let pages = $state<PageSize[]>([]);
  let zoom = $state<number | "fit">("fit");
  let scale = $state(1);
  let currentPage = $state(1);
  let darkPdf = $state(localStorage.getItem("editex.darkPdf") === "1");
  let highlight = $state<{ page: number; x: number; y: number; w: number; h: number } | null>(null);
  let error = $state<string | null>(null);

  let doc: pdfjs.PDFDocumentProxy | null = null;
  let docTask: pdfjs.PDFDocumentLoadingTask | null = null;
  let docVersion = 0;
  let loadSeq = 0;
  /** Clave (versión:escala) con la que se pintó cada página. */
  const renderedKey = new Map<number, string>();
  let rendering = false;
  let pendingRender = false;

  $effect(() => {
    void app.pdfVersion;
    const path = app.pdfPath;
    if (path) void load(path);
    else {
      pages = [];
      doc = null;
    }
  });

  $effect(() => {
    localStorage.setItem("editex.darkPdf", darkPdf ? "1" : "0");
  });

  async function load(path: string) {
    const seq = ++loadSeq;
    try {
      const data = new Uint8Array(await api.readBinary(path));
      const task = pdfjs.getDocument({ data });
      const newDoc = await task.promise;
      if (seq !== loadSeq) {
        void task.destroy();
        return;
      }
      const sizes: PageSize[] = [];
      for (let i = 1; i <= newDoc.numPages; i++) {
        const v = (await newDoc.getPage(i)).getViewport({ scale: 1 });
        sizes.push({ w: v.width, h: v.height });
      }
      if (seq !== loadSeq) {
        void task.destroy();
        return;
      }
      const oldTask = docTask;
      doc = newDoc;
      docTask = task;
      docVersion++;
      error = null;
      // Los canvas antiguos se quedan visibles hasta que se pinta la versión nueva: sin parpadeo.
      pages = sizes;
      computeScale();
      await tick();
      scheduleRender();
      void oldTask?.destroy();
    } catch (e) {
      error = String(e);
    }
  }

  function computeScale() {
    if (!container || pages.length === 0) return;
    const maxW = Math.max(...pages.map((p) => p.w));
    scale = zoom === "fit" ? Math.max(0.2, (container.clientWidth - 32) / maxW) : zoom;
  }

  function scheduleRender() {
    if (rendering) {
      pendingRender = true;
      return;
    }
    void renderVisible();
  }

  async function renderVisible() {
    if (!doc || !container) return;
    rendering = true;
    const view = container.getBoundingClientRect();
    const margin = view.height;
    const key = `${docVersion}:${scale.toFixed(3)}`;
    const dpr = window.devicePixelRatio || 1;
    const visible: number[] = [];

    pageEls.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const distance = r.bottom < view.top ? view.top - r.bottom : r.top > view.bottom ? r.top - view.bottom : 0;
      if (distance <= margin) visible.push(i);
      else if (distance > margin * 4 && renderedKey.has(i)) {
        // Libera memoria de páginas lejanas.
        el.querySelector("canvas")?.remove();
        renderedKey.delete(i);
      }
      if (r.top <= view.top + view.height / 2 && r.bottom >= view.top + view.height / 2) currentPage = i + 1;
    });

    const thisDoc = doc;
    for (const i of visible) {
      if (renderedKey.get(i) === key || thisDoc !== doc) continue;
      try {
        const page = await thisDoc.getPage(i + 1);
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        if (thisDoc !== doc) break;
        const el = pageEls[i];
        el?.querySelector("canvas")?.remove();
        el?.prepend(canvas);
        renderedKey.set(i, key);
      } catch (e) {
        if (thisDoc === doc) console.warn("pdf render", e);
      }
    }
    rendering = false;
    if (pendingRender) {
      pendingRender = false;
      scheduleRender();
    }
  }

  function setZoom(z: number | "fit") {
    const ratio = container.scrollTop / Math.max(1, container.scrollHeight);
    zoom = z;
    computeScale();
    void tick().then(() => {
      container.scrollTop = ratio * container.scrollHeight;
      scheduleRender();
    });
  }

  function zoomBy(factor: number) {
    setZoom(Math.min(5, Math.max(0.25, scale * factor)));
  }

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  async function onPageClick(e: MouseEvent, index: number) {
    if (!(e.ctrlKey || e.metaKey) || !app.root || !app.pdfPath) return;
    const r = pageEls[index].getBoundingClientRect();
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    const loc = await api.synctexInverse(app.root, app.pdfPath, index + 1, x, y).catch(() => null);
    if (loc) await app.openFile(loc.file, loc.line);
    else app.notify("SyncTeX no encontró la posición en el código");
  }

  async function syncForward(line: number) {
    if (!app.root || !app.pdfPath || !app.active) return;
    const loc = await api.synctexForward(app.root, app.pdfPath, app.active, line).catch(() => null);
    if (!loc || !pageEls[loc.page - 1]) {
      app.notify("SyncTeX: no hay posición para esta línea (¿compilaste?)");
      return;
    }
    const el = pageEls[loc.page - 1];
    container.scrollTo({ top: el.offsetTop + loc.y * scale - container.clientHeight / 3, behavior: "smooth" });
    highlight = { page: loc.page, x: loc.x, y: loc.y, w: Math.max(loc.width, 40), h: Math.max(loc.height, 10) };
    setTimeout(() => (highlight = null), 1600);
  }

  onMount(() => {
    app.syncForward = (line) => void syncForward(line);
    // rAF: cambiar el tamaño de las páginas dentro del callback provoca un bucle de ResizeObserver.
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        if (zoom === "fit") {
          computeScale();
          scheduleRender();
        }
      }),
    );
    ro.observe(container);
    return () => {
      ro.disconnect();
      app.syncForward = null;
    };
  });
</script>

<div class="viewer">
  <div class="bar">
    <span class="pages">{pages.length ? `${currentPage} / ${pages.length}` : "—"}</span>
    <div class="spacer"></div>
    <button class="icon" title="Alejar" onclick={() => zoomBy(1 / 1.15)}>−</button>
    <button class="zoom" title="Ajustar al ancho" onclick={() => setZoom("fit")}>
      {zoom === "fit" ? "Ajustar" : `${Math.round(scale * 100)}%`}
    </button>
    <button class="icon" title="Acercar" onclick={() => zoomBy(1.15)}>+</button>
    <button class="icon" class:on={darkPdf} title="PDF en modo oscuro" onclick={() => (darkPdf = !darkPdf)}>◐</button>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroll" class:dark={darkPdf} bind:this={container} onscroll={scheduleRender} onwheel={onWheel}>
    {#if error}
      <p class="empty">No se pudo abrir el PDF: {error}</p>
    {:else if pages.length === 0}
      <p class="empty">{app.compiling ? "Compilando…" : "Compila (Ctrl+Enter) para ver el PDF"}</p>
    {/if}
    {#each pages as p, i (i)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="page"
        bind:this={pageEls[i]}
        style="width:{p.w * scale}px;height:{p.h * scale}px"
        onclick={(e) => onPageClick(e, i)}
      >
        {#if highlight && highlight.page === i + 1}
          <div
            class="hl"
            style="left:{highlight.x * scale - 4}px;top:{highlight.y * scale - 4}px;width:{highlight.w * scale + 8}px;height:{highlight.h * scale + 8}px"
          ></div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-pdf);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 36px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    font-size: 12px;
    color: var(--text-muted);
  }
  .spacer {
    flex: 1;
  }
  .pages {
    font-variant-numeric: tabular-nums;
  }
  .zoom {
    min-width: 64px;
    font-variant-numeric: tabular-nums;
  }
  .scroll {
    flex: 1;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .page {
    position: relative;
    flex: none;
    background: white;
    box-shadow: var(--page-shadow);
    border-radius: 2px;
  }
  .page :global(canvas) {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 2px;
  }
  .dark .page {
    filter: invert(0.88) hue-rotate(180deg);
  }
  .hl {
    position: absolute;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    outline: 2px solid var(--accent);
    animation: fade 1.6s ease-out forwards;
    pointer-events: none;
  }
  @keyframes fade {
    0%,
    60% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .empty {
    margin-top: 30%;
    color: var(--text-muted);
    font-size: 14px;
  }
</style>

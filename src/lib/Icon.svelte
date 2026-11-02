<script lang="ts" module>
  // Iconos de trazo (24×24, currentColor). Pocos y propios: no merece la pena una dependencia.
  const FILE = ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"];
  const FILE_TEXT = [...FILE, "M16 13H8", "M16 17H8"];
  const FOLDER = "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z";
  const EYE = ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0"];

  const PATHS = {
    sidebar: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18"],
    alert: ["M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z", "M12 9v4", "M12 17h.01"],
    pdf: FILE_TEXT,
    file: FILE,
    fileText: FILE_TEXT,
    folder: [FOLDER],
    folderPlus: [FOLDER, "M12 10v6", "M9 13h6"],
    chevron: ["M9 6l6 6-6 6"],
    plus: ["M12 5v14", "M5 12h14"],
    image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M11 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0", "M21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21"],
    book: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"],
    star: ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"],
    eye: EYE,
    eyeOff: [...EYE, "M3 3l18 18"],
    check: ["M20 6L9 17l-5-5"],
    x: ["M18 6L6 18", "M6 6l12 12"],
    circle: ["M20 12a8 8 0 1 1-16 0 8 8 0 1 1 16 0"],
    circleDot: ["M20 12a8 8 0 1 1-16 0 8 8 0 1 1 16 0", "M12.5 12a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0"],
    arrowUp: ["M12 19V5", "M5 12l7-7 7 7"],
    arrowRight: ["M5 12h14", "M12 5l7 7-7 7"],
    stop: ["M7 7h10v10H7z"],
    power: ["M12 2v10", "M18.4 6.6a9 9 0 1 1-12.77.04"],
    pencil: ["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"],
    trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
    search: ["M19 11a8 8 0 1 1-16 0 8 8 0 1 1 16 0", "M21 21l-4.3-4.3"],
    terminal: ["M4 17l6-6-6-6", "M12 19h8"],
    globe: ["M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"],
    swap: ["M16 3l4 4-4 4", "M20 7H4", "M8 21l-4-4 4-4", "M4 17h16"],
    hash: ["M4 9h16", "M4 15h16", "M10 3L8 21", "M16 3l-2 18"],
    code: ["M16 18l6-6-6-6", "M8 6l-6 6 6 6"],
    command: ["M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"],
    sparkle: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 17v4", "M17 19h4"],
    sun: [
      "M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0",
      "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
    ],
    moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"],
    monitor: ["M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4"],
    sliders: ["M20 7h-9", "M14 17H5", "M20 17a3 3 0 1 1-6 0 3 3 0 1 1 6 0", "M10 7a3 3 0 1 1-6 0 3 3 0 1 1 6 0"],
    play: ["M7 4l13 8-13 8z"],
    rebuild: [
      "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
      "M21 3v5h-5",
      "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
      "M8 16H3v5",
    ],
  } satisfies Record<string, string[]>;

  /** Iconos rellenos (el resto son solo trazo). */
  const FILLED = new Set<string>(["play", "star", "stop"]);

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
  const filled = $derived(FILLED.has(name));
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each PATHS[name] as d (d)}<path {d} />{/each}
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>

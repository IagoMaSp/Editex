// Tema de la app: claro, oscuro o el del sistema. Se aplica como `data-theme` en <html>.
export type ThemePref = "system" | "light" | "dark";

const KEY = "editex.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

class Theme {
  pref = $state<ThemePref>((localStorage.getItem(KEY) as ThemePref) || "system");
  private systemDark = $state(media.matches);
  resolved = $derived<"light" | "dark">(this.pref === "system" ? (this.systemDark ? "dark" : "light") : this.pref);

  constructor() {
    media.addEventListener("change", (e) => (this.systemDark = e.matches));
    $effect.root(() => {
      $effect(() => {
        document.documentElement.dataset.theme = this.resolved;
      });
    });
  }

  /** Sistema → claro → oscuro → sistema. */
  cycle() {
    const order: ThemePref[] = ["system", "light", "dark"];
    this.pref = order[(order.indexOf(this.pref) + 1) % order.length];
    localStorage.setItem(KEY, this.pref);
  }

  get label() {
    return { system: "Tema: sistema", light: "Tema: claro", dark: "Tema: oscuro" }[this.pref];
  }

  get icon() {
    return { system: "◑", light: "☀", dark: "☾" }[this.pref];
  }
}

export const theme = new Theme();

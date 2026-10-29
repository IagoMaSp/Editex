import { mount } from "svelte";
import "./app.css";
import "./lib/theme.svelte";
import App from "./App.svelte";

if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) await import("./dev/mock");

export default mount(App, { target: document.getElementById("app")! });

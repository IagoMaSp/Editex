# Binarios externos

En Windows y macOS la app incluye **texlab** (autocompletado). Tauri espera aquí
`texlab-<target-triple>[.exe]`, p. ej. `texlab-aarch64-apple-darwin` o
`texlab-x86_64-pc-windows-msvc.exe`. El workflow de GitHub (`.github/workflows/build.yml`)
los descarga antes de compilar; para compilar a mano en esos sistemas:

```bash
scripts/fetch-texlab.sh            # detecta el target con `rustc -vV`
```

En Linux no se incluye: se usa el texlab del sistema (`pacman -S texlab`).
Los binarios descargados no se guardan en git.

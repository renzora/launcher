# Renzora Launcher

Desktop launcher for the Renzora platform. Manage engine versions, browse the game store and marketplace, download games and assets, and keep everything up to date.

Built with [WebArcade](https://github.com/warcade/cli) — a lightweight desktop app framework using SolidJS + native WebView + Rust plugins.

## Features

- **Renzora Engine** — Download, install, launch, and manage engine versions with OS-specific builds and export templates
- **Game Store** — Browse, purchase, and download games built with Renzora Engine
- **Marketplace** — Browse community assets, plugins, and templates from renzora.com
- **Library** — View and download your purchased games and assets
- **Account** — Sign in / register with your renzora.com account
- **Self-Updater** — Automatic update checks from GitHub releases
- **Cross-Platform** — Windows, macOS, and Linux via native WebView

## Prerequisites

- [Rust](https://rustup.rs/) (1.85+)
- [Bun](https://bun.sh/) or Node.js
- [WebArcade CLI](https://github.com/warcade/cli)

```bash
# Install WebArcade CLI
cargo install webarcade
```

### Linux only

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
```

## Build & Run

```bash
# Install frontend dependencies
bun install

# Run in dev mode (builds frontend + starts app)
webarcade dev
```

Plugins (DLLs) are prebuilt and included in the repo. To rebuild them after making changes:

```bash
webarcade build launcher
webarcade build updater
```

## Production Build

```bash
# Build optimized frontend + app
bun run build
cd app && cargo build --release
```

The binary will be at `app/target/release/renzora-launcher` (or `.exe` on Windows).

## Project Structure

```
├── app/                     # WebArcade desktop app (Rust/WebView)
│   ├── src/                 # Rust source (main, bridge server, IPC)
│   ├── plugins/             # Compiled plugin DLLs + JS (build output)
│   └── scripts/             # Build and dev scripts
├── plugins/
│   ├── launcher/            # Main launcher plugin
│   │   ├── index.jsx        # Plugin entry + login modal
│   │   ├── router.rs        # Rust backend (GitHub API, downloads, auth)
│   │   ├── EnginePage.jsx   # Engine version manager
│   │   ├── StorePage.jsx    # Game store (renzora.com/api/games)
│   │   ├── MarketplacePage.jsx  # Asset marketplace (renzora.com/api/marketplace)
│   │   ├── LibraryPage.jsx  # User's purchased content
│   │   ├── HomePage.jsx     # Landing page
│   │   ├── SettingsPage.jsx # Settings + account
│   │   ├── Sidebar.jsx      # Navigation sidebar
│   │   └── theme.jsx        # Custom Renzora theme
│   ├── updater/             # Self-update plugin (DLL)
│   └── themes/              # DaisyUI theme system
├── .github/workflows/       # CI/CD for Windows, macOS, Linux
└── webarcade.config.json    # App configuration + plugin registry
```

## Releases

Releases are built automatically via GitHub Actions when a version tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This creates binaries for Windows (x64), macOS (ARM64 + x64), and Linux (x64).

## License

MIT — see [LICENSE](LICENSE)

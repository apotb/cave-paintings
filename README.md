# Cave Paintings

Phaser survival game. Pixel-art world, RimWorld-style body simulation (injuries, hunger, food poisoning). Singleplayer runs entirely in the browser. Multiplayer is a Node world server; your character stays on your machine.

## Client

```bash
npm run client
```

Open http://127.0.0.1:21825

- **Singleplayer** — character, then a world. Worlds live in IndexedDB.
- **Multiplayer** — character, then a server address (`host:port`). Default is `127.0.0.1:21826`.

Characters (look, inventory, body) are stored in the browser. Export/import them from the menu. The world server does not keep your gear after you leave.

If the client is served over HTTPS, joins use `wss://`. Bare `host:port` becomes `wss://host:port`, so the server needs TLS or a tunnel. HTTP clients can use plain `ws://`.

## Standalone app

```bash
npm install
npm run app
```

Opens a native window (same Phaser client). Player data lives in a `save` folder:

- macOS: `~/Library/Application Support/Cave Paintings/save/`
- Windows: `%APPDATA%\Cave Paintings\save\`
- Linux: `~/.config/Cave Paintings/save/`

`characters/<id>.json`, `worlds/<id>.json`, and `options.json` (GUI scale, music, fullscreen). Options → **Open save folder**.

Browser IndexedDB is separate. Move a save with Export in Chrome and Import in the app (or the other way).

Packaged builds (unsigned — macOS Gatekeeper: right-click → Open):

```bash
npm run build        # macOS + Windows + Linux
npm run build:mac
npm run build:win
npm run build:linux
```

Needs `build/icon.png` (1024×1024). Output is `out/`. On Apple Silicon, `build:mac` is arm64. `build:win` is Windows x64 (zip + installer). `build:linux` is Linux x64 (AppImage + tar.gz). Delete `out/` (or the leftover `dist/`) and run the command again to rebuild from scratch.

GitHub Actions also builds these. Tests run on every push (the green check next to Vercel). Electron packages build when you push a tag like `v0.1.1`, or from **Actions → Electron → Run workflow**. Download the artifacts from the run, or from the GitHub Release on a tag. Builds stay unsigned.

## Server

```bash
npm install
npm start
```

Console asks for a world (`n` = new, `1`–`9` = existing). Banner prints a LAN join address. Saves go in `saves/<world>/`.

```bash
npm start --world world
npm start --world 1
node server/index.js --world MyWorld --port 21826
```

Flags, TLS, console commands: [server/README.md](server/README.md).

### Ngrok

```bash
cp ngrok.env.example ngrok.env   # set NGROK_URL
./run-ngrok.sh                   # Windows: run-ngrok.bat
```

`ngrok.env` is gitignored.

## Controls

Hover **?** in the corner for the full list.

```
WASD / arrows   Move
Shift           Sprint
Mouse           Aim
Space           Use held item / place / attack
R / Shift+R     Rotate placement
Left-click      Pick up / interact
F               Pick up nearby drops
Q               Drop (Shift = stack, Ctrl = 10)
1–0             Hotbar
C / E / H       Craft / equipment / health
T               Chat  (/ opens a command)
Esc             Pause / menu
```

Right-click moves 1 item between slots; Shift+right-click the stack, Ctrl+right-click half.

Chat commands: `/help`

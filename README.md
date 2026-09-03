# Cave Paintings

Pixel-art survival game (Phaser). RimWorld-style body simulation: injuries, hunger, food poisoning. Play in the browser or as a standalone app.

Singleplayer is local. Multiplayer is a Node world server; your character stays on your machine.

```bash
npm install
```

## Browser

```bash
npm run client
```

Open http://127.0.0.1:21825

- **Singleplayer** — pick a character, then a world.
- **Multiplayer** — pick a character, then a server (`host:port`). Default is `127.0.0.1:21826`.

In the browser, characters and worlds live in IndexedDB. Export / import from the menu. The world server does not keep your gear after you leave.

If the page is HTTPS (for example Vercel), joins use `wss://`. A bare `host:port` becomes `wss://host:port`, so the server needs TLS or a tunnel. HTTP pages can use plain `ws://`.

## Standalone app

Same Phaser client in a native window. File saves instead of IndexedDB.

```bash
npm run app
```

Saves:

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/Cave Paintings/save/` |
| Windows | `%APPDATA%\Cave Paintings\save\` |
| Linux | `~/.config/Cave Paintings/save/` |

```
characters/<id>.json
worlds/<id>.json
options.json          # GUI scale, music volume, fullscreen
```

Title-screen Options → **Open save folder**. Fullscreen is Electron-only (also F11). Browser IndexedDB is separate; move a save with Export / Import.

### Packaged builds

Unsigned. On macOS, right-click → Open the first time (Gatekeeper).

```bash
npm run build          # macOS + Windows + Linux
npm run build:mac      # Apple Silicon .dmg + zip
npm run build:win      # Windows x64 installer + zip
npm run build:linux    # Linux x64 AppImage + tar.gz
```

Needs `build/icon.png` (1024×1024). Output is `out/`. Delete `out/` and run again to rebuild from scratch.

Ship these files:

| Platform | File |
| --- | --- |
| Mac | `Cave Paintings-<version>-arm64.dmg` |
| Windows | `Cave Paintings Setup <version>.exe` |
| Linux | `Cave Paintings-<version>.AppImage` |

Zips / `.tar.gz` are optional no-installer copies. Do not ship `.blockmap`, `latest*.yml`, or `*-unpacked/` folders.

### GitHub Actions

- **CI** — `npm test` on every push / PR (status check).
- **Electron** — Mac, Windows, and Linux packages when you push a `v*` tag, or **Actions → Electron → Run workflow**. A tag also makes a GitHub Release.

### Vercel

The browser client is already static files (`index.html`, `js/`, `assets/`, …). Vercel hosts those as-is. It must not run `npm run build` — that script packages the Electron app.

In the Vercel project: Framework **Other**. Leave **Build Command**, **Install Command**, and **Output Directory** overrides **off** so `vercel.json` applies (empty build, output `.`).

```bash
npm version 0.1.1      # bumps package.json and tags
git push --follow-tags
```

`package.json` `"version"` is what installers use. Stay on `0.1.0` until you actually ship a numbered drop.

## Server

```bash
npm start
```

Console asks for a world (`n` = new, `1`–`9` = existing). Banner prints a LAN join address. World data is `saves/<world>/`.

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

Hover **?** in the corner for the in-game list.

```
WASD / arrows     Move
Shift             Sprint
Mouse             Aim
Space             Use held item / place / attack
R / Shift+R       Rotate placement
Left-click        Pick up / interact
F                 Pick up nearby drops
Q                 Drop (Shift = stack, Ctrl = 10)
1–9               Hotbar
C / E / H         Craft / equipment / health
. / ,             Next / previous party member
Ctrl+1–6          Select party member
T                 Chat  (/ opens a command)
Esc               Pause / menu
```

Right-click moves 1 item between slots; Shift+right-click the stack, Ctrl+right-click half.

Chat commands: `/help`

## Tests

```bash
npm test
```

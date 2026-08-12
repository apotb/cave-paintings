# Cave Paintings

Play at the **game website** (static client). Singleplayer runs in the browser. Multiplayer joins a friend’s **dedicated world server**.

## Play

Open the hosted game (or serve the repo locally for development):

```powershell
npx --yes serve -l 21825
```

Then open http://127.0.0.1:21825

- **Singleplayer** — character → world (IndexedDB). No dedicated server.
- **Multiplayer** — enter a server address → Connect → pick character → join.

Characters are client-owned (browser IndexedDB + export files). Leaving a multiplayer session saves your character locally; the world server does not keep your gear.

### Joining from HTTPS

If the game page is **HTTPS**, the browser only allows **`wss://`**. Bare `host:port` is treated as `wss://host:port`. The host must enable TLS on the dedicated server (`tls-cert` / `tls-key`) or expose a tunnel (ngrok, etc.). Port-forward alone with plain `ws://` will not work from an HTTPS site.

## Host a multiplayer world

On the machine that runs the shared world:

```powershell
npm install
npm start
```

Pick or create a world in the console. Friends open the **game website** → Multiplayer → paste your join address (shown in the server banner), not your PC’s webpage.

- Optional password: console `password <pw>` or `server.properties`
- Port-forward / tunnel is your responsibility (same idea as Minecraft / Terraria)
- Details: [server/README.md](server/README.md)

Console: `save`, `list`, `kick <name>`, `password <pw>`, `stop`

Saves: `saves/<world>/world.json` + `server.properties` (session pawns only; no durable player gear files).

## Ngrok (example tunnel for WSS)

```powershell
copy ngrok.env.example ngrok.env
# edit ngrok.env — set NGROK_URL to your reserved domain
.\run-ngrok.bat
```

`ngrok.env` is gitignored; only `ngrok.env.example` is committed.

## In-game (net)

WASD, Shift sprint, Space eat/attack, E pickup, Q drop, Enter chat, `/heal` `/give apple 5`

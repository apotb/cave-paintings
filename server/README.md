# Cave Paintings — Dedicated world server

Hosts a shared multiplayer world. Players open the **public game client** (website), choose Multiplayer, and paste your join address. This process does **not** serve the full game UI by default.

## Quick start

```bash
npm install
npm start
```

Without `--world`, the console asks: `n` = new world, `1`–`9` = existing (max 9).

```bash
node server/index.js --world MyWorld --port 21826
```

Banner prints something like `192.168.x.x:21826` (LAN IPv4) — paste that in Multiplayer. Same-machine clients can still use `127.0.0.1`.

## Flags

| Flag | Effect |
| --- | --- |
| `--world <name>` | Skip world picker |
| `--port <n>` | Override `server.properties` port |
| `--serve-client` | Serve the local Phaser UI (dev/LAN only). Prefer the public game URL. |
| `--tls-cert <path>` | Enable HTTPS + WSS (with `--tls-key`) |
| `--tls-key <path>` | Private key for TLS |

Paths may be absolute or relative to the repo root. You can also set `tls-cert` / `tls-key` in `server.properties`.

## HTTPS game site → need WSS

Browsers block `ws://` from an **HTTPS** page. Options:

1. Set `tls-cert` + `tls-key` (real cert for your domain), port-forward, friends join `wss://your.domain:21826` (or bare `host:port` on the HTTPS site, which becomes `wss://`).
2. Run a tunnel (ngrok, Cloudflare, etc.) that gives a `wss://` URL and forward it to local `ws://127.0.0.1:21826`.

Plain LAN `ws://192.168.x.x:21826` only works when the **game page itself** is HTTP (e.g. local `serve`).

## Status endpoint

Default (no `--serve-client`): `GET /` or `/status` returns JSON (`world`, `protocol`, `tls`, player counts).

## Console commands

| Command | Effect |
| --- | --- |
| `save` | Write world to disk |
| `list` | Show connected players |
| `time` | Print world day and clock |
| `say <msg>` | Broadcast chat as `<Server>` |
| `kick <name>` | Disconnect a player |
| `password <pw>` | Set/clear join password for this session only (empty clears) |
| `stop` | Save and exit |

Autosave every N minutes (`autosave-minutes` in `server.properties`).

## Saves

```
saves/<world>/
  world.json
  server.properties
```

Characters / inventory are **client-owned**. The server keeps ephemeral session pawns while someone is online; it does not treat `players/*.json` as the source of truth.

## In-game (joined clients)

- WASD move, Shift sprint
- Space: eat if holding food, else melee toward cursor
- E / F pickup, Q drop
- Hotbar, Enter chat
- Slash commands for testing: `/heal`, `/give apple 5`, `/tp x y`, `/kill`

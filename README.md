# Cave Paintings

Phaser 3 client, shared sim, Node WebSocket world server. Optional Electron shell.

Code is MIT. Art and audio in `assets/` are all rights reserved — you can run the game, not reuse the sprites or music. See [LICENSE](LICENSE). Third-party audio and code: [CREDITS.md](CREDITS.md).

## Run

```bash
npm install
npm run client      # browser, http://127.0.0.1:21825
npm run app         # Electron
npm start           # dedicated server, default port 21826
npm test
npm run build       # installers → out/
npm run build:mac
npm run build:win
npm run build:linux
```

Server flags, TLS, console commands: [server/README.md](server/README.md).

## Layout

```
js/        Phaser 3 client
shared/    Phaser-free sim (SP host + dedicated server)
server/    Node/ws world host
data/      JSON defs
electron/  native shell
test/      node:test
```

`SimWorld` is the authority. Singleplayer runs it in-process via `LocalSim`; multiplayer runs it on the dedicated server. The client sends input; the sim sends chunks and snapshots. Characters persist on the client; the world persists on whoever is hosting.

## Saves

Characters are client-owned. The world server does not keep your gear after you leave.

Browser saves live in IndexedDB. Electron writes to a `save/` folder under the OS user-data directory (Options → Open save folder). Singleplayer worlds stay with the client; multiplayer worlds are `saves/<world>/` on the server. Export / import moves saves between browser and app.

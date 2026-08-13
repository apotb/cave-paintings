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

## Server

```bash
npm install
npm start
```

Console asks for a world (`n` = new, `1`–`9` = existing). Banner prints a LAN join address. Saves go in `saves/<world>/`.

```bash
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
Space           Use held item / attack
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

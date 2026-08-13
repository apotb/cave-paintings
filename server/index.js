/**
 * Cave Paintings dedicated world server — WebSocket sim (+ optional TLS).
 * Does not host the game UI by default; players open the public client site and join.
 * Usage: node server/index.js [--world name|1-9] [--port 21826] [--serve-client]
 *        [--tls-cert path] [--tls-key path]
 * Without --world, prompts: n = new, 1–9 = existing (max 9 worlds).
 * `npm start --world world` works (npm puts the name in npm_config_world).
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { WebSocketServer } = require("ws");
const Protocol = require("../shared/protocol");
const { uuid } = require("../shared/rng");
const SaveIO = require("./SaveIO");
const { SimWorld, chunkKey, worldToChunk } = require("./SimWorld");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
    const out = {
        world: null,
        port: null,
        serveClient: false,
        tlsCert: null,
        tlsKey: null
    };
    const positional = [];
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--world" && argv[i + 1]) out.world = argv[++i];
        else if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]);
        else if (a === "--serve-client") out.serveClient = true;
        else if (a === "--tls-cert" && argv[i + 1]) out.tlsCert = argv[++i];
        else if (a === "--tls-key" && argv[i + 1]) out.tlsKey = argv[++i];
        else if (!a.startsWith("-")) positional.push(a);
    }
    // `npm start --world NAME` does not put --world on argv; npm sets this env.
    const npmWorld = process.env.npm_config_world;
    if (!out.world && npmWorld && npmWorld !== "true") out.world = npmWorld;
    if (!out.world && positional[0]) out.world = positional[0];
    return out;
}

/** `--world 1` / picker index → existing save name; otherwise a sanitized folder name. */
function resolveWorldArg(raw) {
    const s = String(raw || "").trim();
    if (/^[1-9]$/.test(s)) {
        const worlds = SaveIO.listWorlds(ROOT);
        const w = worlds[Number(s) - 1];
        if (!w) {
            console.error(`No world in slot [${s}].`);
            process.exit(1);
        }
        return w.name;
    }
    const safe = SaveIO.sanitizeWorldName(s);
    if (!safe) {
        console.error(`Invalid --world name "${raw}"`);
        process.exit(1);
    }
    return safe;
}

/** First non-internal IPv4 (LAN). Falls back to 127.0.0.1. */
function lanIPv4() {
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
        for (const a of addrs || []) {
            const v4 = a.family === "IPv4" || a.family === 4;
            if (!v4 || a.internal) continue;
            const ip = String(a.address || "");
            if (!ip || ip.startsWith("169.254.")) continue;
            return ip;
        }
    }
    return "127.0.0.1";
}

function resolveMaybePath(p) {
    if (!p || !String(p).trim()) return null;
    const s = String(p).trim();
    return path.isAbsolute(s) ? s : path.resolve(ROOT, s);
}

function contentType(file) {
    const ext = path.extname(file).toLowerCase();
    return (
        {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".txt": "text/plain; charset=utf-8",
            ".wasm": "application/wasm"
        }[ext] || "application/octet-stream"
    );
}

function safeJoin(root, reqPath) {
    const decoded = decodeURIComponent((reqPath || "/").split("?")[0]);
    const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(root, cleaned === path.sep ? "" : cleaned);
    if (!full.startsWith(root)) return null;
    return full;
}

class GameServer {
    static IDLE_PAUSE_MS = 60 * 1000;

    constructor({ worldName, props }) {
        this.worldName = worldName;
        this.props = props;
        this.sim = SimWorld.loadOrCreate({
            root: ROOT,
            worldName,
            props
        });
        /** @type {Map<import('ws').WebSocket, { playerId: string, authed: boolean, knownChunks: Set<string>, lastMoveMs: number }>} */
        this.clients = new Map();
        this.playerSockets = new Map(); // playerId -> ws
        this._snapAcc = 0;
        this._autoAcc = 0;
        this._running = true;
        this._idleEmptyMs = 0;
        this._idlePaused = false;
    }

    send(ws, type, payload) {
        if (ws.readyState === 1) ws.send(Protocol.encode(type, payload));
    }

    broadcast(type, payload, exceptId = null) {
        for (const [ws, meta] of this.clients) {
            if (!meta.authed) continue;
            if (exceptId && meta.playerId === exceptId) continue;
            this.send(ws, type, payload);
        }
    }

    onConnection(ws) {
        this.clients.set(ws, {
            playerId: null,
            authed: false,
            knownChunks: new Set(),
            lastMoveMs: 0
        });
        ws.on("message", (data) => this.onMessage(ws, data));
        ws.on("close", () => this.onClose(ws));
        ws.on("error", () => this.onClose(ws));
    }

    onClose(ws) {
        const meta = this.clients.get(ws);
        if (!meta) return;
        this.clients.delete(ws);
        if (meta.authed && meta.playerId) {
            const leaving = this.sim.players.get(meta.playerId);
            const name = leaving?.name || meta.playerId;
            this.playerSockets.delete(meta.playerId);
            const finalYou = this.sim.removePlayer(meta.playerId, { save: false });
            if (finalYou) {
                try {
                    this.send(ws, Protocol.Types.SESSION_END, {
                        reason: "disconnect",
                        you: finalYou
                    });
                } catch (_) {}
            }
            this.broadcast(Protocol.Types.EVENT, {
                kind: "player_left",
                playerId: meta.playerId
            });
            const max = Number(this.props["max-players"]) || 8;
            console.log(`[-] ${name} (${meta.playerId.slice(0, 8)}…) offline (${this.playerSockets.size}/${max})`);
        }
    }

    onMessage(ws, raw) {
        const msg = Protocol.parse(raw.toString());
        if (!msg) return;
        const meta = this.clients.get(ws);
        if (!meta) return;

        if (msg.type === Protocol.Types.AUTH) {
            this.handleAuth(ws, meta, msg.payload || {});
            return;
        }
        if (!meta.authed) return;

        if (msg.type === Protocol.Types.PING) {
            this.send(ws, Protocol.Types.PONG, { t: msg.payload?.t });
            return;
        }
        if (msg.type === Protocol.Types.INPUT_MOVE) {
            const now = Date.now();
            if (now - meta.lastMoveMs < 1000 / Protocol.MOVE_HZ - 2) return;
            meta.lastMoveMs = now;
            this.sim.setMove(meta.playerId, msg.payload || {});
            return;
        }
        if (msg.type === Protocol.Types.INPUT_ACTION) {
            const action = msg.payload || {};
            if (action.type === Protocol.Actions.RESYNC) {
                meta.knownChunks = new Set();
                this.syncChunks(ws, meta, true);
                this.flushYou(meta.playerId);
                return;
            }
            this.sim.handleAction(meta.playerId, action);
            // Flush private you + targeted events soon
            this.flushYou(meta.playerId);
            this.flushEvents();
        }
    }

    handleAuth(ws, meta, payload) {
        const max = Number(this.props["max-players"]) || Protocol.MAX_PLAYERS;
        if (this.playerSockets.size >= max) {
            this.send(ws, Protocol.Types.REJECT, { reason: "Server full." });
            ws.close();
            return;
        }
        const password = String(this.props.password || "");
        if (password) {
            const provided = String(payload.password || "");
            if (!provided) {
                this.send(ws, Protocol.Types.REJECT, { reason: "Password required." });
                ws.close();
                return;
            }
            if (provided !== password) {
                this.send(ws, Protocol.Types.REJECT, { reason: "Bad password." });
                ws.close();
                return;
            }
        }
        if (Number(payload.protocol) !== Protocol.PROTOCOL_VERSION) {
            this.send(ws, Protocol.Types.REJECT, {
                reason: `Protocol mismatch (server v${Protocol.PROTOCOL_VERSION}).`
            });
            ws.close();
            return;
        }
        let playerId = String(payload.characterId || payload.playerId || "").slice(0, 64);
        if (!playerId || playerId.length < 8) playerId = uuid();
        // Already connected?
        if (this.playerSockets.has(playerId)) {
            try {
                this.playerSockets.get(playerId).close();
            } catch (_) {}
        }
        const character = payload.character && typeof payload.character === "object"
            ? payload.character
            : null;
        const name = String(
            character?.name || payload.displayName || "Player"
        ).slice(0, 24) || "Player";
        const pawn = this.sim.addPlayer(playerId, name, character);
        meta.playerId = playerId;
        meta.authed = true;
        meta.knownChunks = new Set();
        this.playerSockets.set(playerId, ws);

        this.send(ws, Protocol.Types.WELCOME, {
            playerId,
            characterId: playerId,
            seed: this.sim.seed,
            worldName: this.worldName,
            clock: { gameDay: this.sim.gameDay, gameMinutes: this.sim.gameMinutes, tickSpeed: this.sim.tickSpeed },
            spawn: this.sim.spawn,
            motd: this.props.motd || "",
            you: this.sim.youPayload(playerId)
        });
        this.syncChunks(ws, meta, true);
        this.send(ws, Protocol.Types.YOU, this.sim.youPayload(playerId));
        this.broadcast(
            Protocol.Types.EVENT,
            { kind: "player_joined", playerId, name: pawn.name },
            playerId
        );
        console.log(`[+] ${pawn.name} (${playerId.slice(0, 8)}…) online (${this.playerSockets.size}/${max})`);
        this._resumeIdle();
    }

    syncChunks(ws, meta, force = false) {
        const p = this.sim.players.get(meta.playerId);
        if (!p) return;
        const keys = this.sim.interestChunkKeys(p.x, p.y, this.sim.interestRadius(p));
        for (const key of keys) {
            if (!force && meta.knownChunks.has(key)) continue;
            meta.knownChunks.add(key);
            const [cx, cy] = key.split(",").map(Number);
            this.send(ws, Protocol.Types.CHUNK, this.sim.chunkPayload(cx, cy));
        }
    }

    flushYou(playerId) {
        const ws = this.playerSockets.get(playerId);
        if (!ws) return;
        const you = this.sim.youPayload(playerId);
        if (you) this.send(ws, Protocol.Types.YOU, you);
    }

    flushEvents() {
        const events = this.sim.drainEvents();
        let worldRegen = false;
        for (const ev of events) {
            if (ev.kind === "world_regen") worldRegen = true;
            // Admin console: echo leftover system chat that wasn't announceCmd'd
            // (join/leave excluded — those use [+]/[-]). announceCmd already printed.
            if (ev.kind === "chat" && ev.system && ev.text && !ev.cmd) {
                const text = String(ev.text);
                if (!/\s(?:joined|left)\.$/.test(text)) {
                    const toName = ev.to
                        ? (this.sim.players.get(ev.to)?.name || String(ev.to).slice(0, 8))
                        : null;
                    if (toName) console.log(`[sys → ${toName}] ${text}`);
                    else console.log(`[sys] ${text}`);
                }
            }
            if (ev.to) {
                const ws = this.playerSockets.get(ev.to);
                if (ws) this.send(ws, Protocol.Types.EVENT, ev);
            } else {
                this.broadcast(Protocol.Types.EVENT, ev, ev.except || null);
            }
        }
        for (const id of this.sim.drainYouDirty()) this.flushYou(id);
        if (worldRegen) {
            for (const [ws, meta] of this.clients) {
                if (!meta.authed) continue;
                meta.knownChunks = new Set();
                this.syncChunks(ws, meta, true);
                this.flushYou(meta.playerId);
            }
        }
    }

    tick(dtMs) {
        if (!this._running) return;

        if (this.playerSockets.size === 0) {
            if (!this._idlePaused) {
                const speed = Number(this.sim.tickSpeed);
                const scaled = dtMs * (Number.isFinite(speed) && speed > 0 ? speed : 0);
                this._idleEmptyMs += scaled;
                if (this._idleEmptyMs >= GameServer.IDLE_PAUSE_MS) {
                    this._idlePaused = true;
                    this.save("idle");
                    console.log("Server paused due to inactivity for 60 ticks");
                }
            }
            if (this._idlePaused) return;
        } else if (this._idlePaused || this._idleEmptyMs > 0) {
            this._resumeIdle();
        }

        this.sim.tick(dtMs);
        this.flushEvents();

        this._snapAcc += dtMs;
        const snapEvery = 1000 / Protocol.SNAPSHOT_HZ;
        if (this._snapAcc >= snapEvery) {
            this._snapAcc %= snapEvery;
            for (const [ws, meta] of this.clients) {
                if (!meta.authed) continue;
                this.syncChunks(ws, meta, false);
                const snap = this.sim.snapshotFor(meta.playerId);
                if (snap) this.send(ws, Protocol.Types.SNAPSHOT, snap);
            }
        }

        const autoMin = Number(this.props["autosave-minutes"]) || 5;
        this._autoAcc += dtMs;
        if (this._autoAcc >= autoMin * 60 * 1000) {
            this._autoAcc = 0;
            this.save("autosave");
        }
    }

    save(reason = "manual") {
        this.sim.saveAll();
        if (reason === "autosave") {
            console.log(`[autosave] Saved ${this.worldName}`);
        } else if (reason === "idle") {
            console.log(`[idle] Saved ${this.worldName}`);
        } else {
            console.log(`[save] Saved ${this.worldName}`);
        }
    }

    _resumeIdle() {
        if (this._idlePaused) console.log("[idle] Resumed");
        this._idlePaused = false;
        this._idleEmptyMs = 0;
    }

    stop() {
        this._running = false;
        // Join password is session-only — never leave it on disk
        this.props.password = "";
        try {
            SaveIO.writeProperties(ROOT, this.worldName, this.props);
        } catch (_) {}
        // Flush online poses before closing sockets — process.exit often races
        // past ws "close" handlers, so logout-only pose saves never land.
        try {
            this.sim._flushOnlinePoses?.();
        } catch (_) {}
        this.save("shutdown");
        for (const ws of this.clients.keys()) {
            try {
                ws.close();
            } catch (_) {}
        }
    }

    listPlayers() {
        return [...this.sim.players.values()]
            .filter((p) => p.connected)
            .map((p) => p.name);
    }

    /** Day + clock string for the console `time` command. */
    formatClock() {
        const day = this.sim.gameDay || 1;
        const mins = ((this.sim.gameMinutes % 1440) + 1440) % 1440;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const tick = Number(this.sim.tickSpeed);
        const tickLabel = !Number.isFinite(tick) || tick <= 0 ? "paused" : `${tick}×`;
        return `Day ${day}  ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${tickLabel})`;
    }

    /** Current tick speed line for the console `tick` command. */
    formatTickSpeed() {
        const s = Number(this.sim.tickSpeed);
        if (!Number.isFinite(s) || s <= 0) return "Tick speed: paused (0)";
        return `Tick speed: ${s}×`;
    }

    /**
     * Set shared world tick speed (same as in-game /tick).
     * @param {number} speed  1 = normal, 60 ≈ 1 game hour/sec, 0 = pause
     * @returns {string|null} status line, or null if invalid
     */
    setTickSpeed(speed) {
        const m = Number(speed);
        if (!Number.isFinite(m) || m < 0) return null;
        this.sim.tickSpeed = m;
        this.sim._minuteAcc = 0;
        const text = `Server set tick speed to ${m}×.`;
        this.broadcast(Protocol.Types.EVENT, {
            kind: "chat",
            text,
            system: true
        });
        return this.formatTickSpeed();
    }

    /**
     * Set shared world clock (same as in-game /time HH [MM]).
     * @returns {string|null} status line, or null if invalid
     */
    setTime(hour, minute = 0) {
        const h = Number(hour);
        const m = minute != null && minute !== "" ? Number(minute) : 0;
        if (!Number.isFinite(h) || h < 0 || h > 23 || !Number.isFinite(m) || m < 0 || m > 59) {
            return null;
        }
        this.sim.gameMinutes = Math.floor(h) * 60 + Math.floor(m);
        this.sim._minuteAcc = 0;
        const label = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor(m)).padStart(2, "0")}`;
        this.broadcast(Protocol.Types.EVENT, {
            kind: "chat",
            text: `Server set the time to ${label}`,
            system: true
        });
        return this.formatClock();
    }

    /** Broadcast a chat line as <Server> … to all connected players. */
    say(text) {
        const msg = String(text || "").trim().slice(0, 200);
        if (!msg) return false;
        this.broadcast(Protocol.Types.EVENT, {
            kind: "chat",
            text: `<Server> ${msg}`
        });
        return true;
    }

    kick(name) {
        const lower = String(name || "").toLowerCase();
        for (const [id, p] of this.sim.players) {
            if (p.name.toLowerCase() !== lower) continue;
            const ws = this.playerSockets.get(id);
            if (ws) {
                const you = this.sim.youPayload(id);
                if (you) {
                    this.send(ws, Protocol.Types.SESSION_END, { reason: "kicked", you });
                }
                this.send(ws, Protocol.Types.REJECT, { reason: "Kicked." });
                ws.close();
            }
            return true;
        }
        return false;
    }
}

function main() {
    startServer().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

/** One key from stdin (TTY raw), or a line if not a TTY. */
function readKeyOrLine(prompt) {
    return new Promise((resolve, reject) => {
        if (!process.stdin.isTTY) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question(prompt, (ans) => {
                rl.close();
                resolve(String(ans || "").trim());
            });
            return;
        }
        process.stdout.write(prompt);
        const onData = (buf) => {
            const s = buf.toString("utf8");
            // Ctrl+C
            if (s === "\u0003") {
                cleanup();
                process.stdout.write("\n");
                reject(new Error("cancelled"));
                return;
            }
            // Esc
            if (s === "\u001b") {
                cleanup();
                process.stdout.write("\n");
                reject(new Error("cancelled"));
                return;
            }
            cleanup();
            const ch = s[0] || "";
            process.stdout.write(ch + "\n");
            resolve(ch);
        };
        const cleanup = () => {
            process.stdin.off("data", onData);
            try {
                process.stdin.setRawMode(false);
            } catch (_) {}
        };
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", onData);
    });
}

function askLine(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => {
            rl.close();
            resolve(String(ans || "").trim());
        });
    });
}

/** Wipe terminal for a clean picker / running banner (Terraria-style). */
function clearConsole() {
    // Windows consoles (cmd / PowerShell / many IDE hosts) often ignore ANSI alone.
    if (process.platform === "win32") {
        try {
            require("child_process").spawnSync(
                process.env.ComSpec || "cmd.exe",
                ["/c", "cls"],
                { stdio: "inherit", windowsHide: true }
            );
        } catch (_) {
            /* continue with ANSI */
        }
    }
    try {
        if (typeof console.clear === "function") console.clear();
    } catch (_) {}
    try {
        // RIS + erase screen + erase scrollback + home cursor
        process.stdout.write("\x1Bc\x1b[2J\x1b[3J\x1b[H");
    } catch (_) {}
}

/**
 * Interactive world pick: n = new, d = delete, 1–9 = existing.
 * Redraws a clean screen each pass (no piled-up history).
 * @returns {Promise<string>} world name
 */
async function chooseWorld() {
    SaveIO.ensureDir(path.join(ROOT, "saves"));
    let flash = "";

    for (;;) {
        const worlds = SaveIO.listWorlds(ROOT);
        clearConsole();
        console.log("========================================");
        console.log(" Cave Paintings Dedicated Server");
        console.log("========================================");
        console.log("  [n]  New world");
        console.log("  [d]  Delete world");
        if (!worlds.length) {
            console.log("  (no saved worlds yet)");
        } else {
            worlds.forEach((w, i) => {
                const mark = w.hasWorldJson ? "" : " (empty)";
                console.log(`  [${i + 1}]  ${w.name}${mark}`);
            });
        }
        if (flash) {
            console.log("");
            console.log(`  ${flash}`);
            flash = "";
        }
        console.log("========================================");

        let key;
        try {
            key = (await readKeyOrLine("")).toLowerCase();
        } catch {
            process.exit(0);
        }

        if (key === "n") {
            if (worlds.length >= SaveIO.MAX_WORLDS) {
                flash = `Already have ${SaveIO.MAX_WORLDS} worlds. Delete one with d.`;
                continue;
            }
            const def = SaveIO.nextDefaultWorldName(ROOT) || "world";
            const typed = await askLine(`New world name [${def}]: `);
            const name = SaveIO.sanitizeWorldName(typed || def);
            if (!name) {
                flash = "Invalid name. Letters, numbers, spaces, _ or - (max 32).";
                continue;
            }
            if (fs.existsSync(SaveIO.worldDir(ROOT, name))) {
                flash = `"${name}" already exists.`;
                continue;
            }
            try {
                const props = SaveIO.writeProperties(ROOT, name, {});
                const sim = SimWorld.createNew({ root: ROOT, worldName: name, props });
                SaveIO.saveWorld(ROOT, name, sim.toSaveData());
                flash = `Created "${name}".`;
            } catch (e) {
                flash = `Create failed: ${e.message || e}`;
            }
            continue;
        }

        if (key === "d") {
            if (!worlds.length) {
                flash = "No worlds to delete.";
                continue;
            }
            let slot;
            try {
                slot = (await readKeyOrLine("Delete which (1-9): ")).toLowerCase();
            } catch {
                continue;
            }
            if (!/^[1-9]$/.test(slot)) {
                flash = "Pick a number 1–9.";
                continue;
            }
            const idx = Number(slot) - 1;
            if (idx >= worlds.length) {
                flash = "No world in that slot.";
                continue;
            }
            const name = worlds[idx].name;
            const conf = (await askLine(`Delete "${name}"? (y/n): `)).toLowerCase();
            if (conf !== "y" && conf !== "yes") {
                flash = "Cancelled.";
                continue;
            }
            try {
                SaveIO.deleteWorld(ROOT, name);
                flash = `Deleted "${name}".`;
            } catch (e) {
                flash = `Delete failed: ${e.message || e}`;
            }
            continue;
        }

        if (/^[1-9]$/.test(key)) {
            const idx = Number(key) - 1;
            if (idx >= worlds.length) {
                flash = "No world in that slot.";
                continue;
            }
            return worlds[idx].name;
        }

        flash = "n = new, d = delete, 1–9 = load.";
    }
}

function sendStatus(res, game, useTls) {
    const body = JSON.stringify({
        name: "Cave Paintings dedicated server",
        world: game.worldName,
        protocol: Protocol.PROTOCOL_VERSION,
        tls: !!useTls,
        players: game.playerSockets.size,
        maxPlayers: Number(game.props["max-players"]) || 8,
        motd: game.props.motd || ""
    }, null, 2);
    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
}

function createRequestHandler(game, { serveClient, useTls }) {
    return (req, res) => {
        const raw = (req.url || "/").split("?")[0];
        if (!serveClient) {
            if (raw === "/" || raw === "/status" || raw === "/status.json") {
                sendStatus(res, game, useTls);
                return;
            }
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Dedicated world server — open the Cave Paintings game site to play.\n");
            return;
        }
        let reqPath = raw;
        if (reqPath === "/") reqPath = "/index.html";
        const file = safeJoin(ROOT, reqPath);
        if (!file) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }
        fs.readFile(file, (err, buf) => {
            if (err) {
                res.writeHead(404);
                res.end("Not found");
                return;
            }
            res.writeHead(200, { "Content-Type": contentType(file) });
            res.end(buf);
        });
    };
}

async function startServer() {
    clearConsole();
    const args = parseArgs(process.argv);
    SaveIO.ensureDir(path.join(ROOT, "saves"));

    let worldName = args.world;
    if (!worldName) {
        worldName = await chooseWorld();
    } else {
        worldName = resolveWorldArg(worldName);
    }

    clearConsole();
    console.log(`Loading world "${worldName}"…`);

    let props = SaveIO.readProperties(ROOT, worldName);
    // Join password is session-only (console `password`); never restore from disk
    props.password = "";
    if (args.port) props.port = args.port;
    if (args.tlsCert) props["tls-cert"] = args.tlsCert;
    if (args.tlsKey) props["tls-key"] = args.tlsKey;
    props = SaveIO.writeProperties(ROOT, worldName, props);
    const port = Number(props.port) || Protocol.DEFAULT_PORT;
    const serveClient = !!args.serveClient;

    const certPath = resolveMaybePath(props["tls-cert"]);
    const keyPath = resolveMaybePath(props["tls-key"]);
    let useTls = false;
    let tlsOpts = null;
    if (certPath || keyPath) {
        if (!certPath || !keyPath) {
            console.error("Both tls-cert and tls-key are required for HTTPS/WSS.");
            process.exit(1);
        }
        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            console.error("tls-cert / tls-key file not found.");
            process.exit(1);
        }
        tlsOpts = {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
        };
        useTls = true;
    }

    const game = new GameServer({ worldName, props });
    const handler = createRequestHandler(game, { serveClient, useTls });
    const server = useTls
        ? https.createServer(tlsOpts, handler)
        : http.createServer(handler);

    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => game.onConnection(ws));

    let last = Date.now();
    const loop = setInterval(() => {
        const now = Date.now();
        const dt = Math.min(100, now - last);
        last = now;
        game.tick(dt);
    }, 1000 / 60);

    server.listen(port, "0.0.0.0", () => {
        clearConsole();
        console.log("========================================");
        console.log(" Cave Paintings Dedicated Server");
        console.log("========================================");
        console.log(` World: ${worldName}`);
        console.log(` Join:  ${lanIPv4()}:${port}${useTls ? " (TLS)" : ""}`);
        if (serveClient) console.log(" Client UI served locally (--serve-client)");
        console.log("----------------------------------------");
        console.log(" Commands: save | list | time [HH] [MM] | tick [speed] | say <msg> | kick <name> | password <pw> | stop");
        console.log("========================================");

        // Prompt after the banner so join/leave/save logs don't erase "> ".
        // Session command history (↑/↓) — needs a TTY; force terminal so Node enables it.
        const isTerminal = !!(process.stdin.isTTY && process.stdout.isTTY);
        if (isTerminal) {
            try {
                readline.emitKeypressEvents(process.stdin);
            } catch (_) {}
        }
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: "> ",
            terminal: isTerminal,
            historySize: isTerminal ? 200 : 0,
            removeHistoryDuplicates: true
        });
        /** @type {string[]} newest-first session history (mirrors rl.history for non-TTY fallback) */
        const sessionHistory = [];
        let histIndex = -1; // -1 = drafting a new line
        let draftStash = "";
        let inCommand = false;
        const rawLog = console.log.bind(console);
        const rawWarn = console.warn.bind(console);
        const rawError = console.error.bind(console);

        const redrawPrompt = (preserve = true) => {
            if (rl.closed) return;
            try {
                rl.prompt(preserve);
            } catch (_) {}
        };

        const setLine = (text) => {
            if (rl.closed) return;
            try {
                rl.line = String(text ?? "");
                rl.cursor = rl.line.length;
                // Refresh the visible prompt line
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                rl.prompt(true);
                if (rl.line) process.stdout.write(rl.line);
            } catch (_) {}
        };

        // Fallback ↑/↓ when readline's built-in history isn't active (some hosts)
        if (isTerminal) {
            process.stdin.on("keypress", (_str, key) => {
                if (!key || inCommand || rl.closed) return;
                if (key.ctrl || key.meta) return;
                if (key.name !== "up" && key.name !== "down") return;
                // Prefer Node's built-in history when it has entries
                if (Array.isArray(rl.history) && rl.history.length > 0) return;

                if (key.name === "up") {
                    if (!sessionHistory.length) return;
                    if (histIndex < 0) draftStash = rl.line || "";
                    const next = Math.min(sessionHistory.length - 1, histIndex + 1);
                    if (next === histIndex) return;
                    histIndex = next;
                    setLine(sessionHistory[histIndex]);
                } else {
                    if (histIndex < 0) return;
                    histIndex -= 1;
                    if (histIndex < 0) {
                        setLine(draftStash);
                        draftStash = "";
                    } else {
                        setLine(sessionHistory[histIndex]);
                    }
                }
            });
        }

        const logWithPrompt = (raw, args) => {
            if (!rl.closed) {
                try {
                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                } catch (_) {}
            }
            raw(...args);
            // Line handler redraws once at the end; async logs (join/leave) need it now.
            if (!inCommand) redrawPrompt(true);
        };

        console.log = (...args) => logWithPrompt(rawLog, args);
        console.warn = (...args) => logWithPrompt(rawWarn, args);
        console.error = (...args) => logWithPrompt(rawError, args);

        const shutdown = () => {
            console.log = rawLog;
            console.warn = rawWarn;
            console.error = rawError;
            clearInterval(loop);
            game.stop();
            try { server.close(); } catch (_) {}
            try { rl.close(); } catch (_) {}
            process.exit(0);
        };

        rl.on("line", (line) => {
            inCommand = true;
            histIndex = -1;
            draftStash = "";
            const trimmed = line.trim();
            // Drop blank submits from history; remember non-empty for this session
            if (!trimmed) {
                if (Array.isArray(rl.history) && rl.history[0] === line) {
                    rl.history.shift();
                }
            } else if (sessionHistory[0] !== trimmed) {
                sessionHistory.unshift(trimmed);
                if (sessionHistory.length > 200) sessionHistory.length = 200;
            }
            try {
                const parts = trimmed.split(/\s+/);
                const cmd = (parts[0] || "").toLowerCase();
                if (cmd === "save") game.save("console");
                else if (cmd === "list") console.log("Online:", game.listPlayers().join(", ") || "(none)");
                else if (cmd === "time") {
                    if (parts.length < 2) {
                        console.log(game.formatClock());
                    } else {
                        const out = game.setTime(parts[1], parts[2]);
                        if (!out) console.log("Usage: time [HH] [MM]");
                        else console.log(out);
                    }
                } else if (cmd === "tick") {
                    const arg = parts[1];
                    if (arg == null || arg === "") {
                        console.log(game.formatTickSpeed());
                    } else {
                        const out = game.setTickSpeed(arg);
                        if (!out) {
                            console.log("Usage: tick [speed]  (1 = normal, 60 ≈ 1 game hour/sec, 0 = pause)");
                        } else {
                            console.log(out);
                        }
                    }
                } else if (cmd === "say") {
                    const msg = parts.slice(1).join(" ");
                    if (!game.say(msg)) console.log("Usage: say <message>");
                    else console.log(`<Server> ${msg.trim()}`);
                } else if (cmd === "kick") {
                    if (!game.kick(parts[1])) console.log("Player not found.");
                    else console.log("Kicked", parts[1]);
                } else if (cmd === "password") {
                    const pw = parts.slice(1).join(" ") || "";
                    props.password = pw;
                    game.props.password = pw;
                    console.log(pw ? "Password set for this session." : "Password cleared.");
                } else if (cmd === "stop" || cmd === "exit" || cmd === "quit") {
                    shutdown();
                    return;
                } else if (cmd) console.log("Unknown command:", cmd);
            } finally {
                inCommand = false;
                redrawPrompt(false);
            }
        });

        process.on("SIGINT", shutdown);
        rl.prompt();
    });
}

main();

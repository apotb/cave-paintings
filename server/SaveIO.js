/**
 * Save folder layout helpers (Node-only).
 *
 * saves/<worldName>/
 *   world.json          (chunks, clock, logout poses by character id)
 *   server.properties
 *   players/            (legacy; unused for normal play — gear is client-owned)
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_PROPS = {
    port: 21826,
    "max-players": 8,
    password: "",
    "autosave-minutes": 5,
    motd: "Cave Paintings",
    "world-name": "world",
    // Absolute or repo-relative paths; both set → HTTPS + WSS (needed from an HTTPS game site)
    "tls-cert": "",
    "tls-key": ""
};

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function worldDir(root, worldName) {
    return path.join(root, "saves", worldName);
}

function playersDir(root, worldName) {
    return path.join(worldDir(root, worldName), "players");
}

function propsPath(root, worldName) {
    return path.join(worldDir(root, worldName), "server.properties");
}

function worldPath(root, worldName) {
    return path.join(worldDir(root, worldName), "world.json");
}

function playerPath(root, worldName, playerId) {
    return path.join(playersDir(root, worldName), `${playerId}.json`);
}

function readProperties(root, worldName) {
    const file = propsPath(root, worldName);
    const out = { ...DEFAULT_PROPS, "world-name": worldName };
    if (!fs.existsSync(file)) return out;
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq < 0) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if (k === "port" || k === "max-players" || k === "autosave-minutes") v = Number(v) || out[k];
        out[k] = v;
    }
    return out;
}

function writeProperties(root, worldName, props) {
    ensureDir(worldDir(root, worldName));
    const merged = { ...DEFAULT_PROPS, ...props, "world-name": worldName };
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(propsPath(root, worldName), lines.join("\n") + "\n", "utf8");
    return merged;
}

function loadWorld(root, worldName) {
    const file = worldPath(root, worldName);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveWorld(root, worldName, data) {
    ensureDir(worldDir(root, worldName));
    fs.writeFileSync(worldPath(root, worldName), JSON.stringify(data), "utf8");
}

function loadPlayer(root, worldName, playerId) {
    const file = playerPath(root, worldName, playerId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function savePlayer(root, worldName, playerId, data) {
    ensureDir(playersDir(root, worldName));
    fs.writeFileSync(playerPath(root, worldName, playerId), JSON.stringify(data, null, 2), "utf8");
}

function listPlayerIds(root, worldName) {
    const dir = playersDir(root, worldName);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""));
}

/** Wipe player files when the world is regenerated so poses don't belong to a dead map. */
function clearPlayers(root, worldName) {
    const dir = playersDir(root, worldName);
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        fs.unlinkSync(path.join(dir, f));
        n++;
    }
    return n;
}

const MAX_WORLDS = 9;

/**
 * Existing world folders under saves/ (dirs that look like worlds).
 * @returns {{ name: string, hasWorldJson: boolean, mtimeMs: number }[]}
 */
function listWorlds(root) {
    const saves = path.join(root, "saves");
    if (!fs.existsSync(saves)) return [];
    const out = [];
    for (const name of fs.readdirSync(saves)) {
        const dir = path.join(saves, name);
        let st;
        try {
            st = fs.statSync(dir);
        } catch {
            continue;
        }
        if (!st.isDirectory()) continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(name)) continue;
        const hasWorldJson = fs.existsSync(worldPath(root, name));
        out.push({ name, hasWorldJson, mtimeMs: st.mtimeMs });
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
    return out.slice(0, MAX_WORLDS);
}

/** First free default name: world, world2, … world9 */
function nextDefaultWorldName(root) {
    const used = new Set(listWorlds(root).map((w) => w.name));
    // Also treat any folder as taken even beyond the 9 we list
    const saves = path.join(root, "saves");
    if (fs.existsSync(saves)) {
        for (const name of fs.readdirSync(saves)) used.add(name);
    }
    if (!used.has("world")) return "world";
    for (let i = 2; i <= MAX_WORLDS; i++) {
        const n = `world${i}`;
        if (!used.has(n)) return n;
    }
    return null;
}

function sanitizeWorldName(raw) {
    // Allow spaces; fold runs of whitespace to a single space
    const s = String(raw || "").trim().replace(/\s+/g, " ");
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(s)) return null;
    return s;
}

/** Permanently remove saves/<worldName>/ (recursive). */
function deleteWorld(root, worldName) {
    const name = sanitizeWorldName(worldName);
    if (!name) throw new Error("Invalid world name");
    const dir = worldDir(root, name);
    const saves = path.resolve(path.join(root, "saves"));
    const resolved = path.resolve(dir);
    if (!resolved.startsWith(saves + path.sep) && resolved !== saves) {
        throw new Error("Refusing to delete outside saves/");
    }
    if (!fs.existsSync(resolved)) return false;
    fs.rmSync(resolved, { recursive: true, force: true });
    return true;
}

module.exports = {
    DEFAULT_PROPS,
    MAX_WORLDS,
    ensureDir,
    worldDir,
    playersDir,
    propsPath,
    worldPath,
    playerPath,
    readProperties,
    writeProperties,
    loadWorld,
    saveWorld,
    loadPlayer,
    savePlayer,
    listPlayerIds,
    clearPlayers,
    listWorlds,
    nextDefaultWorldName,
    sanitizeWorldName,
    deleteWorld
};

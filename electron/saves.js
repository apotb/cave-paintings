/**
 * On-disk character/world records and options for the Electron client.
 * Layout: <userData>/save/{characters,worlds,options.json}
 */
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const KINDS = new Set(["characters", "worlds"]);
const ID_RE = /^[A-Za-z0-9._-]+$/;
const MUSIC_VOLUME_DEFAULT = 85;

function assertKind(kind) {
    if (!KINDS.has(kind)) throw new Error("Invalid save kind");
}

function assertId(id) {
    const s = String(id || "");
    if (!s || !ID_RE.test(s) || s.includes("..")) throw new Error("Invalid save id");
    return s;
}

function kindDir(root, kind) {
    assertKind(kind);
    return path.join(root, kind);
}

function fileFor(root, kind, id) {
    return path.join(kindDir(root, kind), `${assertId(id)}.json`);
}

function optionsPath(root) {
    return path.join(root, "options.json");
}

function defaultOptions() {
    return { guiScale: 0, musicVolume: MUSIC_VOLUME_DEFAULT, fullscreen: false };
}

function normalizeOptions(raw) {
    const base = defaultOptions();
    if (!raw || typeof raw !== "object") return base;
    const gui = Number(raw.guiScale);
    const vol = Number(raw.musicVolume);
    return {
        guiScale: Number.isFinite(gui) && gui >= 0 ? Math.floor(gui) : base.guiScale,
        musicVolume: Number.isFinite(vol)
            ? Math.max(0, Math.min(100, Math.round(vol)))
            : base.musicVolume,
        fullscreen: !!raw.fullscreen
    };
}

async function atomicWrite(file, text) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, "utf8");
    try {
        await fsp.rename(tmp, file);
    } catch (e) {
        try { await fsp.unlink(file); } catch (_) {}
        await fsp.rename(tmp, file);
    }
}

async function list(root, kind) {
    const dir = kindDir(root, kind);
    await fsp.mkdir(dir, { recursive: true });
    const names = await fsp.readdir(dir);
    const rows = [];
    for (const name of names) {
        if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
        const full = path.join(dir, name);
        try {
            const row = JSON.parse(await fsp.readFile(full, "utf8"));
            if (row && typeof row === "object") rows.push(row);
        } catch (e) {
            console.warn("[saves] skip", full, e && e.message);
        }
    }
    return rows;
}

async function get(root, kind, id) {
    const file = fileFor(root, kind, id);
    try {
        return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
    }
}

async function put(root, kind, record) {
    if (!record || typeof record !== "object" || !record.id) {
        throw new Error("Save needs id");
    }
    assertKind(kind);
    const file = fileFor(root, kind, record.id);
    const text = kind === "characters"
        ? JSON.stringify(record, null, 2)
        : JSON.stringify(record);
    await atomicWrite(file, text);
    return record;
}

async function remove(root, kind, id) {
    const file = fileFor(root, kind, id);
    try {
        await fsp.unlink(file);
    } catch (e) {
        if (e.code !== "ENOENT") throw e;
    }
}

function readOptions(root) {
    try {
        const raw = JSON.parse(fs.readFileSync(optionsPath(root), "utf8"));
        return normalizeOptions(raw);
    } catch (e) {
        if (e && e.code !== "ENOENT") console.warn("[saves] options", e.message);
        return defaultOptions();
    }
}

async function writeOptions(root, opts) {
    const next = normalizeOptions(opts);
    await atomicWrite(optionsPath(root), JSON.stringify(next, null, 2) + "\n");
    return next;
}

async function moveDirContents(from, to) {
    if (!fs.existsSync(from) || from === to) return;
    await fsp.mkdir(to, { recursive: true });
    const names = await fsp.readdir(from);
    for (const name of names) {
        const src = path.join(from, name);
        const dest = path.join(to, name);
        if (fs.existsSync(dest)) continue;
        await fsp.rename(src, dest);
    }
    const leftover = await fsp.readdir(from);
    if (leftover.length === 0) await fsp.rmdir(from).catch(() => {});
}

/** Move pre-subdir characters/worlds from userData into save/. */
async function migrateLegacyLayout(userData, saveRoot) {
    if (!userData || userData === saveRoot) return;
    await moveDirContents(path.join(userData, "characters"), kindDir(saveRoot, "characters"));
    await moveDirContents(path.join(userData, "worlds"), kindDir(saveRoot, "worlds"));
}

async function ensureRoot(root) {
    await fsp.mkdir(root, { recursive: true });
    const userData = path.dirname(root);
    await migrateLegacyLayout(userData, root);
    await fsp.mkdir(kindDir(root, "characters"), { recursive: true });
    await fsp.mkdir(kindDir(root, "worlds"), { recursive: true });
    if (!fs.existsSync(optionsPath(root))) {
        await writeOptions(root, defaultOptions());
    }
    return root;
}

module.exports = {
    list, get, put, remove, ensureRoot, kindDir, assertKind, assertId,
    readOptions, writeOptions, defaultOptions, normalizeOptions
};

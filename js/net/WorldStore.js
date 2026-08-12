/**
 * Singleplayer worlds in IndexedDB (seed, clock, chunks).
 * Dedicated multiplayer worlds still live under saves/ on the Node server.
 */
const WorldStore = (() => {
    const DB_NAME = "cave_paintings";
    const DB_VERSION = 2;
    const STORE = "worlds";

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("characters")) {
                    const os = db.createObjectStore("characters", { keyPath: "id" });
                    os.createIndex("updatedAt", "updatedAt", { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE)) {
                    const ws = db.createObjectStore(STORE, { keyPath: "id" });
                    ws.createIndex("updatedAt", "updatedAt", { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
        });
    }

    function uuid() {
        if (crypto.randomUUID) return crypto.randomUUID();
        return `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    /** Cryptographically random 32-bit seed (not Date.now). */
    function randomSeed() {
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
            const buf = new Uint32Array(1);
            crypto.getRandomValues(buf);
            return buf[0] >>> 0;
        }
        return (Math.random() * 0x100000000) >>> 0;
    }

    /** Same spawn-at-origin check used by the terrain generator. */
    function seedIsPlayable(seed) {
        if (typeof noise === "undefined" || typeof octaveNoise2D !== "function") return true;
        const s = Number(seed) >>> 0;
        noise.seed(s);
        const elevation = octaveNoise2D(0, 0, 2, 0.5, 2.5, 0);
        const river = Math.abs(octaveNoise2D(0, 0, 3, 1.2, 0.7, 2));
        return elevation > -0.2 && elevation < 0.25 && river > 0.005;
    }

    /**
     * Start from `start` (or a fresh random seed) and walk forward until origin is landable.
     * @param {number} [start]
     */
    function findPlayableSeed(start) {
        let seed = start != null && Number.isFinite(Number(start))
            ? (Number(start) >>> 0)
            : randomSeed();
        for (let i = 0; i < 200000; i++) {
            if (seedIsPlayable(seed)) return seed;
            seed = (seed + 1) >>> 0;
        }
        return seed;
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function defaultWorld(name = "New World", seed = null) {
        const now = Date.now();
        return {
            id: uuid(),
            name: String(name || "New World").trim().slice(0, 32) || "New World",
            createdAt: now,
            updatedAt: now,
            seed: seed == null ? null : (Number(seed) >>> 0),
            genVersion: 2,
            spawn: { x: 8, y: 16 },
            clock: { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 },
            poses: {},
            chunks: {}
        };
    }

    async function list() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => {
                const rows = (req.result || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                db.close();
                resolve(rows);
            };
            req.onerror = () => {
                db.close();
                reject(req.error);
            };
        });
    }

    async function get(id) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).get(id);
            req.onsuccess = () => {
                db.close();
                resolve(req.result || null);
            };
            req.onerror = () => {
                db.close();
                reject(req.error);
            };
        });
    }

    function normalizeName(name) {
        return String(name || "World").trim().slice(0, 32) || "World";
    }

    function nameKey(name) {
        return normalizeName(name).toLowerCase();
    }

    async function nameTaken(name, exceptId = null) {
        const key = nameKey(name);
        const rows = await list();
        return rows.some((r) => r.id !== exceptId && nameKey(r.name) === key);
    }

    async function put(world) {
        if (!world?.id) throw new Error("World needs id");
        const row = clone(world);
        row.updatedAt = Date.now();
        row.name = normalizeName(row.name);
        if (await nameTaken(row.name, row.id)) {
            throw new Error(`A world named "${row.name}" already exists.`);
        }
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(row);
            tx.oncomplete = () => {
                db.close();
                resolve(row);
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        });
    }

    async function create(name, opts = {}) {
        const w = defaultWorld(name);
        const raw = opts.seed != null ? Number(opts.seed) : randomSeed();
        w.seed = Number.isFinite(raw) ? findPlayableSeed(raw >>> 0) : findPlayableSeed();
        return put(w);
    }

    async function rename(id, name) {
        const w = await get(id);
        if (!w) throw new Error("World not found");
        w.name = normalizeName(name);
        return put(w);
    }

    async function remove(id) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        });
    }

    function exportJson(world) {
        return JSON.stringify({
            v: 1,
            kind: "cave_paintings_world",
            world: clone(world)
        });
    }

    function importJson(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error("Invalid world file");
        }
        const raw = data?.world || data;
        if (!raw || typeof raw !== "object") throw new Error("Invalid world file");
        const w = defaultWorld(raw.name);
        Object.assign(w, {
            name: String(raw.name || w.name).slice(0, 32),
            seed: raw.seed ?? null,
            genVersion: raw.genVersion ?? 2,
            spawn: raw.spawn || w.spawn,
            clock: raw.clock || w.clock,
            poses: raw.poses && typeof raw.poses === "object" ? clone(raw.poses) : {},
            chunks: raw.chunks && typeof raw.chunks === "object" ? clone(raw.chunks) : {}
        });
        w.id = uuid();
        w.createdAt = Date.now();
        w.updatedAt = w.createdAt;
        return w;
    }

    function download(world) {
        const blob = new Blob([exportJson(world)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const safe = String(world.name || "world").replace(/[^\w\- ]+/g, "").trim() || "world";
        a.download = `${safe}.world`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    function pickFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".world";
            input.onchange = () => {
                const file = input.files?.[0];
                if (!file) {
                    reject(new Error("No file"));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = () => reject(reader.error || new Error("Read failed"));
                reader.readAsText(file);
            };
            input.click();
        });
    }

    return {
        list,
        get,
        put,
        create,
        rename,
        remove,
        exportJson,
        importJson,
        download,
        pickFile,
        defaultWorld,
        randomSeed,
        seedIsPlayable,
        findPlayableSeed
    };
})();

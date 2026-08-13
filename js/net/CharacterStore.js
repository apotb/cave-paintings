/**
 * Client-owned characters in IndexedDB, with JSON export/import.
 * Characters hold gear/vitals/body — not world pose.
 */
const CharacterStore = (() => {
    const DB_NAME = "cave_paintings";
    const DB_VERSION = 2;
    const STORE = "characters";

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const os = db.createObjectStore(STORE, { keyPath: "id" });
                    os.createIndex("updatedAt", "updatedAt", { unique: false });
                }
                if (!db.objectStoreNames.contains("worlds")) {
                    const ws = db.createObjectStore("worlds", { keyPath: "id" });
                    ws.createIndex("updatedAt", "updatedAt", { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
        });
    }

    function uuid() {
        if (crypto.randomUUID) return crypto.randomUUID();
        return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function emptyInv(size = 5) {
        return Array.from({ length: size }, () => null);
    }

    function defaultLook() {
        if (typeof Look !== "undefined") return Look.normalizeLook(null);
        return {
            head: 0xff00ee,
            eyes: 0x000000,
            arms: 0xff8900,
            shirt: 0x006cff,
            pants: 0xff0000,
            shoes: 0x7a6c47
        };
    }

    function normalizeLook(raw) {
        if (typeof Look !== "undefined") return Look.normalizeLook(raw);
        const base = defaultLook();
        if (!raw || typeof raw !== "object") return base;
        const out = { ...base };
        for (const k of Object.keys(base)) {
            if (typeof raw[k] === "number") out[k] = raw[k] >>> 0;
        }
        return out;
    }

    function defaultCharacter(name = "Player") {
        const now = Date.now();
        return {
            id: uuid(),
            name: String(name || "Player").trim().slice(0, 24) || "Player",
            createdAt: now,
            updatedAt: now,
            kc: 1200,
            saturation: 0,
            stomach: 1600,
            inventory: emptyInv(5),
            equipment: { head: null, torso: null, legs: null, feet: null, waist: [] },
            hotbarIndex: 0,
            hp: 100,
            mhp: 100,
            body: null,
            look: defaultLook(),
            favorite: false
        };
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    async function withStore(mode, fn) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const store = tx.objectStore(STORE);
            let result;
            try {
                result = fn(store);
            } catch (e) {
                reject(e);
                return;
            }
            tx.oncomplete = () => {
                db.close();
                resolve(result);
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error("CharacterStore tx failed"));
            };
        });
    }

    async function list() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => {
                const rows = (req.result || []).slice().sort((a, b) => {
                    const fa = a.favorite ? 1 : 0;
                    const fb = b.favorite ? 1 : 0;
                    if (fb !== fa) return fb - fa;
                    return (b.updatedAt || 0) - (a.updatedAt || 0);
                });
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
        return String(name || "Player").trim().slice(0, 24) || "Player";
    }

    function nameKey(name) {
        return normalizeName(name).toLowerCase();
    }

    async function nameTaken(name, exceptId = null) {
        const key = nameKey(name);
        const rows = await list();
        return rows.some((r) => r.id !== exceptId && nameKey(r.name) === key);
    }

    async function put(character, opts = {}) {
        if (!character?.id) throw new Error("Character needs id");
        const row = clone(character);
        if (!opts.preserveUpdatedAt) row.updatedAt = Date.now();
        else row.updatedAt = Number(character.updatedAt) || Date.now();
        row.name = normalizeName(row.name);
        row.look = normalizeLook(row.look);
        row.favorite = !!row.favorite;
        normalizeCharacterSpoil(row);
        if (await nameTaken(row.name, row.id)) {
            throw new Error(`A character named "${row.name}" already exists.`);
        }
        await withStore("readwrite", (store) => store.put(row));
        return row;
    }

    async function create(name, look) {
        const c = defaultCharacter(name);
        c.look = normalizeLook(look);
        return put(c);
    }

    async function remove(id) {
        await withStore("readwrite", (store) => store.delete(id));
    }

    async function rename(id, name) {
        const c = await get(id);
        if (!c) throw new Error("Character not found");
        c.name = normalizeName(name);
        return put(c);
    }

    async function setFavorite(id, favorite) {
        const c = await get(id);
        if (!c) throw new Error("Character not found");
        c.favorite = !!favorite;
        return put(c, { preserveUpdatedAt: true });
    }

    function stripWorldSpoil(stack) {
        if (!stack || typeof stack !== "object") return;
        // Prefer remaining timer; drop absolute world clocks from character saves.
        if (stack.spoilLeft != null) {
            delete stack.spoilAt;
            delete stack.spoilMinutes;
            return;
        }
        // Legacy absolute spoilAt without spoilLeft — keep spoilAt so join can convert
        // once the world clock is known (migrateToSpoilLeft).
    }

    function normalizeCharacterSpoil(character) {
        if (!character) return character;
        const inv = character.inventory;
        if (Array.isArray(inv)) {
            for (const s of inv) stripWorldSpoil(s);
        }
        const eq = character.equipment;
        if (eq && typeof eq === "object") {
            for (const key of ["head", "torso", "legs", "feet"]) stripWorldSpoil(eq[key]);
            if (Array.isArray(eq.waist)) {
                for (const s of eq.waist) stripWorldSpoil(s);
            }
        }
        return character;
    }

    /** Snapshot sent on AUTH — no pose/world fields. */
    function toJoinSnapshot(character) {
        if (!character) return null;
        const snap = {
            id: character.id,
            name: character.name,
            kc: character.kc,
            saturation: character.saturation,
            stomach: character.stomach,
            inventory: clone(character.inventory || emptyInv(5)),
            equipment: clone(character.equipment || {}),
            hotbarIndex: character.hotbarIndex || 0,
            hp: character.hp,
            mhp: character.mhp,
            body: character.body ? clone(character.body) : null,
            look: normalizeLook(character.look)
        };
        normalizeCharacterSpoil(snap);
        return snap;
    }

    /** Merge authoritative YOU payload into a character record. */
    function applyYou(character, you) {
        if (!character || !you) return character;
        const next = clone(character);
        if (typeof you.name === "string" && you.name) next.name = you.name.slice(0, 24);
        if (typeof you.kc === "number") next.kc = you.kc;
        if (typeof you.saturation === "number") next.saturation = you.saturation;
        if (typeof you.stomach === "number") next.stomach = you.stomach;
        if (Array.isArray(you.inventory)) next.inventory = clone(you.inventory);
        if (you.equipment) next.equipment = clone(you.equipment);
        if (typeof you.hotbarIndex === "number") next.hotbarIndex = you.hotbarIndex;
        if (typeof you.hp === "number") next.hp = you.hp;
        if (typeof you.mhp === "number") next.mhp = you.mhp;
        if (you.body !== undefined) next.body = you.body ? clone(you.body) : null;
        if (you.look) next.look = normalizeLook(you.look);
        else next.look = normalizeLook(next.look);
        next.updatedAt = Date.now();
        normalizeCharacterSpoil(next);
        return next;
    }

    function exportJson(character) {
        return JSON.stringify({
            v: 1,
            kind: "cave_paintings_character",
            character: clone(character)
        }, null, 2);
    }

    function importJson(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error("Invalid character file");
        }
        const raw = data?.character || data;
        if (!raw || typeof raw !== "object") throw new Error("Invalid character file");
        const c = defaultCharacter(raw.name);
        Object.assign(c, {
            name: String(raw.name || c.name).slice(0, 24),
            kc: raw.kc ?? c.kc,
            saturation: raw.saturation ?? c.saturation,
            stomach: raw.stomach ?? c.stomach,
            inventory: Array.isArray(raw.inventory) ? clone(raw.inventory) : c.inventory,
            equipment: raw.equipment ? clone(raw.equipment) : c.equipment,
            hotbarIndex: raw.hotbarIndex || 0,
            hp: raw.hp ?? c.hp,
            mhp: raw.mhp ?? c.mhp,
            body: raw.body ? clone(raw.body) : null,
            look: normalizeLook(raw.look),
            favorite: !!raw.favorite
        });
        // Always new id on import so we don't clobber an existing char
        c.id = uuid();
        c.createdAt = Date.now();
        c.updatedAt = c.createdAt;
        return c;
    }

    function download(character) {
        const blob = new Blob([exportJson(character)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const safe = String(character.name || "character").replace(/[^\w\- ]+/g, "").trim() || "character";
        a.download = `${safe}.character`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    function pickFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".character";
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
        remove,
        rename,
        setFavorite,
        toJoinSnapshot,
        applyYou,
        exportJson,
        importJson,
        download,
        pickFile,
        defaultCharacter,
        emptyInv
    };
})();

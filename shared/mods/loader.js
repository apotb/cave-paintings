/**
 * Discover, validate, and merge mod data. Sim scripts are bytes only.
 * Client scripts are recorded for the browser and are not executed here.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ModLoader = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const MOD_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
    const DATA_FILES = [
        "items.json",
        "things.json",
        "techs.json",
        "mobs.json",
        "bodyPlans.json",
        "injuries.json",
        "hediffs.json",
        "structures.json",
        "scatters.json"
    ];
    const LIST_KINDS = ["items", "things", "mobs", "techs"];
    const MAP_KINDS = ["bodyPlans", "injuries", "hediffs"];
    const BASE_SOURCE = "cave-paintings.base";

    const LOCAL_RE = /^[a-z][a-z0-9_]*$/;
    const RECIPE_SPECIAL = {
        REQUIRE_THING: true,
        REQUIRE_STATION: true,
        REQUIRE_TOOL: true
    };

    function recordIdOk(modId, id) {
        return new RegExp("^" + modId.replace(/[.]/g, "\\.") + "\\.[a-z][a-z0-9_]*$").test(id);
    }

    // A bare name is this mod's. A name already in this mod's namespace stays.
    // Any other dotted id is left alone so base content and other mods stay as written.
    function qualifyName(modId, name) {
        if (typeof name !== "string" || !name) return name;
        const prefix = modId + ".";
        if (name.startsWith(prefix) && LOCAL_RE.test(name.slice(prefix.length))) return name;
        if (LOCAL_RE.test(name)) return prefix + name;
        return name;
    }

    function qualifyDef(modId, id) {
        if (typeof id !== "string" || !id) return id;
        const prefix = modId + ".";
        if (id.startsWith(prefix) && LOCAL_RE.test(id.slice(prefix.length))) return id;
        if (LOCAL_RE.test(id)) return prefix + id;
        throw new Error(`${modId}: id "${id}" is outside the mod namespace`);
    }

    function localKey(modId, id) {
        if (typeof id !== "string" || !id) return null;
        const prefix = modId + ".";
        if (id.startsWith(prefix) && LOCAL_RE.test(id.slice(prefix.length))) return id.slice(prefix.length);
        if (LOCAL_RE.test(id)) return id;
        return null;
    }

    function addLocal(modId, locals, id) {
        const short = localKey(modId, id);
        if (short) locals.add(short);
    }

    function qualifyRef(modId, name, locals) {
        if (typeof name !== "string" || !name) return name;
        const prefix = modId + ".";
        if (name.startsWith(prefix)) return name;
        if (LOCAL_RE.test(name) && locals.has(name)) return prefix + name;
        return name;
    }

    function qualifyStringField(modId, obj, field, locals) {
        if (!obj || typeof obj[field] !== "string") return;
        obj[field] = qualifyRef(modId, obj[field], locals);
    }

    function collectLocals(modId, data) {
        const locals = new Set();
        for (const kind of LIST_KINDS) {
            for (const row of data[kind] || []) addLocal(modId, locals, row && row.id);
        }
        for (const kind of MAP_KINDS) {
            const map = data[kind];
            if (!map || typeof map !== "object") continue;
            for (const key of Object.keys(map)) addLocal(modId, locals, (map[key] && map[key].id) || key);
        }
        for (const row of data.structures?.types || []) addLocal(modId, locals, row && row.id);
        for (const key of Object.keys(data.structures?.lootTables || {})) addLocal(modId, locals, key);
        for (const row of data.scatters || []) addLocal(modId, locals, row && row.id);
        return locals;
    }

    function qualifyRecipe(modId, recipe, locals) {
        if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return recipe;
        const out = {};
        for (const key of Object.keys(recipe)) {
            if (/^[A-Z0-9_]+$/.test(key)) {
                const value = recipe[key];
                if (RECIPE_SPECIAL[key] && typeof value === "string") out[key] = qualifyRef(modId, value, locals);
                else if (key === "REQUIRE_TOOL" && value && typeof value === "object" && typeof value.id === "string") {
                    out[key] = Object.assign({}, value, { id: qualifyRef(modId, value.id, locals) });
                } else out[key] = value;
                continue;
            }
            out[qualifyRef(modId, key, locals)] = recipe[key];
        }
        return out;
    }

    function qualifyTextured(modId, row) {
        if (!row || typeof row !== "object") return;
        if (row._assetName == null) row._assetName = row.key || row.id;
        row.id = qualifyDef(modId, row.id);
        row.key = row.key != null ? qualifyDef(modId, row.key) : row.id;
    }

    function qualifyIdList(modId, list, locals) {
        if (!Array.isArray(list)) return;
        for (let i = 0; i < list.length; i++) {
            if (typeof list[i] === "string") list[i] = qualifyRef(modId, list[i], locals);
        }
    }

    function qualifyData(modId, data) {
        if (!data || typeof data !== "object") return data;
        const locals = collectLocals(modId, data);
        for (const row of data.items || []) {
            qualifyTextured(modId, row);
            if (row.place) qualifyStringField(modId, row.place, "thing", locals);
            if (row.recipe) row.recipe = qualifyRecipe(modId, row.recipe, locals);
        }
        for (const row of data.things || []) {
            qualifyTextured(modId, row);
            qualifyStringField(modId, row.lootable, "item", locals);
            qualifyStringField(modId, row.lootable, "transform", locals);
            qualifyStringField(modId, row.choppable, "stump", locals);
            qualifyStringField(modId, row.diggable, "item", locals);
        }
        for (const row of data.mobs || []) {
            if (!row || typeof row !== "object") continue;
            row.id = qualifyDef(modId, row.id);
            qualifyStringField(modId, row, "bodyPlan", locals);
            for (const drop of row.drops || []) qualifyStringField(modId, drop, "item", locals);
        }
        for (const row of data.techs || []) {
            if (!row || typeof row !== "object") continue;
            row.id = qualifyDef(modId, row.id);
            qualifyIdList(modId, row.prereqs, locals);
            qualifyIdList(modId, row.unlocks && row.unlocks.items, locals);
            qualifyIdList(modId, row.unlocks && row.unlocks.jobs, locals);
            qualifyIdList(modId, row.unlocks && row.unlocks.bills, locals);
        }
        for (const kind of MAP_KINDS) {
            const map = data[kind];
            if (!map || typeof map !== "object") continue;
            const next = {};
            for (const key of Object.keys(map)) {
                const row = map[key];
                if (row && typeof row === "object") {
                    row.id = qualifyDef(modId, row.id || key);
                    next[row.id] = row;
                } else {
                    next[qualifyDef(modId, key)] = row;
                }
            }
            data[kind] = next;
        }
        for (const row of data.structures?.types || []) {
            if (!row || typeof row !== "object") continue;
            row.id = qualifyDef(modId, row.id);
            for (const piece of row.template?.pieces || []) qualifyStringField(modId, piece, "id", locals);
        }
        if (data.structures && data.structures.lootTables) {
            const tables = data.structures.lootTables;
            const next = {};
            for (const key of Object.keys(tables)) {
                const table = tables[key];
                if (table && typeof table === "object") {
                    for (const bucket of Object.keys(table)) {
                        const rows = table[bucket];
                        if (!Array.isArray(rows)) continue;
                        for (const entry of rows) qualifyStringField(modId, entry, "id", locals);
                    }
                }
                next[qualifyDef(modId, key)] = table;
            }
            data.structures.lootTables = next;
        }
        for (const row of data.scatters || []) {
            if (!row || typeof row !== "object") continue;
            row.id = qualifyDef(modId, row.id);
            qualifyStringField(modId, row, "thingId", locals);
        }
        return data;
    }

    function parseVer(text) {
        const m = String(text || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!m) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function cmpVer(a, b) {
        for (let i = 0; i < 3; i++) {
            if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
        }
        return 0;
    }

    function gameVersionMatches(spec, actual) {
        const m = String(spec || "").trim().match(/^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+)$/);
        if (!m) {
            throw new Error(`Bad gameVersion "${spec}"`);
        }
        const have = parseVer(actual);
        const need = parseVer(m[2]);
        if (!have || !need) throw new Error(`Bad gameVersion "${spec}"`);
        const c = cmpVer(have, need);
        const op = m[1] || "=";
        if (op === ">=") return c >= 0;
        if (op === ">") return c > 0;
        if (op === "<=") return c <= 0;
        if (op === "<") return c < 0;
        return c === 0;
    }

    function assertGameVersion(modId, spec, actual) {
        let ok = false;
        try {
            ok = gameVersionMatches(spec, actual);
        } catch (err) {
            throw new Error(`${modId}: ${err.message}`);
        }
        if (!ok) {
            throw new Error(`${modId}: gameVersion "${spec}" does not match ${actual}`);
        }
    }

    function assertManifest(manifest, dirLabel) {
        if (!manifest || typeof manifest !== "object") {
            throw new Error(`${dirLabel}: mod.json is not an object`);
        }
        const id = manifest.id;
        if (!MOD_ID_RE.test(String(id || ""))) {
            throw new Error(`Invalid mod id "${id}"`);
        }
        if (!Array.isArray(manifest.dependencies)) {
            throw new Error(`${id}: dependencies must be an array of mod id strings`);
        }
        for (const dep of manifest.dependencies) {
            if (typeof dep !== "string") {
                throw new Error(`${id}: dependencies must be an array of mod id strings`);
            }
        }
        if (manifest.client && typeof manifest.client !== "string" && manifest.client !== true) {
            throw new Error(`${id}: client script is not a path`);
        }
        return id;
    }

    function orderMods(mods) {
        const byId = new Map();
        for (const mod of mods) {
            if (byId.has(mod.id)) {
                const prev = byId.get(mod.id);
                throw new Error(`Duplicate mod id "${mod.id}" (${prev.label} and ${mod.label})`);
            }
            byId.set(mod.id, mod);
        }
        for (const mod of mods) {
            for (const dep of mod.dependencies) {
                if (!byId.has(dep)) throw new Error(`Missing mod dependency "${dep}"`);
            }
        }
        const indeg = new Map();
        const dependents = new Map();
        for (const mod of mods) {
            indeg.set(mod.id, 0);
            dependents.set(mod.id, []);
        }
        for (const mod of mods) {
            for (const dep of mod.dependencies) {
                indeg.set(mod.id, indeg.get(mod.id) + 1);
                dependents.get(dep).push(mod.id);
            }
        }
        const ready = mods.filter((mod) => indeg.get(mod.id) === 0);
        const out = [];
        while (ready.length) {
            ready.sort((a, b) => (a.loadPriority - b.loadPriority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            const mod = ready.shift();
            out.push(mod);
            for (const childId of dependents.get(mod.id)) {
                indeg.set(childId, indeg.get(childId) - 1);
                if (indeg.get(childId) === 0) ready.push(byId.get(childId));
            }
        }
        if (out.length !== mods.length) {
            throw new Error("Mod dependency cycle");
        }
        return out;
    }

    function indexOf(list) {
        const map = Object.create(null);
        if (!Array.isArray(list)) return map;
        for (const row of list) {
            if (row?.id) map[row.id] = row;
        }
        return map;
    }

    function stampList(list, source) {
        if (!Array.isArray(list)) return;
        for (const row of list) {
            if (row && typeof row === "object" && !row._source) row._source = source;
        }
    }

    function stampMap(map, source) {
        if (!map || typeof map !== "object") return;
        for (const row of Object.values(map)) {
            if (row && typeof row === "object" && !row._source) row._source = source;
        }
    }

    function stampCore(store, structures) {
        stampList(store.itemsList, BASE_SOURCE);
        stampList(store.thingsList, BASE_SOURCE);
        stampList(store.mobsList, BASE_SOURCE);
        stampList(store.techsList, BASE_SOURCE);
        stampMap(store.bodyPlans, BASE_SOURCE);
        stampMap(store.injuries, BASE_SOURCE);
        stampMap(store.hediffs, BASE_SOURCE);
        stampList(structures?.types, BASE_SOURCE);
    }

    function acceptRecord(mod, kind, row, existing) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
            throw new Error(`${mod.id}: ${kind} entry is not an object`);
        }
        if (!row.id) throw new Error(`${mod.id}: ${kind} entry is missing id`);
        if (existing) {
            const from = existing._source || BASE_SOURCE;
            throw new Error(`Duplicate id "${row.id}" (${from} and ${mod.id})`);
        }
        if (!recordIdOk(mod.id, row.id)) {
            throw new Error(`${mod.id}: id "${row.id}" is outside the mod namespace`);
        }
        row._source = mod.id;
        return row;
    }

    function textureUrl(mod, kind, row) {
        const file = row._assetName || row.key || row.id;
        if (!file) return null;
        const folder = kind === "things" ? "things" : "items";
        if (kind !== "items" && kind !== "things") return null;
        const rel = `assets/${folder}/${file}.png`;
        if (mod.textureFiles && mod.textureFiles[rel]) return mod.textureFiles[rel];
        if (!mod.textureBase) return null;
        return `${mod.textureBase}/${rel}`;
    }

    function mergeLists(store, mod) {
        for (const kind of LIST_KINDS) {
            const rows = mod.data[kind];
            if (rows == null) continue;
            if (!Array.isArray(rows)) throw new Error(`${mod.id}: ${kind} must be an array`);
            const listKey = kind + "List";
            const indexKey = kind === "techs" ? null : kind + "ById";
            if (!Array.isArray(store[listKey])) store[listKey] = [];
            const index = indexKey
                ? (store[indexKey] || (store[indexKey] = indexOf(store[listKey])))
                : indexOf(store[listKey]);
            for (const row of rows) {
                if (row == null) continue;
                const prior = row?.id ? index[row.id] : null;
                const accepted = acceptRecord(mod, kind, row, prior);
                const url = textureUrl(mod, kind, accepted);
                if (url) accepted._textureUrl = url;
                store[listKey].push(accepted);
                index[accepted.id] = accepted;
            }
            if (indexKey) store[indexKey] = index;
        }
    }

    function mergeMaps(store, mod) {
        for (const kind of MAP_KINDS) {
            const table = mod.data[kind];
            if (table == null) continue;
            if (typeof table !== "object" || Array.isArray(table)) {
                throw new Error(`${mod.id}: ${kind} must be an object`);
            }
            if (!store[kind] || typeof store[kind] !== "object") store[kind] = {};
            for (const [key, row] of Object.entries(table)) {
                if (row == null) continue;
                if (row.id && row.id !== key) {
                    throw new Error(`${mod.id}: ${kind} key "${key}" does not match id "${row.id}"`);
                }
                if (!row.id) row.id = key;
                const accepted = acceptRecord(mod, kind, row, store[kind][key] || null);
                store[kind][key] = accepted;
            }
        }
    }

    function mergeStructures(structures, mod) {
        const extra = mod.data.structures;
        if (extra == null) return structures || { types: [], lootTables: {} };
        const base = structures && typeof structures === "object"
            ? structures
            : { types: [], lootTables: {} };
        if (!Array.isArray(base.types)) base.types = [];
        if (!base.lootTables || typeof base.lootTables !== "object") base.lootTables = {};
        const types = Array.isArray(extra.types) ? extra.types : [];
        const seen = new Map(base.types.filter((t) => t?.id).map((t) => [t.id, t]));
        for (const row of types) {
            if (row == null) continue;
            const accepted = acceptRecord(mod, "structures", row, seen.get(row.id) || null);
            base.types.push(accepted);
            seen.set(accepted.id, accepted);
        }
        const tables = extra.lootTables && typeof extra.lootTables === "object" ? extra.lootTables : {};
        for (const [key, table] of Object.entries(tables)) {
            if (Object.prototype.hasOwnProperty.call(base.lootTables, key)) {
                throw new Error(`Duplicate id "${key}" (${BASE_SOURCE} and ${mod.id})`);
            }
            if (!recordIdOk(mod.id, key)) {
                throw new Error(`${mod.id}: id "${key}" is outside the mod namespace`);
            }
            base.lootTables[key] = table;
        }
        return base;
    }

    function thingId(store, id) {
        return !!(id && store.thingsById && store.thingsById[id]);
    }

    function itemId(store, id) {
        return !!(id && store.itemsById && store.itemsById[id]);
    }

    function techById(store) {
        return indexOf(store.techsList);
    }

    function validateRefs(store) {
        const techs = techById(store);
        for (const item of store.itemsList || []) {
            if (!item?.id || item._source === BASE_SOURCE) continue;
            const place = item.place?.thing;
            if (place && !thingId(store, place)) {
                throw new Error(`${item._source || BASE_SOURCE}: place.thing "${place}" does not exist`);
            }
            const recipe = item.recipe;
            if (!recipe || typeof recipe !== "object") continue;
            for (const [key, value] of Object.entries(recipe)) {
                if (/^[A-Z0-9_]+$/.test(key)) continue;
                if (!itemId(store, key)) {
                    throw new Error(`${item._source || BASE_SOURCE}: recipe ingredient "${key}" does not exist`);
                }
            }
            if (typeof recipe.REQUIRE_THING === "string" && !thingId(store, recipe.REQUIRE_THING)) {
                throw new Error(`${item._source}: place or station "${recipe.REQUIRE_THING}" does not exist`);
            }
            if (typeof recipe.REQUIRE_STATION === "string" && !thingId(store, recipe.REQUIRE_STATION)) {
                throw new Error(`${item._source}: place or station "${recipe.REQUIRE_STATION}" does not exist`);
            }
        }
        const claimed = new Map();
        for (const tech of store.techsList || []) {
            if (!tech?.id) continue;
            const fromMod = tech._source && tech._source !== BASE_SOURCE;
            for (const pre of tech.prereqs || []) {
                if (fromMod && !techs[pre]) {
                    throw new Error(`${tech._source}: prereq "${pre}" does not exist`);
                }
            }
            for (const id of tech.unlocks?.items || []) {
                if (fromMod && !itemId(store, id)) {
                    throw new Error(`${tech._source}: unlocks.items "${id}" does not exist`);
                }
                if (claimed.has(id)) {
                    if (fromMod) {
                        throw new Error(`${tech._source}: unlocks.items "${id}" is already claimed by ${claimed.get(id)}`);
                    }
                    continue;
                }
                claimed.set(id, tech.id);
            }
        }
    }

    function linkTechChildren(store) {
        const techs = techById(store);
        for (const tech of store.techsList || []) {
            if (!tech?.id || tech._source === BASE_SOURCE) continue;
            for (const pre of tech.prereqs || []) {
                const parent = techs[pre];
                if (!parent) continue;
                if (!Array.isArray(parent.children)) parent.children = [];
                if (!parent.children.includes(tech.id)) parent.children.push(tech.id);
            }
        }
    }

    function normalizePack(raw, gameVersion) {
        const manifest = raw.manifest || {};
        const id = assertManifest(manifest, raw.label || manifest.id || "mod");
        assertGameVersion(id, manifest.gameVersion, gameVersion);
        if (raw.hasScripts && raw.simScriptBytes == null) {
            throw new Error(`${id}: script mods are not enabled`);
        }
        qualifyData(id, raw.data || {});
        return {
            id,
            label: raw.label || id,
            loadPriority: Number.isFinite(Number(manifest.loadPriority)) ? Number(manifest.loadPriority) : 0,
            dependencies: manifest.dependencies.slice(),
            textureBase: raw.textureBase || `mods/${id}`,
            textureFiles: raw.textureFiles && typeof raw.textureFiles === "object" ? raw.textureFiles : null,
            data: normalizeData(raw.data || {})
        };
    }

    function normalizeData(data) {
        const out = {};
        if (Array.isArray(data.items)) out.items = data.items;
        if (Array.isArray(data.things)) out.things = data.things;
        if (Array.isArray(data.techs)) out.techs = data.techs;
        if (Array.isArray(data.mobs)) out.mobs = data.mobs;
        if (data.bodyPlans && typeof data.bodyPlans === "object") out.bodyPlans = data.bodyPlans;
        if (data.injuries && typeof data.injuries === "object") out.injuries = data.injuries;
        if (data.hediffs && typeof data.hediffs === "object") out.hediffs = data.hediffs;
        if (data.structures && typeof data.structures === "object") out.structures = data.structures;
        return out;
    }

    function mergePacks(store, structures, packs, gameVersion) {
        const ordered = orderMods(packs.map((pack) => normalizePack(pack, gameVersion)));
        let nextStructures = structures;
        for (const mod of ordered) {
            mergeLists(store, mod);
            mergeMaps(store, mod);
            nextStructures = mergeStructures(nextStructures, mod);
        }
        validateRefs(store);
        linkTechChildren(store);
        return nextStructures;
    }

    function readJson(fs, file) {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }

    function fileExists(fs, file) {
        try {
            return fs.existsSync(file);
        } catch (_) {
            return false;
        }
    }

    function readGameVersion(rootDir) {
        const fs = require("fs");
        const path = require("path");
        const file = path.join(rootDir, "version.json");
        return readJson(fs, file).version;
    }

    function idSelected(enabledIds, id) {
        if (!Array.isArray(enabledIds)) return true;
        return enabledIds.includes(id);
    }

    function loadPacksFromDisk(modsDir, gameVersion, enabledIds) {
        const fs = require("fs");
        const path = require("path");
        if (!fileExists(fs, modsDir)) return [];
        const packs = [];
        for (const ent of fs.readdirSync(modsDir, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            const abs = path.join(modsDir, ent.name);
            const manifestFile = path.join(abs, "mod.json");
            if (!fileExists(fs, manifestFile)) continue;
            let manifest;
            try {
                manifest = readJson(fs, manifestFile);
            } catch (err) {
                if (Array.isArray(enabledIds)) continue;
                throw new Error(`${ent.name}: mod.json ${err.message}`);
            }
            if (!idSelected(enabledIds, manifest && manifest.id)) continue;
            const data = {};
            for (const name of DATA_FILES) {
                const file = path.join(abs, "data", name);
                if (!fileExists(fs, file)) continue;
                const key = name.replace(/\.json$/, "");
                try {
                    data[key] = readJson(fs, file);
                } catch (err) {
                    throw new Error(`${manifest.id || ent.name}: ${name} ${err.message}`);
                }
            }
            const simFile = path.join(abs, "sim", "index.js");
            const clientFile = path.join(abs, "client", "index.js");
            const hasClientScript = !!(manifest.client || fileExists(fs, clientFile));
            const clientScriptUrl = hasClientScript ? `mods/${ent.name}/client/index.js` : "";
            let simScriptBytes = null;
            if (manifest.sim || fileExists(fs, simFile)) {
                if (!fileExists(fs, simFile)) {
                    throw new Error(`${manifest.id || ent.name}: sim script is missing`);
                }
                simScriptBytes = fs.readFileSync(simFile);
            }
            packs.push({
                manifest,
                data,
                label: abs,
                textureBase: `mods/${ent.name}`,
                hasClientScript,
                clientScriptUrl,
                simScriptBytes,
                simScriptPath: simScriptBytes ? simFile : ""
            });
            if (gameVersion) assertGameVersion(manifest.id || ent.name, manifest.gameVersion, gameVersion);
        }
        return packs;
    }

    /**
     * Sim mods only. A clientOnly mod, or a mod with no data and no sim script,
     * is omitted. Version stays on this list; it is not a per-mod content hash.
     */
    function simModsFromPacks(packs) {
        const mods = [];
        for (const pack of packs || []) {
            const manifest = pack.manifest || {};
            if (!manifest.id || manifest.clientOnly === true) continue;
            const data = pack.data || {};
            const hasData = Object.keys(data).some((key) => data[key] != null);
            const hasSim = pack.simScriptBytes != null || !!manifest.sim;
            if (!hasData && !hasSim) continue;
            mods.push({
                id: String(manifest.id),
                version: String(manifest.version == null ? "" : manifest.version)
            });
        }
        mods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return mods;
    }

    function applyDisk(store, structures, opts) {
        const root = opts.root;
        const modsDir = opts.modsDir;
        const version = readGameVersion(root);
        let packs = loadPacksFromDisk(modsDir, version, opts.enabledIds);
        if (Array.isArray(opts.extraPacks)) packs = packs.concat(opts.extraPacks);
        const mods = simModsFromPacks(packs);
        if (!packs.length) return { structures, mods, packs };
        return { structures: mergePacks(store, structures, packs, version), mods, packs };
    }

    return {
        MOD_ID_RE,
        BASE_SOURCE,
        DATA_FILES,
        recordIdOk,
        qualifyName,
        qualifyData,
        gameVersionMatches,
        assertGameVersion,
        assertManifest,
        orderMods,
        stampCore,
        mergePacks,
        readGameVersion,
        loadPacksFromDisk,
        simModsFromPacks,
        applyDisk
    };
});

/**
 * Resolved content. Core files, then mod data, then finalize.
 * Phaser-free except publishToScene / queueTextures (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(
            require("../DataStore"),
            require("../structures"),
            require("../research"),
            require("./loader"),
            require("./hash"),
            require("./actions")
        );
    } else {
        root.Content = factory(root.DataStore, root.Structures, root.Research, root.ModLoader, root.ModHash, root.ModActions);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DataStore, Structures, Research, Loader, Hash, Actions) {
    let _finalized = false;
    let _structures = null;
    let _simMods = [];
    let _scriptRecords = [];
    let _clientScripts = [];
    let _scriptsExecuted = false;
    let _textureAliases = Object.create(null);
    let _textureBases = Object.create(null);

    function repoRoot() {
        const path = require("path");
        return path.resolve(__dirname, "../..");
    }

    function loadStructuresFromDisk(rootDir) {
        const fs = require("fs");
        const path = require("path");
        const root = rootDir || repoRoot();
        const cfg = JSON.parse(fs.readFileSync(path.join(root, "data", "Structures.json"), "utf8"));
        _structures = cfg;
        Structures?.loadConfig?.(cfg);
        return cfg;
    }

    function sceneHasCore(scene) {
        const bodyPlans = scene?.cache?.json?.get?.("bodyPlans");
        return !!(bodyPlans && Object.keys(bodyPlans).length);
    }

    /**
     * Fill the store from core files, or from a scene cache only when not yet finalized.
     * Does not load mod folders.
     */
    function loadCore(opts = {}) {
        if (_finalized) return DataStore;
        if (sceneHasCore(opts.scene)) {
            DataStore.initFromPhaserScene(opts.scene);
            const structures = opts.scene.cache.json.get("structures");
            if (structures) {
                _structures = structures;
                Structures?.loadConfig?.(structures);
            }
            Loader?.stampCore?.(DataStore._store, _structures);
            return DataStore;
        }
        const missingTechs = !DataStore._store?.techsList?.length;
        if (!DataStore.isReady() || missingTechs) {
            DataStore.loadFromDisk(opts.root || repoRoot());
            loadStructuresFromDisk(opts.root);
        } else if (!_structures) {
            loadStructuresFromDisk(opts.root);
        }
        Loader?.stampCore?.(DataStore._store, _structures);
        return DataStore;
    }

    function canReadModsFromDisk() {
        return typeof process !== "undefined"
            && !!process.versions?.node
            && typeof require === "function"
            && typeof window === "undefined";
    }

    function modsDirFrom(opts) {
        if (opts.modsDir) return opts.modsDir;
        const path = require("path");
        return path.join(opts.root || repoRoot(), "mods");
    }

    const CORE_FILES = [
        ["bodyPlans", "BodyPlans.json"],
        ["injuries", "Injuries.json"],
        ["hediffs", "Hediffs.json"],
        ["items", "Items.json"],
        ["mobs", "Mobs.json"],
        ["things", "Things.json"],
        ["techs", "Techs.json"],
        ["structures", "Structures.json"]
    ];

    async function fetchJson(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load ${url}`);
        return res.json();
    }

    function toUint8(bytes) {
        if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
        return new Uint8Array(bytes);
    }

    /**
     * Fetch sim/index.js as raw bytes. A missing file is not a script.
     * manifest.sim with no file still fails. client/index.js is recorded, not executed.
     */
    async function browserScriptInfo(base, manifest) {
        const id = manifest?.id || base;
        const simRes = await fetch(`${base}/sim/index.js`);
        let simScriptBytes = null;
        if (simRes.ok) simScriptBytes = new Uint8Array(await simRes.arrayBuffer());
        else if (manifest?.sim) throw new Error(`${id}: sim script is missing`);
        let hasClientScript = !!manifest?.client;
        if (!hasClientScript) {
            const clientRes = await fetch(`${base}/client/index.js`);
            hasClientScript = clientRes.ok;
        }
        return {
            simScriptBytes,
            hasClientScript,
            clientScriptUrl: hasClientScript ? `${base}/client/index.js` : "",
            simScriptPath: simScriptBytes ? `${base}/sim/index.js` : ""
        };
    }

    function orderedClientScripts(packs) {
        const light = [];
        for (const pack of packs || []) {
            const manifest = pack.manifest || {};
            if (!manifest.id || manifest.clientOnly === true) continue;
            light.push({
                id: String(manifest.id),
                label: pack.label || manifest.id,
                loadPriority: Number.isFinite(Number(manifest.loadPriority)) ? Number(manifest.loadPriority) : 0,
                dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies.slice() : [],
                clientScriptUrl: pack.clientScriptUrl || ""
            });
        }
        if (!light.length) return [];
        return Loader.orderMods(light).filter((row) => row.clientScriptUrl);
    }

    function orderedSimScripts(packs) {
        const light = [];
        for (const pack of packs || []) {
            const manifest = pack.manifest || {};
            if (!manifest.id || manifest.clientOnly === true) continue;
            light.push({
                id: String(manifest.id),
                label: pack.label || manifest.id,
                loadPriority: Number.isFinite(Number(manifest.loadPriority)) ? Number(manifest.loadPriority) : 0,
                dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies.slice() : [],
                bytes: pack.simScriptBytes == null ? null : toUint8(pack.simScriptBytes),
                filename: pack.simScriptPath || ""
            });
        }
        if (!light.length) return [];
        return Loader.orderMods(light).filter((row) => row.bytes);
    }

    function rememberScriptsSync(packs) {
        _scriptRecords = orderedSimScripts(packs).map((row) => ({
            modId: row.id,
            bytes: row.bytes,
            filename: row.filename,
            sha256: Hash.sha256Bytes(row.bytes)
        }));
        _clientScripts = orderedClientScripts(packs).map((row) => ({
            modId: row.id,
            url: row.clientScriptUrl
        }));
        _scriptsExecuted = false;
    }

    async function rememberScriptsAsync(packs) {
        const records = [];
        for (const row of orderedSimScripts(packs)) {
            records.push({
                modId: row.id,
                bytes: row.bytes,
                filename: row.filename,
                sha256: await Hash.sha256BytesSubtle(row.bytes)
            });
        }
        _scriptRecords = records;
        _clientScripts = orderedClientScripts(packs).map((row) => ({
            modId: row.id,
            url: row.clientScriptUrl
        }));
        _scriptsExecuted = false;
    }

    function clientScripts() {
        return _clientScripts.map((row) => ({ modId: row.modId, url: row.url }));
    }

    function jobsApi() {
        if (typeof ModJobs !== "undefined") return ModJobs;
        try {
            if (typeof require === "function") return require("./jobs");
        } catch (_) { /* optional */ }
        return null;
    }

    function withQualified(modId, spec, field) {
        if (!spec || spec[field] == null || typeof Loader.qualifyName !== "function") return spec;
        const next = Loader.qualifyName(modId, spec[field]);
        if (next === spec[field]) return spec;
        return Object.assign({}, spec, { [field]: next });
    }

    function scriptApi(modId) {
        return {
            modId,
            id(name) {
                return Loader.qualifyName(modId, name);
            },
            registerAction(spec) {
                Actions.registerAction(modId, withQualified(modId, spec, "type"));
            },
            registerJob(spec) {
                const Jobs = jobsApi();
                if (!Jobs) throw new Error("Job registry is not loaded");
                Jobs.registerJob(modId, withQualified(modId, spec, "id"));
            },
            registerScatter(spec) {
                const Scatters = scattersApi();
                if (!Scatters) throw new Error("Scatter registry is not loaded");
                Scatters.register(modId, withQualified(modId, spec, "id"));
            }
        };
    }

    function scattersApi() {
        if (typeof ModScatters !== "undefined") return ModScatters;
        try {
            if (typeof require === "function") return require("./scatters");
        } catch (_) { /* optional */ }
        return null;
    }

    function idSelected(enabledIds, id) {
        if (!Array.isArray(enabledIds)) return true;
        return enabledIds.includes(id);
    }

    function rememberTextureAliases(packs) {
        for (const pack of packs || []) {
            const id = pack.manifest && pack.manifest.id;
            const files = pack.textureFiles;
            if (!id || !files) continue;
            for (const rel of Object.keys(files)) {
                _textureAliases[`mods/${id}/${rel}`] = files[rel];
            }
        }
    }

    function rememberTextureBases(packs) {
        for (const pack of packs || []) {
            const id = (pack.manifest && pack.manifest.id) || pack.id;
            if (!id || !pack.textureBase) continue;
            _textureBases[id] = pack.textureBase;
        }
    }

    function textureAlias(url) {
        if (!url) return url;
        return _textureAliases[url] || url;
    }

    function modAsset(modId, url) {
        if (!url) return url;
        if (/^(https?:|blob:|app:|data:)/.test(url) || url.startsWith("mods/") || url.startsWith("/")) {
            return textureAlias(url);
        }
        const base = _textureBases[modId] || `mods/${modId}`;
        return textureAlias(`${base}/${String(url).replace(/^\//, "")}`);
    }

    function registerPackScatters(packs) {
        const Scatters = scattersApi();
        if (!Scatters) return;
        for (const pack of packs || []) {
            const rows = pack.data?.scatters;
            if (!Array.isArray(rows)) continue;
            const modId = pack.manifest?.id || pack.id || "";
            for (const row of rows) Scatters.register(modId, row);
        }
    }

    function invokeNode(row) {
        const Module = require("module");
        const path = require("path");
        const filename = row.filename
            ? path.resolve(row.filename)
            : path.join(repoRoot(), "mods", row.modId, "sim", "index.js");
        const compiled = new Module(filename);
        compiled.filename = filename;
        compiled.paths = Module._nodeModulePaths(path.dirname(filename));
        compiled._compile(Buffer.from(row.bytes).toString("utf8"), filename);
        const factory = compiled.exports;
        if (typeof factory !== "function") {
            throw new Error(`${row.modId}: sim script did not export a factory`);
        }
        factory(scriptApi(row.modId));
    }

    async function invokeBrowser(row) {
        const blob = new Blob([row.bytes], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        const script = document.createElement("script");
        script.async = false;
        script.src = url;
        try {
            await new Promise((resolve, reject) => {
                script.onload = () => resolve();
                script.onerror = () => reject(new Error(`${row.modId}: sim script failed to load`));
                (document.head || document.documentElement).appendChild(script);
            });
            const factory = globalThis.__cpPendingSimFactory;
            delete globalThis.__cpPendingSimFactory;
            if (typeof factory !== "function") {
                throw new Error(`${row.modId}: sim script did not export a factory`);
            }
            factory(scriptApi(row.modId));
        } finally {
            script.remove();
            URL.revokeObjectURL(url);
        }
    }

    function loadSimScriptsNode() {
        try {
            for (const row of _scriptRecords) invokeNode(row);
            _scriptsExecuted = true;
        } catch (err) {
            Actions?.reset?.();
            throw err;
        }
    }

    async function loadSimScriptsBrowser() {
        try {
            for (const row of _scriptRecords) await invokeBrowser(row);
            _scriptsExecuted = true;
        } catch (err) {
            Actions?.reset?.();
            delete globalThis.__cpPendingSimFactory;
            throw err;
        }
    }

    /**
     * Execute host sim scripts. Remote clients must not call this.
     * Node compiles the hashed bytes. The browser runs those same bytes from a Blob.
     */
    function loadSimScripts() {
        if (_scriptsExecuted) return;
        if (!_scriptRecords.length) {
            _scriptsExecuted = true;
            return;
        }
        if (typeof document !== "undefined" && typeof document.createElement === "function") {
            return loadSimScriptsBrowser();
        }
        loadSimScriptsNode();
    }

    /**
     * Raw sim-script bytes for hashing. Does not execute the factory.
     */
    function readSimScriptBytes(mod) {
        const id = typeof mod === "string" ? mod : mod?.id;
        const row = _scriptRecords.find((script) => script.modId === id);
        if (!row) throw new Error(`No sim script for ${id}`);
        return new Uint8Array(row.bytes);
    }

    async function loadCoreFromFetch() {
        const loaded = {};
        await Promise.all(CORE_FILES.map(async ([key, name]) => {
            loaded[key] = await fetchJson(`data/${name}`);
        }));
        DataStore.initFromData({
            bodyPlans: loaded.bodyPlans,
            injuries: loaded.injuries,
            hediffs: loaded.hediffs,
            items: loaded.items,
            mobs: loaded.mobs,
            things: loaded.things,
            techs: loaded.techs
        });
        _structures = loaded.structures;
        Structures?.loadConfig?.(_structures);
        Loader?.stampCore?.(DataStore._store, _structures);
    }

    async function packsFromBrowser(opts) {
        const enabledIds = opts && opts.enabledIds;
        const api = typeof globalThis !== "undefined" ? globalThis.cavePaintings : null;
        if (api?.listMods && api?.readMod) {
            const listed = await api.listMods();
            const packs = [];
            for (const row of listed || []) {
                if (row?.error || !row?.id) continue;
                if (!idSelected(enabledIds, row.id)) continue;
                const manifest = JSON.parse(await api.readMod(row.id, "mod.json"));
                const data = {};
                for (const name of Loader.DATA_FILES) {
                    let text = null;
                    try {
                        text = await api.readMod(row.id, `data/${name}`);
                    } catch (err) {
                        if (!/not found/i.test(String(err && err.message || err))) throw err;
                    }
                    if (text == null || text === "") continue;
                    data[name.replace(/\.json$/, "")] = JSON.parse(text);
                }
                const scriptInfo = await browserScriptInfo(`mods/${row.dir || manifest.id}`, manifest);
                packs.push({
                    manifest,
                    data,
                    label: row.id,
                    textureBase: `mods/${row.dir || manifest.id}`,
                    hasClientScript: scriptInfo.hasClientScript,
                    clientScriptUrl: scriptInfo.clientScriptUrl,
                    simScriptBytes: scriptInfo.simScriptBytes,
                    simScriptPath: scriptInfo.simScriptPath
                });
            }
            return packs;
        }
        let catalog = { mods: [] };
        try {
            const res = await fetch("mods/catalog.json");
            if (res.ok) catalog = await res.json();
        } catch (_) {
            catalog = { mods: [] };
        }
        const packs = [];
        for (const row of catalog.mods || []) {
            const base = `mods/${row.dir}`;
            const manifestRes = await fetch(`${base}/mod.json`);
            // A catalog row whose folder is gone is not installed. Skip it.
            // A present mod.json that is not valid JSON still rejects this fetch.
            if (!manifestRes.ok) continue;
            let manifest;
            try {
                manifest = await manifestRes.json();
            } catch (err) {
                if (Array.isArray(enabledIds)) continue;
                throw err;
            }
            if (!idSelected(enabledIds, manifest && manifest.id)) continue;
            const data = {};
            for (const name of Loader.DATA_FILES) {
                const res = await fetch(`${base}/data/${name}`);
                if (!res.ok) continue;
                data[name.replace(/\.json$/, "")] = await res.json();
            }
            const scriptInfo = await browserScriptInfo(base, manifest);
            packs.push({
                manifest,
                data,
                label: row.dir,
                textureBase: base,
                hasClientScript: scriptInfo.hasClientScript,
                clientScriptUrl: scriptInfo.clientScriptUrl,
                simScriptBytes: scriptInfo.simScriptBytes,
                simScriptPath: scriptInfo.simScriptPath
            });
        }
        return packs;
    }

    async function bootFromBrowser(opts) {
        if (!DataStore.isReady() || !DataStore._store?.techsList?.length) {
            if (sceneHasCore(opts.scene)) loadCore(opts);
            else await loadCoreFromFetch();
        } else {
            Loader?.stampCore?.(DataStore._store, _structures);
        }
        const version = await fetchJson("version.json");
        let packs = await packsFromBrowser(opts);
        if (Array.isArray(opts.extraPacks)) packs = packs.concat(opts.extraPacks);
        _simMods = Loader.simModsFromPacks(packs);
        if (packs.length) {
            _structures = Loader.mergePacks(DataStore._store, _structures, packs, version.version);
        }
        await rememberScriptsAsync(packs);
        registerPackScatters(packs);
        rememberTextureAliases(packs);
        rememberTextureBases(packs);
        return finalize();
    }

    function snapshot() {
        const store = DataStore._store || {};
        return {
            items: store.itemsList || [],
            things: store.thingsList || [],
            techs: store.techsList || [],
            mobs: store.mobsList || [],
            bodyPlans: store.bodyPlans || {},
            injuries: store.injuries || {},
            hediffs: store.hediffs || {},
            structures: _structures,
            scatters: scattersApi()?.document?.() || [],
            mods: _simMods.map((mod) => ({ id: mod.id, version: mod.version })),
            scripts: _scriptRecords.map((row) => ({ modId: row.modId, sha256: row.sha256 }))
        };
    }

    function simDocument() {
        return Hash.simDocument(snapshot());
    }

    function simHash() {
        return Hash.simHash(snapshot());
    }

    function simMods() {
        return _simMods.map((mod) => ({ id: mod.id, version: mod.version }));
    }

    async function digestCanonical(canonical) {
        if (typeof process !== "undefined" && process.versions?.node && typeof require === "function") {
            return Hash.sha256Hex(canonical);
        }
        return Hash.sha256Subtle(canonical);
    }

    async function authContent() {
        const snap = snapshot();
        const canonical = Hash.canonicalString(Hash.simDocument(snap));
        return {
            hash: await digestCanonical(canonical),
            mods: snap.mods
        };
    }

    /**
     * Missing client content is base-game only (no sim mods).
     * A hash match joins. Otherwise the reason names missing, extra, and version mismatches.
     */
    function acceptJoin(clientContent) {
        const hostMods = simMods();
        if (clientContent == null) {
            if (!hostMods.length) return { ok: true, reason: "" };
            return { ok: false, reason: Hash.modsCompatible(hostMods, []).reason };
        }
        if (clientContent.hash === simHash()) return { ok: true, reason: "" };
        const listed = Hash.modsCompatible(hostMods, clientContent.mods || []);
        if (!listed.ok) return listed;
        return { ok: false, reason: "Mod mismatch. Content hash does not match." };
    }

    function finalize() {
        if (_finalized) return DataStore;
        if (!DataStore.isReady()) {
            throw new Error("Content.finalize: core data is not loaded");
        }
        if (!Hash) throw new Error("Mod hash is not loaded");
        Hash.simDocument(snapshot());
        if (typeof Research !== "undefined" && Research.setTechs) {
            Research.setTechs(DataStore._store.techsList || []);
        }
        if (_structures) Structures?.loadConfig?.(_structures);
        Structures?.lockConfig?.();
        DataStore.bumpGeneration();
        _finalized = true;
        return DataStore;
    }

    /**
     * Load core, then mods unless `mods: false`, then finalize.
     * Node returns the store. The browser returns a Promise.
     * A second call returns the already-finalized store.
     */
    function boot(opts = {}) {
        if (_finalized) return DataStore;
        _textureAliases = Object.create(null);
        _textureBases = Object.create(null);
        if (!Loader) throw new Error("Mod loader is not loaded");
        if (opts.mods !== false && !canReadModsFromDisk()) {
            return bootFromBrowser(opts);
        }
        loadCore(opts);
        if (opts.mods !== false) {
            const applied = Loader.applyDisk(DataStore._store, _structures, {
                root: opts.root || repoRoot(),
                modsDir: modsDirFrom(opts),
                enabledIds: opts.enabledIds,
                extraPacks: opts.extraPacks
            });
            _structures = applied.structures;
            _simMods = applied.mods || [];
            rememberScriptsSync(applied.packs || []);
            registerPackScatters(applied.packs || []);
            rememberTextureAliases(applied.packs || []);
            rememberTextureBases(applied.packs || []);
        } else {
            _simMods = [];
            _scriptRecords = [];
            _clientScripts = [];
        }
        return finalize();
    }

    function isFinalized() {
        return _finalized;
    }

    function putJson(json, key, value) {
        if (!json || value == null) return;
        if (typeof json.exists === "function" && json.exists(key) && typeof json.remove === "function") {
            json.remove(key);
        } else if (typeof json.remove === "function" && json.has?.(key)) {
            json.remove(key);
        }
        json.add(key, value);
    }

    /** Copy finalized DataStore into the Phaser cache. Cache writes do not come back. */
    function publishToScene(scene) {
        if (!_finalized) boot({ mods: false, scene });
        const json = scene?.cache?.json;
        if (!json) return DataStore;
        const store = DataStore._store;
        putJson(json, "items", store.itemsList || []);
        putJson(json, "things", store.thingsList || []);
        putJson(json, "techs", store.techsList || []);
        putJson(json, "mobs", store.mobsList || []);
        putJson(json, "bodyPlans", store.bodyPlans || {});
        putJson(json, "injuries", store.injuries || {});
        putJson(json, "hediffs", store.hediffs || {});
        if (_structures) {
            putJson(json, "structures", _structures);
            Structures?.loadConfig?.(_structures);
        }
        return DataStore;
    }

    function placeApi() {
        if (typeof globalThis !== "undefined" && globalThis.Place?.thingImageLoads) return globalThis.Place;
        try {
            return require("../place");
        } catch (_) {
            return null;
        }
    }

    function queueImage(scene, key, url) {
        if (!key || !url) return;
        // Skip a load that is already cached or already queued. This is not registration.
        if (scene.textures?.exists?.(key)) return;
        scene.__cpQueuedTextures = scene.__cpQueuedTextures || new Set();
        if (scene.__cpQueuedTextures.has(key)) return;
        scene.__cpQueuedTextures.add(key);
        scene.load.image(key, url);
    }

    /**
     * Queue item and thing textures that are not already in the cache.
     * Safe to call on SceneBase.preload's early return.
     */
    function queueTextures(scene) {
        if (!scene?.load || !_finalized) return;
        const items = DataStore._store?.itemsList || [];
        for (const it of items) {
            if (!it?.key && !it?._textureUrl) continue;
            const key = it.key || it.id;
            queueImage(scene, key, it._textureUrl || (it.key ? `assets/items/${it.key}.png` : null));
        }
        const things = DataStore._store?.thingsList || [];
        const Place = placeApi();
        for (const t of things) {
            if (!t) continue;
            if (t._textureUrl) {
                queueImage(scene, t.key || t.id, t._textureUrl);
                continue;
            }
            const loads = Place?.thingImageLoads
                ? Place.thingImageLoads(t)
                : (t.key ? [{ key: t.key, path: `assets/things/${t.key}.png` }] : []);
            for (const spec of loads) {
                if (!spec?.key || scene.textures?.exists?.(spec.key)) continue;
                if (spec.spritesheet) {
                    scene.load.spritesheet(spec.key, spec.path, {
                        frameWidth: spec.frameWidth ?? 16,
                        frameHeight: spec.frameHeight ?? 16
                    });
                } else {
                    scene.load.image(spec.key, spec.path);
                }
            }
        }
        const kinds = textureKinds();
        for (const tex of kinds?.textureList?.() || []) {
            queueImage(scene, tex.key, tex.url);
        }
    }

    function textureKinds() {
        if (typeof ModKinds !== "undefined") return ModKinds;
        try {
            if (typeof require === "function") return require("./kinds");
        } catch (_) { /* optional */ }
        return null;
    }

    return {
        boot,
        finalize,
        loadCore,
        isFinalized,
        publishToScene,
        queueTextures,
        snapshot,
        simDocument,
        simHash,
        simMods,
        authContent,
        acceptJoin,
        loadSimScripts,
        readSimScriptBytes,
        clientScripts,
        textureAlias,
        modAsset,
        get structures() { return _structures; }
    };
});

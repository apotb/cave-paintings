/**
 * Discovered mods versus the enabled id list.
 * Does not merge content and does not execute scripts.
 * Browser: IndexedDB cave_paintings_mods. Electron: mods-enabled.json via preload.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("../../shared/mods/loader"));
    } else {
        root.ModStore = factory(root.ModLoader);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Loader) {
    const DB_NAME = "cave_paintings_mods";
    const DB_VERSION = 1;

    function copyIds(ids) {
        return (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string");
    }

    function sameIds(a, b) {
        const left = copyIds(a).slice().sort();
        const right = copyIds(b).slice().sort();
        if (left.length !== right.length) return false;
        return left.every((id, i) => id === right[i]);
    }

    function rowById(rows, id) {
        return (rows || []).find((row) => row && row.id === id) || null;
    }

    function light(row) {
        return {
            id: row.id,
            label: row.dir || row.id,
            loadPriority: Number.isFinite(Number(row.loadPriority)) ? Number(row.loadPriority) : 0,
            dependencies: Array.isArray(row.dependencies) ? row.dependencies.slice() : []
        };
    }

    function toBytes(value) {
        if (value instanceof Uint8Array) return new Uint8Array(value);
        if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(value)) {
            return new Uint8Array(value);
        }
        if (typeof value === "string") return new TextEncoder().encode(value);
        throw new Error("missing bytes");
    }

    function decodeText(bytes) {
        return new TextDecoder().decode(toBytes(bytes));
    }

    function blobUrl(bytes, type) {
        if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
            return "";
        }
        return URL.createObjectURL(new Blob([toBytes(bytes)], { type }));
    }

    function memoryAdapter() {
        const packages = new Map();
        let ids = [];
        function clonePkg(pkg) {
            return {
                id: pkg.id,
                manifest: pkg.manifest,
                files: (pkg.files || []).map((file) => ({
                    path: file.path,
                    bytes: toBytes(file.bytes)
                }))
            };
        }
        return {
            async loadEnabled() {
                return { ids: ids.slice() };
            },
            async saveEnabled(next) {
                ids = copyIds(next);
                return { ids: ids.slice() };
            },
            async listPackages() {
                return [...packages.values()].map(clonePkg);
            },
            async getPackage(id) {
                const pkg = packages.get(id);
                return pkg ? clonePkg(pkg) : null;
            },
            async putPackage(pkg) {
                packages.set(pkg.id, clonePkg(pkg));
            },
            async removePackage(id) {
                packages.delete(id);
            }
        };
    }

    function electronAdapter(api) {
        return {
            async loadEnabled() {
                const body = await api.getEnabledMods();
                return { ids: copyIds(body && body.ids) };
            },
            async saveEnabled(ids) {
                const body = await api.setEnabledMods({ ids: copyIds(ids) });
                return { ids: copyIds(body && body.ids) };
            },
            async listPackages() {
                return [];
            },
            async getPackage() {
                return null;
            },
            async putPackage() {
                throw new Error("Upload a mod from the browser");
            },
            async removePackage() {
                throw new Error("Upload a mod from the browser");
            }
        };
    }

    function idbAdapter() {
        function openDb() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains("packages")) {
                        db.createObjectStore("packages", { keyPath: "id" });
                    }
                    if (!db.objectStoreNames.contains("enabled")) {
                        db.createObjectStore("enabled", { keyPath: "key" });
                    }
                };
                req.onsuccess = () => resolve(req.result);
            });
        }
        function request(store, mode, fn) {
            return openDb().then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction(store, mode);
                const result = fn(tx.objectStore(store));
                result.onerror = () => reject(result.error || new Error("IndexedDB request failed"));
                tx.oncomplete = () => resolve(result.result);
                tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
            }));
        }
        return {
            async loadEnabled() {
                const row = await request("enabled", "readonly", (store) => store.get("ids"));
                return { ids: copyIds(row && row.ids) };
            },
            async saveEnabled(ids) {
                const next = copyIds(ids);
                await request("enabled", "readwrite", (store) => store.put({ key: "ids", ids: next }));
                return { ids: next.slice() };
            },
            async listPackages() {
                const rows = await request("packages", "readonly", (store) => store.getAll());
                return rows || [];
            },
            async getPackage(id) {
                return request("packages", "readonly", (store) => store.get(id));
            },
            async putPackage(pkg) {
                await request("packages", "readwrite", (store) => store.put(pkg));
            },
            async removePackage(id) {
                await request("packages", "readwrite", (store) => store.delete(id));
            }
        };
    }

    function defaultAdapter() {
        const api = typeof globalThis !== "undefined" ? globalThis.cavePaintings : null;
        if (api && typeof api.getEnabledMods === "function") return electronAdapter(api);
        return idbAdapter();
    }

    function trySetEnabled(rows, enabledIds, id, on) {
        const current = copyIds(enabledIds);
        const row = rowById(rows, id);
        if (!row) return { ok: false, ids: current, reason: `Missing mod ${id}` };
        if (on) {
            if (row.error) return { ok: false, ids: current, reason: row.error };
            if (current.includes(id)) return { ok: true, ids: current, reason: "" };
            const next = current.concat(id);
            const missing = [];
            for (const dep of row.dependencies || []) {
                if (typeof dep === "string" && !next.includes(dep) && !missing.includes(dep)) missing.push(dep);
            }
            if (missing.length) {
                return {
                    ok: false,
                    ids: current,
                    reason: `Missing mod dependency ${missing.map((dep) => `"${dep}"`).join(", ")}`
                };
            }
            const selected = [];
            for (const modId of next) {
                const known = rowById(rows, modId);
                if (!known || known.error) {
                    return { ok: false, ids: current, reason: `Missing mod ${modId}` };
                }
                selected.push(light(known));
            }
            try {
                Loader.orderMods(selected);
            } catch (err) {
                return { ok: false, ids: current, reason: err.message || String(err) };
            }
            return { ok: true, ids: next, reason: "" };
        }
        if (!current.includes(id)) return { ok: true, ids: current, reason: "" };
        const dependents = (rows || []).filter((other) => other
            && other.id
            && other.id !== id
            && current.includes(other.id)
            && Array.isArray(other.dependencies)
            && other.dependencies.includes(id));
        if (dependents.length) {
            return {
                ok: false,
                ids: current,
                reason: `Required by ${dependents.map((other) => other.id).join(", ")}`
            };
        }
        return { ok: true, ids: current.filter((modId) => modId !== id), reason: "" };
    }

    function preflight(rows, enabledIds) {
        const ids = copyIds(enabledIds);
        const selected = [];
        for (const id of ids) {
            const row = rowById(rows, id);
            if (!row) return { ok: false, reason: `Missing mod ${id}` };
            if (row.error) return { ok: false, reason: row.error };
            const missing = (row.dependencies || []).filter((dep) => typeof dep === "string" && !ids.includes(dep));
            if (missing.length) {
                return {
                    ok: false,
                    reason: `Missing mod dependency ${missing.map((dep) => `"${dep}"`).join(", ")}`
                };
            }
            selected.push(light(row));
        }
        try {
            Loader.orderMods(selected);
        } catch (err) {
            return { ok: false, reason: err.message || String(err) };
        }
        return { ok: true, reason: "" };
    }

    function rowStatus(row, enabledIds) {
        if (!row || row.error) return "Invalid";
        const ids = copyIds(enabledIds);
        const missing = (row.dependencies || []).filter((dep) => typeof dep === "string" && !ids.includes(dep));
        if (missing.length) return "Missing dependency";
        return ids.includes(row.id) ? "Enabled" : "Disabled";
    }

    function reloadRequired(bootedIds, savedIds) {
        if (bootedIds == null) return false;
        return !sameIds(bootedIds, savedIds);
    }

    function create(opts) {
        opts = opts || {};
        let adapter = opts.adapter || null;
        let gameVersion = opts.gameVersion || "";
        let bootedIds = null;
        let sessionIds = null;

        function useAdapter() {
            if (!adapter) adapter = defaultAdapter();
            return adapter;
        }

        async function version() {
            if (gameVersion) return gameVersion;
            try {
                const api = typeof globalThis !== "undefined" ? globalThis.cavePaintings : null;
                if (api && typeof api.getVersion === "function") {
                    const value = api.getVersion();
                    if (value) {
                        gameVersion = String(value);
                        return gameVersion;
                    }
                }
            } catch (_) { /* browser */ }
            if (typeof fetch === "function") {
                try {
                    const res = await fetch("version.json");
                    if (res.ok) {
                        const body = await res.json();
                        if (body && body.version) gameVersion = String(body.version);
                    }
                } catch (_) { /* no catalog host */ }
            }
            return gameVersion;
        }

        function annotate(row) {
            const next = Object.assign({ source: row.source || "installed", error: row.error || "" }, row);
            if (next.error) return next;
            try {
                Loader.assertManifest({
                    id: next.id,
                    dependencies: next.dependencies,
                    client: next.client
                }, next.dir || next.id || "mod");
                const actual = gameVersion;
                if (actual) Loader.assertGameVersion(next.id, next.gameVersion, actual);
            } catch (err) {
                next.error = err.message || String(err);
            }
            return next;
        }

        function rowFromManifest(manifest, source, dir) {
            return annotate({
                id: manifest && manifest.id,
                name: manifest && (manifest.name || manifest.id) || dir || "",
                version: manifest && manifest.version != null ? String(manifest.version) : "",
                description: manifest && manifest.description != null ? String(manifest.description) : "",
                gameVersion: manifest && manifest.gameVersion != null ? String(manifest.gameVersion) : "",
                dependencies: manifest && Array.isArray(manifest.dependencies) ? manifest.dependencies.slice() : [],
                loadPriority: manifest && Number.isFinite(Number(manifest.loadPriority)) ? Number(manifest.loadPriority) : 0,
                dir: dir || "",
                source
            });
        }

        async function discover() {
            await version();
            const rows = [];
            const api = typeof globalThis !== "undefined" ? globalThis.cavePaintings : null;
            if (api && typeof api.listMods === "function") {
                const listed = await api.listMods();
                for (const row of listed || []) rows.push(annotate(row));
            } else if (typeof fetch === "function") {
                let catalog = { mods: [] };
                try {
                    const res = await fetch("mods/catalog.json");
                    if (res.ok) catalog = await res.json();
                } catch (_) {
                    catalog = { mods: [] };
                }
                for (const entry of catalog.mods || []) {
                    const dir = entry && entry.dir;
                    if (!dir) continue;
                    const res = await fetch(`mods/${dir}/mod.json`);
                    if (!res.ok) continue;
                    try {
                        const manifest = await res.json();
                        rows.push(rowFromManifest(manifest, "installed", dir));
                    } catch (err) {
                        rows.push({
                            dir,
                            source: "installed",
                            error: `${dir}: mod.json ${err.message}`
                        });
                    }
                }
            }
            const packages = await useAdapter().listPackages();
            for (const pkg of packages || []) {
                const manifest = pkg && pkg.manifest;
                const row = rowFromManifest(manifest, "uploaded", "");
                const prior = rows.find((known) => known.id && known.id === row.id && !known.error);
                if (prior) {
                    row.error = `Duplicate mod id "${row.id}" (${prior.dir || prior.source} and upload)`;
                }
                rows.push(row);
            }
            return rows;
        }

        async function enabled() {
            const saved = await useAdapter().loadEnabled();
            if (sessionIds == null) sessionIds = copyIds(saved.ids);
            return saved;
        }

        function noteBoot(ids) {
            bootedIds = copyIds(ids);
            sessionIds = copyIds(ids);
        }

        function baselineIds() {
            if (bootedIds != null) return bootedIds;
            return sessionIds;
        }

        function needsReload(savedIds) {
            return reloadRequired(baselineIds(), savedIds);
        }

        async function setEnabled(ids) {
            const saved = await useAdapter().saveEnabled(copyIds(ids));
            return {
                ids: saved.ids.slice(),
                reloadRequired: reloadRequired(baselineIds(), saved.ids)
            };
        }

        async function enable(id, on) {
            const rows = await discover();
            const saved = await enabled();
            const result = trySetEnabled(rows, saved.ids, id, !!on);
            if (!result.ok) return result;
            const stored = await setEnabled(result.ids);
            return { ok: true, ids: stored.ids, reloadRequired: stored.reloadRequired, reason: "" };
        }

        async function entryBytes(entry) {
            if (entry && entry.bytes != null) return toBytes(entry.bytes);
            if (entry && typeof entry.arrayBuffer === "function") return new Uint8Array(await entry.arrayBuffer());
            throw new Error("missing bytes");
        }

        function entryPath(entry) {
            return String((entry && (entry.webkitRelativePath || entry.path || entry.name)) || "")
                .replace(/\\/g, "/")
                .replace(/^\/+/, "");
        }

        async function normalizeUpload(entries) {
            const raw = [];
            for (const entry of entries || []) {
                const rel = entryPath(entry);
                if (!rel || rel.split("/").includes("..")) throw new Error("Upload path is not allowed");
                raw.push({ path: rel, bytes: await entryBytes(entry) });
            }
            const manifests = raw.filter((file) => file.path === "mod.json" || file.path.endsWith("/mod.json"));
            if (!manifests.length) throw new Error("Upload needs one mod.json");
            if (manifests.length > 1) throw new Error("Add one mod at a time.");
            const modPath = manifests[0].path;
            const prefix = modPath.slice(0, modPath.length - "mod.json".length);
            if (prefix && raw.some((file) => file.path !== modPath && !file.path.startsWith(prefix))) {
                throw new Error("Upload needs one mod.json");
            }
            return raw.map((file) => ({ path: file.path.slice(prefix.length), bytes: file.bytes }));
        }

        async function addUpload(entries, discovered) {
            const files = await normalizeUpload(entries);
            const manifestFile = files.find((file) => file.path === "mod.json");
            let manifest;
            try {
                manifest = JSON.parse(decodeText(manifestFile.bytes));
            } catch (err) {
                throw new Error(`mod.json ${err.message}`);
            }
            Loader.assertManifest(manifest, manifest && manifest.id ? manifest.id : "upload");
            const actual = await version();
            if (actual) Loader.assertGameVersion(manifest.id, manifest.gameVersion, actual);
            const known = discovered || await discover();
            const other = (known || []).find((row) => row && row.id === manifest.id);
            if (other) {
                throw new Error(`Duplicate mod id "${manifest.id}" (${other.dir || other.source || "installed"} and upload)`);
            }
            const pkg = { id: manifest.id, manifest, files };
            await useAdapter().putPackage(pkg);
            return pkg;
        }

        async function remove(id) {
            const rows = await discover();
            const saved = await enabled();
            let ids = saved.ids;
            if (ids.includes(id)) {
                const result = trySetEnabled(rows, ids, id, false);
                if (!result.ok) return result;
                ids = result.ids;
                await setEnabled(ids);
            }
            await useAdapter().removePackage(id);
            const stored = await enabled();
            return {
                ok: true,
                ids: stored.ids,
                reloadRequired: reloadRequired(baselineIds(), stored.ids),
                reason: ""
            };
        }

        function packageToPack(pkg) {
            const data = {};
            const textureFiles = {};
            let simScriptBytes = null;
            let clientBytes = null;
            for (const file of pkg.files || []) {
                if (file.path.startsWith("data/") && file.path.endsWith(".json")) {
                    const key = file.path.slice("data/".length).replace(/\.json$/, "");
                    data[key] = JSON.parse(decodeText(file.bytes));
                } else if (file.path === "sim/index.js") {
                    simScriptBytes = toBytes(file.bytes);
                } else if (file.path === "client/index.js") {
                    clientBytes = toBytes(file.bytes);
                } else if (file.path.startsWith("assets/") && file.path.endsWith(".png")) {
                    const url = blobUrl(file.bytes, "image/png");
                    if (url) textureFiles[file.path] = url;
                }
            }
            return {
                manifest: pkg.manifest,
                data,
                label: pkg.id,
                textureBase: `mods/${pkg.id}`,
                textureFiles,
                hasClientScript: !!clientBytes,
                clientScriptUrl: clientBytes ? blobUrl(clientBytes, "text/javascript") : "",
                simScriptBytes,
                simScriptPath: simScriptBytes ? `mods/${pkg.id}/sim/index.js` : ""
            };
        }

        async function packsForBoot(ids) {
            const packs = [];
            for (const id of copyIds(ids)) {
                const pkg = await useAdapter().getPackage(id);
                if (!pkg) continue;
                packs.push(packageToPack(pkg));
            }
            return packs;
        }

        return {
            discover,
            enabled,
            setEnabled,
            enable,
            remove,
            addUpload,
            packsForBoot,
            preflight,
            trySetEnabled,
            noteBoot,
            needsReload,
            reloadRequired,
            rowStatus,
            version
        };
    }

    const live = create();
    live.create = create;
    live.memoryAdapter = memoryAdapter;
    live.trySetEnabled = trySetEnabled;
    live.preflight = preflight;
    live.rowStatus = rowStatus;
    live.reloadRequired = reloadRequired;
    return live;
});

/**
 * Thing kinds, panels, textures, and client event handlers.
 * Duplicate ids throw and name both sources. No last-write-wins.
 * Node + browser UMD. Client scripts are not executed here.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ModKinds = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const kinds = new Map();
    const panels = new Map();
    const textures = new Map();
    const events = [];

    function builtinThing(def) {
        if (!def) return false;
        return !!(def.lootable || def.campfire || def.storage || def.craftStation
            || def.settlement || def.figurine || def.sleep);
    }

    function kindFor(def) {
        if (!def || builtinThing(def)) return null;
        if (def.kind && kinds.has(def.kind)) return kinds.get(def.kind);
        if (def.id && kinds.has(def.id)) return kinds.get(def.id);
        return null;
    }

    function registerThingKind(modId, spec) {
        const source = String(modId || "");
        const id = spec?.id;
        if (typeof id !== "string" || !id) {
            throw new Error(`${source}: registerThingKind requires an id`);
        }
        const prev = kinds.get(id);
        if (prev) {
            throw new Error(`Duplicate thing kind "${id}" (${prev.modId} and ${source})`);
        }
        kinds.set(id, {
            modId: source,
            id,
            initEntry: typeof spec.initEntry === "function" ? spec.initEntry : null,
            clientClass: spec.clientClass || null,
            panelId: spec.panelId ? String(spec.panelId) : ""
        });
    }

    function applyInitEntry(def, x, y) {
        const kind = kindFor(def);
        if (!kind?.initEntry) return null;
        const made = kind.initEntry(def, x, y);
        if (!made) return null;
        if (made.entry) return made;
        return { lootable: false, entry: made };
    }

    function clientClassFor(def) {
        return kindFor(def)?.clientClass || null;
    }

    function panelIdFor(def) {
        return kindFor(def)?.panelId || "";
    }

    function registerPanel(modId, spec) {
        const source = String(modId || "");
        const id = spec?.id;
        if (typeof id !== "string" || !id) {
            throw new Error(`${source}: registerPanel requires an id`);
        }
        if (typeof spec.open !== "function") {
            throw new Error(`${source}: panel "${id}" requires an open function`);
        }
        const prev = panels.get(id);
        if (prev) {
            throw new Error(`Duplicate panel "${id}" (${prev.modId} and ${source})`);
        }
        panels.set(id, { modId: source, id, open: spec.open });
    }

    function openPanel(id, scene, target) {
        const row = panels.get(id);
        if (!row) return false;
        row.open(scene, target);
        return true;
    }

    function registerTexture(modId, spec) {
        const source = String(modId || "");
        const key = spec?.key;
        if (typeof key !== "string" || !key) {
            throw new Error(`${source}: registerTexture requires a key`);
        }
        if (typeof spec.url !== "string" || !spec.url) {
            throw new Error(`${source}: texture "${key}" requires a url`);
        }
        // Ownership is this map. A Phaser cache entry is not a registration.
        const prev = textures.get(key);
        if (prev) {
            throw new Error(`Duplicate texture "${key}" (${prev.modId} and ${source})`);
        }
        textures.set(key, { modId: source, key, url: spec.url });
    }

    function textureRegistration(key) {
        const row = textures.get(key);
        if (!row) return null;
        return { modId: row.modId, key: row.key, url: row.url };
    }

    function textureList() {
        return [...textures.values()].map((row) => ({ key: row.key, url: row.url, modId: row.modId }));
    }

    function onEvent(modId, kind, fn) {
        if (typeof kind !== "string" || !kind) {
            throw new Error(`${modId || "scene"}: onEvent requires a kind`);
        }
        if (typeof fn !== "function") {
            throw new Error(`${modId || "scene"}: onEvent "${kind}" requires a function`);
        }
        events.push({ modId: String(modId || "scene"), kind, fn });
    }

    function dispatchEvent(scene, ev) {
        if (!ev?.kind) return;
        for (const row of events) {
            if (row.kind !== ev.kind) continue;
            try {
                row.fn.call(scene, ev);
            } catch (err) {
                console.error(`[mod event] ${row.modId} ${ev.kind}`, err);
            }
        }
    }

    function reset() {
        kinds.clear();
        panels.clear();
        textures.clear();
        events.length = 0;
    }

    return {
        registerThingKind,
        applyInitEntry,
        clientClassFor,
        panelIdFor,
        kindFor,
        registerPanel,
        openPanel,
        registerTexture,
        textureRegistration,
        textureList,
        onEvent,
        dispatchEvent,
        reset
    };
});

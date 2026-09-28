/**
 * Browser client-mod API. Loads client/index.js in dependency order.
 * Does not execute sim scripts and is not used by the dedicated server.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("../../shared/mods/kinds"), require("../../shared/mods/content"), require("../../shared/mods/loader"));
    } else {
        root.ModClient = factory(root.ModKinds, root.Content, root.ModLoader);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Kinds, Content, Loader) {
    let _queued = false;

    function queueRegisteredTexture(scene, key, url) {
        if (typeof Content?.textureAlias === "function") url = Content.textureAlias(url);
        if (!scene?.load?.image || !key || !url) return;
        // A cache hit skips another load. It does not decide who owns the key.
        if (scene.textures?.exists?.(key)) return;
        scene.__cpQueuedTextures = scene.__cpQueuedTextures || new Set();
        if (scene.__cpQueuedTextures.has(key)) return;
        scene.__cpQueuedTextures.add(key);
        scene.load.image(key, url);
    }

    function withQualified(modId, spec, field) {
        if (!spec || spec[field] == null || typeof Loader?.qualifyName !== "function") return spec;
        const next = Loader.qualifyName(modId, spec[field]);
        if (next === spec[field]) return spec;
        return Object.assign({}, spec, { [field]: next });
    }

    function apiFor(modId, scene) {
        return {
            modId,
            id(name) {
                return Loader.qualifyName(modId, name);
            },
            registerThingKind(spec) {
                let next = withQualified(modId, spec, "id");
                next = withQualified(modId, next, "panelId");
                Kinds.registerThingKind(modId, next);
            },
            registerPanel(spec) {
                Kinds.registerPanel(modId, withQualified(modId, spec, "id"));
            },
            registerTexture(spec) {
                const key = Loader.qualifyName(modId, spec?.key);
                const url = typeof Content?.modAsset === "function" ? Content.modAsset(modId, spec?.url) : spec?.url;
                const next = Object.assign({}, spec, { key, url });
                Kinds.registerTexture(modId, next);
                queueRegisteredTexture(scene, key, url);
            },
            onEvent(kind, fn) {
                Kinds.onEvent(modId, kind, fn);
            }
        };
    }

    function consumeFactory(modId, scene) {
        const factory = globalThis.__cpPendingClientFactory;
        delete globalThis.__cpPendingClientFactory;
        if (typeof factory !== "function") {
            throw new Error(`${modId}: client script did not export a factory`);
        }
        factory(apiFor(modId, scene));
    }

    /**
     * Queue client scripts in load order. A second preload does not register them again.
     * Each file is a classic script. The next one is queued only after this one finishes.
     */
    function queueScripts(scene) {
        if (_queued) return [];
        const rows = typeof Content?.clientScripts === "function" ? Content.clientScripts() : [];
        _queued = true;
        if (!rows.length || !scene?.load?.script) return rows;
        let index = 0;
        const pump = () => {
            if (index >= rows.length) return;
            const row = rows[index++];
            const key = `cp-client-${row.modId}`;
            scene.load.once(`filecomplete-script-${key}`, () => {
                consumeFactory(row.modId, scene);
                pump();
            });
            scene.load.script(key, row.url);
        };
        pump();
        return rows;
    }

    function resetForTests() {
        _queued = false;
        Kinds.reset();
    }

    return {
        apiFor,
        queueScripts,
        consumeFactory,
        openPanel: Kinds.openPanel,
        onEvent(kind, fn) {
            Kinds.onEvent("scene", kind, fn);
        },
        dispatchEvent: Kinds.dispatchEvent,
        resetForTests
    };
});

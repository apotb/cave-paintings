/**
 * Mod action registry. Host-only handlers. No sandbox.
 * Node + browser UMD.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("../protocol"));
    } else {
        root.ModActions = factory(root.NetProtocol);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Protocol) {
    const handlers = new Map();

    function builtinTypes() {
        return new Set(Object.values(Protocol?.Actions || {}));
    }

    function registerAction(modId, spec) {
        const source = String(modId || "");
        const type = spec?.type;
        if (typeof type !== "string" || !type) {
            throw new Error(`${source}: registerAction requires a type`);
        }
        if (typeof spec.handle !== "function") {
            throw new Error(`${source}: action "${type}" requires a handle function`);
        }
        if (builtinTypes().has(type)) {
            throw new Error(`${source}: action "${type}" collides with a built-in protocol action`);
        }
        const prev = handlers.get(type);
        if (prev) {
            throw new Error(`Duplicate action "${type}" (${prev.modId} and ${source})`);
        }
        handlers.set(type, { modId: source, handle: spec.handle });
    }

    /**
     * Run a mod handler. Unknown types are ignored.
     * A thrown handler is logged and does not escape the tick.
     */
    function dispatch(world, session, action) {
        const type = action?.type;
        const row = type ? handlers.get(type) : null;
        if (!row) return false;
        try {
            row.handle(world, session, action);
        } catch (err) {
            console.error(`[mod action] ${row.modId} ${type}`, err);
        }
        return true;
    }

    function reset() {
        handlers.clear();
    }

    function has(type) {
        return handlers.has(type);
    }

    return {
        registerAction,
        dispatch,
        reset,
        has
    };
});

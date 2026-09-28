/**
 * Scatter definitions for world gen. Placement uses a private per-coordinate
 * roll, not the chunk RNG. Duplicate ids throw and name both sources.
 * Node + browser UMD.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ModScatters = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const scatters = new Map();

    function register(modId, spec) {
        const source = String(modId || "");
        const id = spec?.id;
        if (typeof id !== "string" || !id) {
            throw new Error(`${source}: registerScatter requires an id`);
        }
        if (!Array.isArray(spec.tiles) || !spec.tiles.length || spec.tiles.some((tile) => typeof tile !== "string" || !tile)) {
            throw new Error(`${source}: scatter "${id}" requires tiles`);
        }
        if (typeof spec.thingId !== "string" || !spec.thingId) {
            throw new Error(`${source}: scatter "${id}" requires a thingId`);
        }
        const chance = Number(spec.chance);
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
            throw new Error(`${source}: scatter "${id}" requires a chance from 0 to 1`);
        }
        if (!Number.isInteger(spec.salt)) {
            throw new Error(`${source}: scatter "${id}" requires an integer salt`);
        }
        const prev = scatters.get(id);
        if (prev) {
            throw new Error(`Duplicate scatter "${id}" (${prev.modId} and ${source})`);
        }
        const row = {
            modId: source,
            id,
            tiles: spec.tiles.slice(),
            thingId: spec.thingId,
            chance,
            salt: spec.salt
        };
        scatters.set(id, row);
        return row;
    }

    function remove(id) {
        return scatters.delete(id);
    }

    function get(id) {
        return scatters.get(id) || null;
    }

    function list() {
        return [...scatters.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    function document() {
        return list().map((row) => ({
            id: row.id,
            tiles: row.tiles.slice(),
            thingId: row.thingId,
            chance: row.chance,
            salt: row.salt
        }));
    }

    function reset() {
        scatters.clear();
    }

    return { register, remove, get, list, document, reset };
});

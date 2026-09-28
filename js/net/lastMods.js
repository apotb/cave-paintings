/**
 * Enabled-mod snapshot stored on a character or world.
 * Missing lastMods means the save predates the warning and stays quiet.
 * An array, including [], is a real snapshot from create or load.
 */
const LastMods = (() => {
    function normalize(list) {
        const out = [];
        const seen = new Set();
        for (const row of Array.isArray(list) ? list : []) {
            const id = typeof row === "string"
                ? row
                : (row && typeof row.id === "string" ? row.id : "");
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const rawName = row && typeof row === "object" && typeof row.name === "string"
                ? row.name.trim()
                : "";
            out.push({ id, name: rawName || id });
        }
        return out;
    }

    function hasRecord(row) {
        return Array.isArray(row?.lastMods);
    }

    function pickName(mod, names) {
        const id = mod && mod.id ? String(mod.id) : "";
        const overlay = names && typeof names[id] === "string" ? names[id].trim() : "";
        if (overlay) return overlay;
        const saved = mod && typeof mod.name === "string" ? mod.name.trim() : "";
        return saved || id || "Mod";
    }

    /**
     * Id membership only. Order and version do not count.
     * @returns {{ added: {id: string, name: string}[], removed: {id: string, name: string}[] } | null}
     */
    function diff(saved, current) {
        if (!Array.isArray(saved)) return null;
        const prev = normalize(saved);
        const next = normalize(current);
        const prevIds = new Set(prev.map((mod) => mod.id));
        const nextIds = new Set(next.map((mod) => mod.id));
        const added = next.filter((mod) => !prevIds.has(mod.id));
        const removed = prev.filter((mod) => !nextIds.has(mod.id));
        if (!added.length && !removed.length) return null;
        return { added, removed };
    }

    function lines(change, names) {
        if (!change) return [];
        const byName = (a, b) => {
            const an = pickName(a, names);
            const bn = pickName(b, names);
            const cmp = an.localeCompare(bn);
            if (cmp) return cmp;
            return String(a.id).localeCompare(String(b.id));
        };
        const added = (change.added || []).slice().sort(byName).map((mod) => `+ ${pickName(mod, names)}`);
        const removed = (change.removed || []).slice().sort(byName).map((mod) => `- ${pickName(mod, names)}`);
        return added.concat(removed);
    }

    return { normalize, hasRecord, diff, lines };
})();

if (typeof module === "object" && module.exports) {
    module.exports = LastMods;
}

/**
 * Clay-forming templates: sanitize, name match, extra-clay cost.
 * Phaser-free so node tests can run it. Persist lives in Settings.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CraftTemplates = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const NAME_MAX = 24;
    const STORAGE_KEY = "cp_form_templates";

    function nameKey(name) {
        return String(name || "").trim().toLowerCase();
    }

    function clampName(raw) {
        return String(raw || "").trim().slice(0, NAME_MAX);
    }

    function makeId() {
        return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function extraClayLumps(need, available, startMass) {
        const sm = Math.max(1, Number(startMass) || 12);
        const n = Number(need) || 0;
        const a = Number(available) || 0;
        return Math.ceil(Math.max(0, n - a) / sm);
    }

    function sortList(list) {
        const rows = Array.isArray(list) ? list.slice() : [];
        rows.sort((a, b) => {
            const c = nameKey(a?.name).localeCompare(nameKey(b?.name));
            if (c) return c;
            return String(a?.id || "").localeCompare(String(b?.id || ""));
        });
        return rows;
    }

    function sanitizeEntry(raw, Forming) {
        if (!raw || typeof raw !== "object" || !Forming) return null;
        const name = clampName(raw.name);
        if (!name) return null;
        const packed = Forming.sanitizePack?.(raw.packed);
        if (!packed) return null;
        const grid = Forming.unpack(packed);
        if (!grid) return null;
        const min = Forming.MIN_MASS || 12;
        if (Forming.mass(grid) < min) return null;
        const id = String(raw.id || "").trim() || makeId();
        const savedAt = Number(raw.savedAt);
        return {
            id,
            name,
            packed,
            savedAt: Number.isFinite(savedAt) ? savedAt : 0
        };
    }

    function sanitizeList(raw, Forming) {
        if (!Array.isArray(raw) || !Forming) return [];
        const byKey = new Map();
        for (const row of raw) {
            const e = sanitizeEntry(row, Forming);
            if (!e) continue;
            const k = nameKey(e.name);
            const prev = byKey.get(k);
            if (!prev || e.savedAt >= prev.savedAt) byKey.set(k, e);
        }
        return sortList([...byKey.values()]);
    }

    function findByName(list, name) {
        const k = nameKey(name);
        if (!k || !Array.isArray(list)) return null;
        for (const e of list) {
            if (nameKey(e?.name) === k) return e;
        }
        return null;
    }

    function findById(list, id) {
        const s = String(id || "");
        if (!s || !Array.isArray(list)) return null;
        for (const e of list) {
            if (String(e?.id || "") === s) return e;
        }
        return null;
    }

    function upsert(list, opts, now) {
        const rows = Array.isArray(list) ? list.slice() : [];
        const name = clampName(opts?.name);
        const packed = opts?.packed;
        if (!name || typeof packed !== "string") {
            return { list: sortList(rows), entry: null, replaced: false };
        }
        const t = Number(now);
        const savedAt = Number.isFinite(t) ? t : Date.now();
        const existing = findByName(rows, name);
        if (existing) {
            existing.name = name;
            existing.packed = packed;
            existing.savedAt = savedAt;
            return { list: sortList(rows), entry: existing, replaced: true };
        }
        const entry = {
            id: String(opts?.id || "").trim() || makeId(),
            name,
            packed,
            savedAt
        };
        rows.push(entry);
        return { list: sortList(rows), entry, replaced: false };
    }

    function removeById(list, id) {
        const s = String(id || "");
        if (!s || !Array.isArray(list)) return Array.isArray(list) ? list.slice() : [];
        return list.filter((e) => String(e?.id || "") !== s);
    }

    function loadCost(packed, available, startMass, Forming) {
        if (!Forming) return null;
        const grid = Forming.unpack(Forming.sanitizePack?.(packed) || packed);
        if (!grid) return null;
        const need = Forming.mass(grid);
        const extra = extraClayLumps(need, available, startMass);
        return { need, available: Number(available) || 0, extra };
    }

    return {
        NAME_MAX,
        STORAGE_KEY,
        nameKey,
        clampName,
        makeId,
        extraClayLumps,
        sortList,
        sanitizeEntry,
        sanitizeList,
        findByName,
        findById,
        upsert,
        removeById,
        loadCost
    };
});

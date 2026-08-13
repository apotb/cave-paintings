/**
 * Corpse → carcass → gone timers and loot rules.
 * Age is measured in absolute world minutes (same clock as spoilAt).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CorpseDecay = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const CORPSE_MINUTES = 12 * 60;
    const CARCASS_MINUTES = 30 * 1440;

    function boneRange(mobId) {
        const id = String(mobId || "");
        if (id === "deer") return { min: 2, max: 4 };
        if (id === "human") return { min: 1, max: 2 };
        return { min: 1, max: 2 };
    }

    /** @returns {{ id: string, min: number, max: number }[]} */
    function carcassLootTable(mobId) {
        const bones = boneRange(mobId);
        return [
            { id: "bone", min: bones.min, max: bones.max },
            { id: "rot", min: 1, max: 3 }
        ];
    }

    /**
     * @param {number|null|undefined} diedAt
     * @param {number|null|undefined} now
     * @returns {"corpse"|"carcass"|"gone"}
     */
    function stageFor(diedAt, now) {
        if (diedAt == null || now == null) return "corpse";
        const age = Math.round(now) - Math.round(diedAt);
        if (age >= CORPSE_MINUTES + CARCASS_MINUTES) return "gone";
        if (age >= CORPSE_MINUTES) return "carcass";
        return "corpse";
    }

    /** Stamp diedAt / stage on first tick so old saves get a full 12h. */
    function ensureDiedAt(entry, now) {
        if (!entry) return now;
        if (entry.diedAt == null || !Number.isFinite(Number(entry.diedAt))) {
            entry.diedAt = Math.round(now);
        } else {
            entry.diedAt = Math.round(Number(entry.diedAt));
        }
        if (!entry.stage) entry.stage = "corpse";
        return entry.diedAt;
    }

    /**
     * Meat/food and hides vanish on conversion; everything else is dumped.
     * @param {object|null} item  item def (may include food)
     * @param {object|null} [stack]
     */
    function isDiscardedOnCarcass(item, stack) {
        const id = String(stack?.id || item?.id || "");
        if (!id) return false;
        if (/_hide$/.test(id) || id === "hide") return true;
        if (item?.food || stack?.food) return true;
        return false;
    }

    /**
     * Leftover stacks that should drop as world piles when becoming a carcass.
     * @param {object[]} loot
     * @param {(id: string) => object|null} getItem
     */
    function lootToDumpOnCarcass(loot, getItem) {
        const dump = [];
        for (const stack of loot || []) {
            if (!stack) continue;
            const meta = (typeof getItem === "function" ? getItem(stack.id) : null) || stack;
            if (isDiscardedOnCarcass(meta, stack)) continue;
            dump.push(stack);
        }
        return dump;
    }

    /** Inclusive integer in [min, max]. `rng` is a 0..1 float generator. */
    function rollQty(drop, rng) {
        const lo = Math.max(0, Math.floor(Number(drop?.min ?? 1) || 0));
        const hi = Math.max(lo, Math.floor(Number(drop?.max ?? lo) || 0));
        const t = typeof rng === "function" ? rng() : Math.random();
        const u = Number.isFinite(t) ? Math.max(0, t) : Math.random();
        const span = hi - lo + 1;
        return lo + Math.min(span - 1, Math.floor(u * span));
    }

    /**
     * @param {string|null} mobId
     * @param {{ getItem: Function, now: number, rng?: Function, makeStack: Function }} opts
     */
    function buildCarcassLoot(mobId, opts) {
        const getItem = opts?.getItem;
        const now = opts?.now;
        const rng = opts?.rng;
        const makeStack = opts?.makeStack;
        const out = [];
        for (const drop of carcassLootTable(mobId)) {
            const item = typeof getItem === "function" ? getItem(drop.id) : null;
            if (!item) continue;
            const qty = rollQty(drop, rng);
            if (!(qty > 0)) continue;
            const stack = typeof makeStack === "function"
                ? makeStack(item, qty, now)
                : { id: item.id || drop.id, quantity: qty };
            if (stack) out.push(stack);
        }
        return out;
    }

    return {
        CORPSE_MINUTES,
        CARCASS_MINUTES,
        boneRange,
        carcassLootTable,
        stageFor,
        ensureDiedAt,
        isDiscardedOnCarcass,
        lootToDumpOnCarcass,
        rollQty,
        buildCarcassLoot
    };
});

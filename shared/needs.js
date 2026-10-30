/**
 * Needs shared by every human. Food stays on the hunger system.
 * Only Rest is simulated; the other meters stay full until they have a tick.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Needs = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const MINUTES_PER_DAY = 24 * 60;
    /** RimWorld: a normal bed refills 0→100% in 10.5 game hours at multiplier 1. */
    const FULL_SLEEP_HOURS = 10.5;
    const GAIN_PER_DAY = 24 / FULL_SLEEP_HOURS;
    const GROUND_EFFECTIVENESS = 0.8;
    const WAKE_AT = 0.28;
    const ICON_W = 8;
    const ICON_H = 8;
    /** needs.png is 8×41: four 8px icons with a 3px gap. */
    const ICON_PITCH = 11;

    const DEFS = [
        {
            id: "rest",
            label: "Rest",
            icon: 0,
            color: 0x4e898f,
            simulated: true,
            description: "How much this person has slept recently. It falls while they are awake.",
            improve: "Sleep in a better bed to recover faster."
        },
        {
            id: "recreation",
            label: "Recreation",
            icon: 1,
            color: 0xffa800,
            simulated: false,
            description: "How much this person has fulfilled their desire for recreation recently.",
            improve: "Increase recreation variety to reduce boredom and fill need faster."
        },
        {
            id: "beauty",
            label: "Beauty",
            icon: 2,
            color: 0xaf3b5b,
            simulated: false,
            description: "How pleasant this person finds their surroundings.",
            improve: "Art, nature, and clean floors will raise beauty."
        },
        {
            id: "comfort",
            label: "Comfort",
            icon: 3,
            color: 0xffc900,
            simulated: false,
            description: "How comfortable the furniture this person has used is recently is.",
            improve: "Better furniture and improved quality will increase comfort."
        }
    ];

    function clamp01(value, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(1, Math.max(0, n));
    }

    function fresh() {
        return { rest: 1, recreation: 1, beauty: 1, comfort: 1 };
    }

    function ensure(pawn) {
        if (!pawn) return null;
        if (!pawn.needs || typeof pawn.needs !== "object") pawn.needs = fresh();
        const next = pawn.needs;
        for (const def of DEFS) next[def.id] = clamp01(next[def.id], 1);
        return next;
    }

    function apply(pawn, raw) {
        if (!pawn) return null;
        if (raw && typeof raw === "object") {
            pawn.needs = {
                rest: raw.rest,
                recreation: raw.recreation,
                beauty: raw.beauty,
                comfort: raw.comfort
            };
        }
        return ensure(pawn);
    }

    function toJSON(pawn) {
        const src = pawn?.needs;
        const out = fresh();
        for (const def of DEFS) out[def.id] = clamp01(src?.[def.id], 1);
        return out;
    }

    function level(needs, id) {
        return clamp01(needs?.[id], 1);
    }

    function iconCrop(index) {
        const i = Math.max(0, Math.floor(Number(index) || 0));
        return { x: 0, y: i * ICON_PITCH, w: ICON_W, h: ICON_H };
    }

    /**
     * Rested ≥ 28%, Drowsy ≥ 14%, Tired > 1%, Exhausted ≤ 1%.
     * Immunity multipliers match RimWorld's rest need.
     */
    function band(rest) {
        const r = clamp01(rest, 1);
        if (r >= 0.28) return { id: "rested", label: "Rested", immunity: 1 };
        if (r >= 0.14) return { id: "drowsy", label: "Drowsy", immunity: 0.96 };
        if (r > 0.01) return { id: "tired", label: "Tired", immunity: 0.92 };
        return { id: "exhausted", label: "Exhausted", immunity: 0.8 };
    }

    function immunityFactor(rest) {
        return band(rest).immunity;
    }

    /** Later genes and drugs multiply this. */
    function sleepFallRate(_pawn) {
        return 1;
    }

    /**
     * 1 + 0.3*(bloodPumping-1) + 0.3*(digestion-1) + 0.3*(breathing-1).
     * A missing body is treated as 100% on each capacity.
     */
    function restRateMultiplier(caps) {
        const part = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? n : 1;
        };
        const rate = 1
            + 0.3 * (part(caps?.bloodPumping) - 1)
            + 0.3 * (part(caps?.digestion) - 1)
            + 0.3 * (part(caps?.breathing) - 1);
        return Math.max(0, rate);
    }

    /** Ground collapse passes `ground`. A bed without a field refills at 1. */
    function effectivenessFor(thingDef, ground) {
        if (ground) return GROUND_EFFECTIVENESS;
        const n = Number(thingDef?.sleep?.restEffectiveness);
        if (Number.isFinite(n) && n > 0) return n;
        return 1;
    }

    /** Tooltip line for a bed. Empty when the thing is not slept in. */
    function effectivenessLine(thingDef) {
        if (!thingDef?.sleep) return "";
        const pct = Math.round(effectivenessFor(thingDef, false) * 100);
        return `Rest effectiveness: ${pct}%`;
    }

    /** Fraction of the meter lost per game day while awake, before sleep fall rate. */
    function fallPerDay(rest) {
        const r = clamp01(rest, 0);
        if (r >= 0.28) return 0.95;
        if (r >= 0.14) return 0.66;
        if (r > 0.01) return 0.28;
        if (r > 0) return 0.57;
        return 0;
    }

    function gainPerDay(effectiveness, restRate) {
        const eff = Number(effectiveness);
        const rate = Number(restRate);
        const e = Number.isFinite(eff) && eff > 0 ? eff : 1;
        const r = Number.isFinite(rate) ? Math.max(0, rate) : 1;
        return (e * r) / FULL_SLEEP_HOURS * 24;
    }

    /**
     * One game minute. Asleep pawns gain rest; awake pawns lose it.
     * `hitZero` is the crossing into empty, so sitting at 0% does not collapse again.
     */
    function tickRest(pawn, opts = {}) {
        const needs = ensure(pawn);
        const before = needs.rest;
        let after = before;
        if (opts.asleep) {
            const step = gainPerDay(opts.effectiveness, opts.restRateMultiplier) / MINUTES_PER_DAY;
            after = Math.min(1, before + step);
            if (after >= 1 - 1e-9) after = 1;
        } else {
            const fall = Number(opts.sleepFallRate);
            const scale = Number.isFinite(fall) && fall > 0 ? fall : 1;
            after = Math.max(0, before - (fallPerDay(before) * scale) / MINUTES_PER_DAY);
        }
        needs.rest = after;
        return { before, after, hitZero: before > 0 && after <= 0 };
    }

    /**
     * Settlers and wanderers stay down until rest recovers.
     * The controlled pawn can be moved. Any hostile hit wakes whoever it struck.
     */
    function canWakeFromGround(opts = {}) {
        if (opts.damage) return true;
        if (opts.controlled) return true;
        return false;
    }

    function tooltip(needs, id) {
        const def = DEFS.find((row) => row.id === id) || DEFS[0];
        const pct = Math.round(level(needs, def.id) * 100);
        if (def.id === "rest") {
            const name = band(level(needs, "rest")).label;
            return `Rest: ${pct}% (${name})\n${def.description}\n${def.improve}`;
        }
        return `${def.label}: ${pct}%\n${def.description}\n${def.improve}`;
    }

    return {
        MINUTES_PER_DAY,
        FULL_SLEEP_HOURS,
        GAIN_PER_DAY,
        GROUND_EFFECTIVENESS,
        WAKE_AT,
        ICON_W,
        ICON_H,
        ICON_PITCH,
        DEFS,
        fresh,
        ensure,
        apply,
        toJSON,
        level,
        iconCrop,
        band,
        immunityFactor,
        sleepFallRate,
        restRateMultiplier,
        effectivenessFor,
        effectivenessLine,
        fallPerDay,
        gainPerDay,
        tickRest,
        canWakeFromGround,
        tooltip
    };
});

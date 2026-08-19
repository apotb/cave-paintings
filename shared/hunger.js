/**
 * Shared hunger drain — same formula for offline Player, LocalSim, and SimWorld.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const Sleep = require("./sleep");
        module.exports = factory(Sleep);
    } else {
        root.Hunger = factory(root.Sleep);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Sleep) {
    const MINUTES_PER_DAY = 24 * 60;
    const SPRINT_MULT = 1.5;
    const DEFAULT_HUNGER = 2000;

    function idlePerMinute(hunger) {
        const h = Number(hunger);
        return (Number.isFinite(h) && h > 0 ? h : DEFAULT_HUNGER) / MINUTES_PER_DAY;
    }

    /**
     * kcal drained in one game minute.
     * @param {{
     *   hunger?: number,
     *   sprinting?: boolean,
     *   encumbranceHungerRate?: number,
     *   hungerRateFactor?: number,
     *   resting?: boolean
     * }} opts
     */
    function minuteDrain(opts = {}) {
        let tick = idlePerMinute(opts.hunger);
        if (opts.sprinting) tick *= SPRINT_MULT;
        const enc = Number(opts.encumbranceHungerRate);
        if (Number.isFinite(enc) && enc > 0) tick *= enc;
        const cap = Number(opts.hungerRateFactor);
        if (Number.isFinite(cap) && cap > 0) tick *= cap;
        const rest = Sleep && typeof Sleep.hungerMult === "function"
            ? Sleep.hungerMult(opts.resting)
            : (opts.resting ? 0.5 : 1);
        tick *= Number.isFinite(rest) && rest > 0 ? rest : 1;
        return tick;
    }

    /** Apply kcal drain to a pawn with saturation then kc (same as Player.starve). */
    function applyStarve(pawn, amount) {
        if (!pawn) return;
        const n = Number(amount) || 0;
        pawn.saturation = (Number(pawn.saturation) || 0) - n;
        if (pawn.saturation < 0) {
            pawn.kc = Math.max(0, (Number(pawn.kc) || 0) + pawn.saturation);
            pawn.saturation = 0;
        }
    }

    return {
        MINUTES_PER_DAY,
        SPRINT_MULT,
        DEFAULT_HUNGER,
        idlePerMinute,
        minuteDrain,
        applyStarve
    };
});

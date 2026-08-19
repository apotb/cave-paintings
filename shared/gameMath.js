/**
 * Phaser-free math helpers shared by client body combat and the dedicated server.
 * Inject a seeded RNG via setRng(fn) for deterministic server rolls.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.GameMath = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    let _rng = Math.random;

    function setRng(fn) {
        if (typeof fn === "function") _rng = fn;
        else _rng = Math.random;
    }

    function random() {
        return _rng();
    }

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    /** Inclusive integer range [min, max]. */
    function between(min, max) {
        const lo = Math.ceil(Number(min));
        const hi = Math.floor(Number(max));
        if (!(hi >= lo)) return lo;
        return lo + Math.floor(random() * (hi - lo + 1));
    }

    function floatBetween(a, b) {
        const lo = Number(a);
        const hi = Number(b);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return lo || 0;
        return lo + random() * (hi - lo);
    }

    function pick(arr) {
        if (!arr || !arr.length) return undefined;
        return arr[Math.floor(random() * arr.length)];
    }

    /**
     * Harvest / lootable respawn clock: base minutes jittered 85–115%.
     * @param {number} baseMinutes
     * @param {number} now  world minute index
     * @param {function} [rng]  0–1; defaults to GameMath.random
     */
    function jitteredRegrowAt(baseMinutes, now, rng) {
        const base = Math.max(1, Math.floor(Number(baseMinutes) || 0));
        const u = typeof rng === "function" ? rng() : random();
        const t = Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : random();
        const factor = 0.85 + t * 0.30;
        return Math.round(Number(now) || 0) + Math.max(1, Math.floor(base * factor));
    }

    return {
        setRng,
        random,
        clamp,
        between,
        floatBetween,
        pick,
        jitteredRegrowAt
    };
});

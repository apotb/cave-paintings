/**
 * Night-veil light kinds. Flame sources flicker; steady (electric) lights do not.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Light = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const KIND = {
        STEADY: "steady",
        FLAME: "flame"
    };

    function kindOf(src, fallback) {
        let raw = fallback || KIND.STEADY;
        if (typeof src === "string") raw = src;
        else if (src && typeof src === "object") {
            raw = src.lightKind || src.light?.kind || src.kind || raw;
        }
        raw = String(raw).toLowerCase();
        if (raw === KIND.FLAME || raw === "fire") return KIND.FLAME;
        return KIND.STEADY;
    }

    function isFlame(src, fallback) {
        return kindOf(src, fallback) === KIND.FLAME;
    }

    function seedOf(x, y, extra) {
        const a = Number(x) || 0;
        const b = Number(y) || 0;
        let e = extra;
        if (typeof e === "string") {
            let h = 0;
            for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) | 0;
            e = h;
        }
        e = Number(e) || 0;
        return a * 0.017 + b * 0.031 + e * 0.0001;
    }

    // TerraxLighting "Fire" (RPG Maker MV): most frames stay full size; ~1/8
    // shrink the radius by 1–FIRE_RADIUS_PX screen pixels. Color shift is
    // skipped — our veil punches are untinted holes.
    const FIRE_WAIT = 8;
    const FIRE_RADIUS_PX = 7;

    function still() {
        return { radiusMul: 1, core: 1, x: 0, y: 0, radiusPx: 0 };
    }

    /**
     * Render-only flicker. Steady lights never dip. Flame uses Terrax's
     * hold-then-pop (not a sine pulse). `rng` is for tests; omit in-game.
     * `radiusPx` is a screen-pixel shrink — divide by world zoom before subtracting.
     */
    function flicker(kind, _timeMs, _seed, rng) {
        if (kindOf(kind, KIND.STEADY) !== KIND.FLAME) return still();
        const rand = typeof rng === "function" ? rng : Math.random;
        const wait = Math.floor(rand() * FIRE_WAIT) + 1;
        if (wait !== 1) return still();
        const radiusPx = Math.floor(rand() * FIRE_RADIUS_PX) + 1;
        return { radiusMul: 1, core: 1, x: 0, y: 0, radiusPx };
    }

    /**
     * Ease displayed radius toward the sim target. dtMs is clamped so a hitch
     * does not snap the hole; tau ~0.5s so a minute-tick jump grows over the second.
     */
    function smoothRadius(shown, target, dtMs, tauMs) {
        const from = Number(shown);
        const to = Number(target);
        const dt = Number(dtMs);
        const tau = Number(tauMs) > 0 ? Number(tauMs) : 520;
        if (!Number.isFinite(to)) return Number.isFinite(from) ? from : 0;
        if (!Number.isFinite(from)) return to;
        if (!(dt > 0)) return from;
        const k = 1 - Math.exp(-dt / tau);
        const next = from + (to - from) * k;
        if (Math.abs(next - to) < 0.03) return to;
        return next;
    }

    return {
        KIND,
        FIRE_WAIT,
        FIRE_RADIUS_PX,
        kindOf,
        isFlame,
        seedOf,
        flicker,
        smoothRadius
    };
});

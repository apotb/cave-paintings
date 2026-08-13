/**
 * Player appearance — part list, default colors, normalize/hash helpers.
 * Shared by the browser client and the Node sim.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Look = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const PARTS = ["head", "eyes", "arms", "shirt", "pants", "shoes"];
    /** Back → front composite order. */
    const DRAW_ORDER = ["pants", "shoes", "shirt", "arms", "head", "eyes"];
    const PART_LABELS = {
        head: "Head",
        eyes: "Eyes",
        arms: "Arms",
        shirt: "Body",
        pants: "Legs",
        shoes: "Feet"
    };

    /** Original human.png fill colors (eyes stay near-black via the slider). */
    const DEFAULT_LOOK = {
        head: 0xff00ee,
        eyes: 0x000000,
        arms: 0xff8900,
        shirt: 0x006cff,
        pants: 0xff0000,
        shoes: 0x7a6c47
    };

    function parseColor(v) {
        if (v == null) return null;
        if (typeof v === "number" && Number.isFinite(v)) return (v >>> 0) & 0xffffff;
        if (typeof v === "string") {
            const s = v.trim().replace(/^#/, "");
            if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16) >>> 0;
            if (/^[0-9a-fA-F]{3}$/.test(s)) {
                return parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16) >>> 0;
            }
        }
        if (typeof v === "object") {
            const r = Math.max(0, Math.min(255, Math.round(Number(v.r) || 0)));
            const g = Math.max(0, Math.min(255, Math.round(Number(v.g) || 0)));
            const b = Math.max(0, Math.min(255, Math.round(Number(v.b) || 0)));
            return ((r << 16) | (g << 8) | b) >>> 0;
        }
        return null;
    }

    function css(color) {
        const n = (parseColor(color) ?? 0) & 0xffffff;
        return `#${n.toString(16).padStart(6, "0")}`;
    }

    function normalizeLook(raw) {
        const out = {};
        for (const part of PARTS) {
            out[part] = parseColor(raw?.[part]) ?? DEFAULT_LOOK[part];
        }
        return out;
    }

    function lookKey(look) {
        const n = normalizeLook(look);
        return `look-${PARTS.map((p) => n[p].toString(16).padStart(6, "0")).join("")}`;
    }

    function looksEqual(a, b) {
        const na = normalizeLook(a);
        const nb = normalizeLook(b);
        return PARTS.every((p) => na[p] === nb[p]);
    }

    function rgbToHsv(color) {
        const n = parseColor(color) ?? 0;
        const r = ((n >> 16) & 255) / 255;
        const g = ((n >> 8) & 255) / 255;
        const b = (n & 255) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        const s = max === 0 ? 0 : d / max;
        return { h, s, v: max };
    }

    function rgbToHsl(color) {
        const n = parseColor(color) ?? 0;
        const r = ((n >> 16) & 255) / 255;
        const g = ((n >> 8) & 255) / 255;
        const b = (n & 255) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        const l = (max + min) / 2;
        const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
        return { h, s, l };
    }

    function hslToRgb(h, s, l) {
        const hh = ((Number(h) % 360) + 360) % 360;
        const ss = Math.max(0, Math.min(1, Number(s) || 0));
        const ll = Math.max(0, Math.min(1, Number(l) || 0));
        const c = (1 - Math.abs(2 * ll - 1)) * ss;
        const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
        const m = ll - c / 2;
        let r = 0;
        let g = 0;
        let b = 0;
        if (hh < 60) { r = c; g = x; }
        else if (hh < 120) { r = x; g = c; }
        else if (hh < 180) { g = c; b = x; }
        else if (hh < 240) { g = x; b = c; }
        else if (hh < 300) { r = x; b = c; }
        else { r = c; b = x; }
        const R = Math.round((r + m) * 255);
        const G = Math.round((g + m) * 255);
        const B = Math.round((b + m) * 255);
        return ((R << 16) | (G << 8) | B) >>> 0;
    }

    function hsvToRgb(h, s, v) {
        const hh = ((Number(h) % 360) + 360) % 360;
        const ss = Math.max(0, Math.min(1, Number(s) || 0));
        const vv = Math.max(0, Math.min(1, Number(v) || 0));
        const c = vv * ss;
        const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
        const m = vv - c;
        let r = 0;
        let g = 0;
        let b = 0;
        if (hh < 60) { r = c; g = x; }
        else if (hh < 120) { r = x; g = c; }
        else if (hh < 180) { g = c; b = x; }
        else if (hh < 240) { g = x; b = c; }
        else if (hh < 300) { r = x; b = c; }
        else { r = c; b = x; }
        const R = Math.round((r + m) * 255);
        const G = Math.round((g + m) * 255);
        const B = Math.round((b + m) * 255);
        return ((R << 16) | (G << 8) | B) >>> 0;
    }

    function randomLook() {
        const skinH = 15 + Math.random() * 40;
        const skinS = 0.35 + Math.random() * 0.5;
        const skinV = 0.55 + Math.random() * 0.45;
        const skin = hsvToRgb(skinH, skinS, skinV);
        const rand = (hSpan, s0, s1, v0, v1) => hsvToRgb(
            Math.random() * hSpan,
            s0 + Math.random() * (s1 - s0),
            v0 + Math.random() * (v1 - v0)
        );
        return {
            head: skin,
            arms: hsvToRgb(skinH + (Math.random() * 8 - 4), skinS, Math.max(0.4, skinV - 0.05)),
            eyes: hsvToRgb(Math.random() * 360, Math.random() * 0.55, Math.random() * 0.28),
            shirt: rand(360, 0.25, 0.95, 0.35, 1),
            pants: rand(360, 0.2, 0.9, 0.25, 0.9),
            shoes: rand(360, 0.15, 0.7, 0.12, 0.5)
        };
    }

    function partTextureKey(part) {
        return `player-${part}`;
    }

    return {
        PARTS,
        DRAW_ORDER,
        PART_LABELS,
        DEFAULT_LOOK,
        parseColor,
        css,
        normalizeLook,
        lookKey,
        looksEqual,
        rgbToHsv,
        hsvToRgb,
        rgbToHsl,
        hslToRgb,
        randomLook,
        partTextureKey
    };
});

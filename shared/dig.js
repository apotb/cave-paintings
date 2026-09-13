/**
 * Clay digging — dig % per hit, tile hit tests, ground drops.
 * Phaser-free (Node + browser UMD). Reuses Chop geometry for aim/stand.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./chop"));
    } else {
        root.Dig = factory(root.Chop);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Chop) {
    const DIG_ATTACK_IDS = {
        dig_thrust: true
    };
    const HITBOX = 16;
    const BAR_HIDE_MS = 3000;
    const HIT_RADIUS = Chop?.HIT_RADIUS || 3;
    const AIM_REACH = Chop?.AIM_REACH || 20;
    const BAR_RANGE = Chop?.BAR_RANGE || 48;

    function itemDefOf(stack, getItem) {
        if (!stack) return null;
        if (typeof getItem === "function") return getItem(stack.id) || null;
        return null;
    }

    function digFraction(stack, getItem) {
        const def = itemDefOf(stack, getItem);
        const n = Number(stack?.digPower ?? def?.digPower);
        return n > 0 ? n : 0;
    }

    function isDigger(stack, getItem) {
        if (digFraction(stack, getItem) > 0) return true;
        const def = itemDefOf(stack, getItem);
        const cls = stack?.toolClass || def?.toolClass;
        return cls === "digger";
    }

    function digPercentLine(stack, getItem) {
        const frac = digFraction(stack, getItem);
        if (!(frac > 0)) return null;
        return `Dig: +${Math.round(frac * 100)}%`;
    }

    function isDigAttack(attack) {
        const id = attack?.def?.id || attack?.id;
        return !!(id && DIG_ATTACK_IDS[id]);
    }

    function isDiggable(def) {
        return !!(def && def.diggable);
    }

    function stillDiggable(def, entry) {
        if (!entry || entry.gone) return false;
        if (Number(entry.digProgress) >= 1) return false;
        return isDiggable(def);
    }

    function hitboxSize() {
        return HITBOX;
    }

    function yieldOf(def) {
        return Math.max(0, Math.floor(Number(def?.diggable?.yield) || 0));
    }

    function remainingOf(def, entry) {
        const y = yieldOf(def);
        const taken = Math.max(0, Math.floor(Number(entry?.digTaken) || 0));
        return Math.max(0, y - taken);
    }

    function tooltipName(def, entry) {
        const name = def?.name || "Clay Deposit";
        const y = yieldOf(def);
        const taken = Math.max(0, Math.floor(Number(entry?.digTaken) || 0));
        if (!(taken > 0) && !(Number(entry?.digProgress) > 0)) return name;
        return `${name} (${Math.max(0, y - taken)}/${y})`;
    }

    function depositTooltip(def, entry, stack, getItem) {
        if (!(digFraction(stack, getItem) > 0)) return "";
        return tooltipName(def, entry);
    }

    function barVisible(entry, nowMs) {
        if (!entry) return false;
        const prog = Number(entry.digProgress) || 0;
        if (!(prog > 0) || prog >= 1) return false;
        const last = Number(entry.lastDigAt) || 0;
        if (!(last > 0)) return false;
        const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        return now - last < BAR_HIDE_MS;
    }

    function aimSegment(cx, cy, angle, reach) {
        if (Chop?.aimSegment) return Chop.aimSegment(cx, cy, angle, reach);
        const r = Number(reach);
        const len = Number.isFinite(r) && r > 0 ? r : AIM_REACH;
        const ang = Number(angle) || 0;
        return {
            a: { x: cx, y: cy },
            b: { x: cx + Math.cos(ang) * len, y: cy + Math.sin(ang) * len }
        };
    }

    function trunkHitsSegment(seg, x, y, hitboxSize, radius) {
        const hs = Number.isFinite(Number(hitboxSize)) ? Number(hitboxSize) : HITBOX;
        const rad = Number.isFinite(Number(radius)) ? Number(radius) : HIT_RADIUS;
        if (Chop?.trunkHitsSegment) return Chop.trunkHitsSegment(seg, x, y, hs, rad);
        return false;
    }

    function aimHitsTile(cx, cy, angle, x, y) {
        const seg = aimSegment(cx, cy, angle, AIM_REACH);
        return trunkHitsSegment(seg, x, y, HITBOX, HIT_RADIUS);
    }

    function standDist(pad) {
        if (Chop?.standDist) return Chop.standDist(HITBOX, pad);
        return Math.max(7, HITBOX * 0.5 + 5) + Math.max(0, Number(pad) || 0);
    }

    function ringStand(px, py, tx, ty, pad) {
        if (Chop?.ringStand) return Chop.ringStand(px, py, tx, ty, HITBOX, pad);
        return { aimX: tx, aimY: ty, dist: standDist(pad) };
    }

    /**
     * @param {object} entry
     * @param {object} def
     * @param {number} frac
     * @param {number} [nowMs]
     */
    function applyDig(entry, def, frac, nowMs) {
        const yieldN = yieldOf(def);
        const prev = Number(entry?.digProgress) || 0;
        if (!entry || !(frac > 0)) {
            return {
                progress: prev,
                give: 0,
                done: prev >= 1 - 1e-6,
                remaining: remainingOf(def, entry)
            };
        }
        const next = Math.min(1, prev + frac);
        entry.digProgress = next;
        const taken = Math.max(0, Math.floor(Number(entry.digTaken) || 0));
        const give = Math.max(0, Math.round(yieldN * next) - taken);
        entry.digTaken = taken + give;
        entry.lastDigAt = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        const done = next >= 1 - 1e-6;
        if (done) entry.digProgress = 1;
        return {
            progress: entry.digProgress,
            give,
            done,
            remaining: Math.max(0, yieldN - entry.digTaken)
        };
    }

    function pickDigFromAttacks(attacks) {
        if (!Array.isArray(attacks)) return null;
        for (const a of attacks) {
            if (isDigAttack(a)) return a;
        }
        return null;
    }

    return {
        HITBOX,
        HIT_RADIUS,
        AIM_REACH,
        BAR_RANGE,
        BAR_HIDE_MS,
        digFraction,
        isDigger,
        digPercentLine,
        isDigAttack,
        isDiggable,
        stillDiggable,
        hitboxSize,
        yieldOf,
        remainingOf,
        tooltipName,
        depositTooltip,
        barVisible,
        aimSegment,
        trunkHitsSegment,
        aimHitsTile,
        standDist,
        ringStand,
        applyDig,
        pickDigFromAttacks
    };
});

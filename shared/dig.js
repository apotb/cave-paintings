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
    const TILE_HP = 25;
    const SNOW_PIT_HP = 10;
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

    /** Clay (and similar) deposits that yield an item — not pits, stumps, or bushes. */
    function isDeposit(def) {
        return !!(def?.diggable && def.diggable.item);
    }

    function isStoragePitDef(def, entry) {
        return def?.id === "storage_pit" || entry?.id === "storage_pit";
    }

    /**
     * Fraction of a standard 25-HP tile. A snow pit is 10/25.
     * Bushes and stumps keep their own fractions in data.
     */
    function healthOf(def, entry) {
        if (isStoragePitDef(def, entry) && entry?.fillId === "snow") {
            return SNOW_PIT_HP / TILE_HP;
        }
        const n = Number(def?.diggable?.health);
        return n > 0 ? n : 1;
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

    /**
     * Animated part sheets still drawn. Part 1 is the last one left.
     * A full hit of a 4-part nest (progress 0.25) drops part 4.
     */
    function animPartsLeft(def, entry) {
        const parts = Math.floor(Number(def?.anim?.parts) || 0);
        if (parts < 2) return 0;
        const progress = Number(entry?.digProgress) || 0;
        if (progress >= 1 - 1e-6) return 0;
        const fromProgress = Math.min(parts, Math.floor(progress * parts + 1e-6));
        const fromTaken = Math.min(parts, Math.max(0, Math.floor(Number(entry?.digTaken) || 0)));
        return parts - Math.max(fromProgress, fromTaken);
    }

    function tooltipName(def) {
        return def?.name || "Clay Deposit";
    }

    function depositTooltip(def, entry, stack, getItem) {
        if (!isDeposit(def)) return "";
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
     * Old pits stored progress without paying items per thrust. Seed the float
     * and mark that floor settled so the next thrust does not dump the backlog.
     * digTaken stays 0: those items were never given, and fill cost reads it.
     */
    function ensureDigAccrual(entry, def, prev) {
        if (Number.isFinite(Number(entry.digAccrued))) return;
        const yieldN = yieldOf(def);
        const progress = Math.max(0, Number(prev) || 0);
        const taken = Math.max(0, Math.floor(Number(entry.digTaken) || 0));
        if (isStoragePitDef(def, entry) && taken === 0 && progress > 0) {
            const seeded = yieldN * progress;
            entry.digAccrued = seeded;
            entry.digSettled = Math.floor(seeded + 1e-9);
            return;
        }
        entry.digAccrued = yieldN * progress;
        if (!Number.isFinite(Number(entry.digSettled))) entry.digSettled = 0;
    }

    /**
     * @param {object} entry
     * @param {object} def
     * @param {number} frac
     * @param {number} [nowMs]
     */
    function applyDig(entry, def, frac, nowMs) {
        const yieldN = yieldOf(def);
        const health = healthOf(def, entry);
        const prev = Number(entry?.digProgress) || 0;
        if (!entry || !(frac > 0)) {
            return {
                progress: prev,
                give: 0,
                done: prev >= 1 - 1e-6,
                remaining: remainingOf(def, entry)
            };
        }
        ensureDigAccrual(entry, def, prev);
        const rawNext = Math.min(1, prev + frac / health);
        const done = rawNext >= 1 - 1e-6;
        const next = done ? 1 : rawNext;
        const gained = Math.max(0, next - prev);
        entry.digProgress = next;
        let accrued = Number(entry.digAccrued);
        if (!Number.isFinite(accrued)) accrued = 0;
        accrued += yieldN * gained;
        if (done) accrued = yieldN;
        entry.digAccrued = accrued;
        const settled = Math.max(0, Math.floor(Number(entry.digSettled) || 0));
        const taken = Math.max(0, Math.floor(Number(entry.digTaken) || 0));
        const give = Math.max(0, Math.floor(accrued + 1e-9) - settled - taken);
        entry.digTaken = taken + give;
        entry.lastDigAt = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
        return {
            progress: entry.digProgress,
            give,
            done,
            remaining: Math.max(0, yieldN - settled - entry.digTaken)
        };
    }

    function pickDigFromAttacks(attacks) {
        if (!Array.isArray(attacks)) return null;
        for (const a of attacks) {
            if (isDigAttack(a)) return a;
        }
        return null;
    }

    function rollDrops(def, rng) {
        const table = def?.diggable?.drops;
        const out = Chop?.rollNamedDrops ? Chop.rollNamedDrops(table, rng).slice() : [];
        const fruitId = def?.lootable?.item;
        const fruitN = Math.max(0, Math.floor(Number(def?.lootable?.yield) || 0));
        if (fruitId && fruitN > 0) out.push({ id: fruitId, quantity: fruitN });
        return out;
    }

    function scatterDrops(drops, x, y, rng) {
        if (Chop?.scatterFellPiles) return Chop.scatterFellPiles(drops, x, y, rng);
        return (drops || []).map((d) => ({
            id: d.id,
            quantity: d.quantity,
            x: Number(x) || 0,
            y: Number(y) || 0
        }));
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
        isDeposit,
        healthOf,
        stillDiggable,
        hitboxSize,
        yieldOf,
        remainingOf,
        animPartsLeft,
        tooltipName,
        depositTooltip,
        barVisible,
        aimSegment,
        trunkHitsSegment,
        aimHitsTile,
        standDist,
        ringStand,
        applyDig,
        pickDigFromAttacks,
        rollDrops,
        scatterDrops
    };
});

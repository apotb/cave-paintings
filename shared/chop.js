/**
 * Tree chopping — chop % per hit, trunk hit tests, felling + drops.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./melee"));
    } else {
        root.Chop = factory(root.MeleeMath);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (MeleeMath) {
    /** Rough stone chopper = this fraction per hit. */
    const CLASS_BASE = {
        chopper: 0.05
    };
    const ROUGH_QUALITY = 0.95;
    const FLINT_MULT = 1.25;
    const QUALITY_MULT = { crude: 0.65, rough: 0.95, fine: 1.35 };
    const CHOP_ATTACK_IDS = {
        knap_chopper_chop: true
    };
    const DEFAULT_DROPS = {
        log: [2, 3],
        stick: [6, 10],
        leaf: [8, 14]
    };
    const HIT_RADIUS = 3;
    const AIM_REACH = 20;
    const BAR_RANGE = 48;

    function knapQualityMult(quality) {
        return QUALITY_MULT[quality] || 1;
    }

    function classBase(stack) {
        const cls = stack?.toolClass;
        if (!cls) return 0;
        const n = Number(CLASS_BASE[cls]);
        return n > 0 ? n : 0;
    }

    function chopFraction(stack) {
        const base = classBase(stack);
        if (!(base > 0)) return 0;
        const q = knapQualityMult(stack?.knapQuality);
        const mat = stack?.knapMaterial === "flint" ? FLINT_MULT : 1;
        return base * (q / ROUGH_QUALITY) * mat;
    }

    function isChopper(stack) {
        return chopFraction(stack) > 0;
    }

    function chopPercentLine(stack) {
        const frac = chopFraction(stack);
        if (!(frac > 0)) return null;
        return `Chop: +${Math.round(frac * 100)}%`;
    }

    function isChopAttack(attack) {
        const id = attack?.def?.id || attack?.id;
        return !!(id && CHOP_ATTACK_IDS[id]);
    }

    function isChoppable(def) {
        return !!(def && def.choppable);
    }

    function stillChoppable(def, entry) {
        if (!entry || entry.gone) return false;
        if (Number(entry.chopProgress) >= 1) return false;
        return isChoppable(def);
    }

    /** Body-center offset from trunk origin so a short knapped chopper still reaches. */
    function standDist(hitboxSize, pad) {
        const hs = Math.max(1, Number(hitboxSize) || 5);
        const extra = Math.max(0, Number(pad) || 0);
        return Math.max(7, hs * 0.5 + 5) + extra;
    }

    /**
     * Stand on the ring around the trunk along the current approach, not a
     * cardinal that sends the pawn around (and into) the collider.
     */
    function ringStand(px, py, tx, ty, hitboxSize, pad) {
        const dist = standDist(hitboxSize, pad);
        let dx = (Number(px) || 0) - (Number(tx) || 0);
        let dy = (Number(py) || 0) - (Number(ty) || 0);
        let radial = Math.hypot(dx, dy);
        if (radial < 1) {
            dx = 0;
            dy = 1;
            radial = 1;
        } else {
            dx /= radial;
            dy /= radial;
        }
        return {
            aimX: (Number(tx) || 0) + dx * dist,
            aimY: (Number(ty) || 0) + dy * dist,
            dist,
            radial,
            nx: dx,
            ny: dy
        };
    }

    function stumpId(def) {
        return def?.choppable?.stump || null;
    }

    function trunkBox(x, y, hitboxSize) {
        const hs = Math.max(1, Number(hitboxSize) || 5);
        const px = Number(x) || 0;
        const py = Number(y) || 0;
        return {
            left: px - hs / 2,
            right: px + hs / 2,
            top: py - hs,
            bottom: py
        };
    }

    function aimSegment(cx, cy, angle, reach) {
        const r = Number(reach);
        const len = Number.isFinite(r) && r > 0 ? r : AIM_REACH;
        const ang = Number(angle) || 0;
        return {
            a: { x: cx, y: cy },
            b: { x: cx + Math.cos(ang) * len, y: cy + Math.sin(ang) * len }
        };
    }

    function _hitsRect(ax, ay, bx, by, box, radius) {
        const fn = MeleeMath?.meleeSegmentHitsRect;
        if (typeof fn !== "function") return false;
        return fn(ax, ay, bx, by, box, radius);
    }

    function trunkHitsSegment(seg, x, y, hitboxSize, radius) {
        if (!seg?.a || !seg?.b) return false;
        const rad = Number.isFinite(Number(radius)) ? Number(radius) : HIT_RADIUS;
        return _hitsRect(
            seg.a.x, seg.a.y, seg.b.x, seg.b.y,
            trunkBox(x, y, hitboxSize),
            rad
        );
    }

    function aimHitsTrunk(cx, cy, angle, x, y, hitboxSize) {
        const seg = aimSegment(cx, cy, angle, AIM_REACH);
        return trunkHitsSegment(seg, x, y, hitboxSize, HIT_RADIUS);
    }

    function rollBetween(rng, lo, hi) {
        const a = Math.min(lo, hi);
        const b = Math.max(lo, hi);
        const u = typeof rng === "function" ? rng() : Math.random();
        const t = Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : Math.random();
        return a + Math.floor(t * (b - a + 1));
    }

    function _dropRange(choppable, key) {
        const raw = choppable?.drops?.[key] || DEFAULT_DROPS[key];
        if (Array.isArray(raw) && raw.length >= 2) {
            return [Math.floor(Number(raw[0]) || 0), Math.floor(Number(raw[1]) || 0)];
        }
        const n = Math.floor(Number(raw) || 0);
        return [n, n];
    }

    /**
     * @param {object} def  Things.json row for the tree's current id
     * @param {function} [rng]  0–1
     */
    function rollDrops(def, rng) {
        const c = def?.choppable;
        if (!c) return [];
        const out = [];
        const push = (id, lo, hi) => {
            const n = rollBetween(rng, lo, hi);
            if (n > 0) out.push({ id, quantity: n });
        };
        const log = _dropRange(c, "log");
        const stick = _dropRange(c, "stick");
        const leaf = _dropRange(c, "leaf");
        push("log", log[0], log[1]);
        push("stick", stick[0], stick[1]);
        push("leaf", leaf[0], leaf[1]);
        const fruitId = def.lootable?.item;
        const fruitN = Math.max(0, Math.floor(Number(def.lootable?.yield) || 0));
        if (fruitId && fruitN > 0) out.push({ id: fruitId, quantity: fruitN });
        return out;
    }

    /**
     * Split fell totals into 3–6 single-type piles around the trunk.
     * Tight scatter with uneven angles and a radius range. noMerge keeps piles separate.
     */
    function scatterFellPiles(drops, ox, oy, rng) {
        const piles = [];
        for (const d of drops || []) {
            const n = Math.max(0, Math.floor(Number(d.quantity) || 0));
            if (n > 0 && d.id) piles.push({ id: d.id, quantity: n });
        }
        if (!piles.length) return [];

        const totalItems = piles.reduce((s, p) => s + p.quantity, 0);
        const want = Math.max(1, Math.min(6, Math.min(totalItems, rollBetween(rng, 3, 6))));
        while (piles.length < want) {
            let i = 0;
            for (let k = 1; k < piles.length; k++) {
                if (piles[k].quantity > piles[i].quantity) i = k;
            }
            if (piles[i].quantity < 2) break;
            const take = Math.max(1, Math.floor(piles[i].quantity / 2));
            piles[i].quantity -= take;
            piles.push({ id: piles[i].id, quantity: take });
        }

        for (let i = piles.length - 1; i > 0; i--) {
            const u = typeof rng === "function" ? rng() : Math.random();
            const j = Math.floor(Math.max(0, Math.min(0.999999, u)) * (i + 1));
            const tmp = piles[i];
            piles[i] = piles[j];
            piles[j] = tmp;
        }

        const TILE = 16;
        const DROP_W = TILE * 0.7;
        const radMin = TILE * 0.4;
        const radMax = TILE * 0.7;
        const rand = typeof rng === "function" ? rng : Math.random;
        const n = piles.length;
        const spin = rand() * Math.PI * 2;
        const step = (Math.PI * 2) / Math.max(1, n);
        const cx = Number(ox) || 0;
        const cy = Number(oy) || 0;
        const out = [];
        for (let i = 0; i < n; i++) {
            const ang = spin + i * step + (rand() - 0.5) * step * 1.5;
            const rad = radMin + rand() * (radMax - radMin);
            const vx = cx + Math.cos(ang) * rad;
            const vy = cy + Math.sin(ang) * rad;
            out.push({
                id: piles[i].id,
                quantity: piles[i].quantity,
                x: vx - DROP_W * 0.5,
                y: vy
            });
        }
        return out;
    }

    function applyChop(entry, frac) {
        if (!entry || !(frac > 0)) {
            return { progress: Number(entry?.chopProgress) || 0, felled: false };
        }
        const prev = Number(entry.chopProgress) || 0;
        const next = Math.min(1, prev + frac);
        entry.chopProgress = next;
        const felled = next >= 1 - 1e-6;
        if (felled) entry.chopProgress = 1;
        return { progress: entry.chopProgress, felled };
    }

    function fellToStump(entry, def) {
        if (!entry) return entry;
        const stump = stumpId(def);
        if (stump) entry.id = stump;
        delete entry.chopProgress;
        delete entry.regrowAt;
        delete entry.regrowId;
        delete entry.gone;
        return entry;
    }

    function pickChopFromAttacks(attacks) {
        if (!Array.isArray(attacks)) return null;
        for (const a of attacks) {
            if (isChopAttack(a)) return a;
        }
        return null;
    }

    return {
        CLASS_BASE,
        HIT_RADIUS,
        AIM_REACH,
        BAR_RANGE,
        chopFraction,
        isChopper,
        chopPercentLine,
        isChopAttack,
        isChoppable,
        stillChoppable,
        standDist,
        ringStand,
        stumpId,
        trunkBox,
        aimSegment,
        trunkHitsSegment,
        aimHitsTrunk,
        rollDrops,
        scatterFellPiles,
        applyChop,
        fellToStump,
        pickChopFromAttacks
    };
});

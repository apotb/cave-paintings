/**
 * Bow shots. A shortbow looses at once. A longbow charges, hits harder, and
 * reaches farther. The aim is a point, the roll is shooting skill at that
 * distance, then the light on that point. A body on the ground is an execution
 * within three tiles and half as likely past four. Pitch black keeps a fifth of the
 * chance and full light keeps all of it. The arrow still flies. A solid stops
 * it. A miss scatters
 * and can hit someone else, except an ally within five tiles of the shooter.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Ranged = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const RANGE_TILES = 14;
    const LONG_RANGE_TILES = 20;
    const AIM_MS = 1000;
    const COOLDOWN_MS = 1400;
    const ALLY_SAFE_TILES = 5;
    const BASE_DAMAGE = 12;
    const LONG_DAMAGE = 18;
    const BOWS = {
        shortbow: { aimMs: 0, rangeTiles: RANGE_TILES, damage: BASE_DAMAGE },
        longbow: { aimMs: AIM_MS, rangeTiles: LONG_RANGE_TILES, damage: LONG_DAMAGE }
    };
    const MISS_XP = 32;
    /** Flight time from distance in pixels. The hit waits this long. */
    const FLIGHT_MIN_MS = 70;
    const FLIGHT_MAX_MS = 280;
    const FLIGHT_MS_PER_PX = 6;
    const SPEAR_IDS = { wooden_spear: true, stone_spear: true, flint_spear: true };

    function stoneApi() {
        if (typeof Stone !== "undefined" && Stone.qualityMult) return Stone;
        if (typeof module === "object" && module.exports) {
            try { return require("./stone"); } catch (_) { return null; }
        }
        return null;
    }

    function skillsApi() {
        if (typeof Skills !== "undefined" && Skills.shootingAccuracyAt) return Skills;
        if (typeof module === "object" && module.exports) {
            try { return require("./skills"); } catch (_) { return null; }
        }
        return null;
    }

    function partyApi() {
        if (typeof Party !== "undefined" && Party.sameFaction) return Party;
        if (typeof module === "object" && module.exports) {
            try { return require("./party"); } catch (_) { return null; }
        }
        return null;
    }

    function rollOf(rng) {
        if (typeof rng === "function") return rng;
        return Math.random;
    }

    function arrowKey(stack) {
        if (!stack || stack.id !== "arrow") return "";
        return [
            stack.knapMaterial || "",
            stack.stone || "",
            stack.knapQuality || ""
        ].join("|");
    }

    /** Same stone and the same blade grade. Those four arrows share one stack. */
    function sameArrow(a, b) {
        if (!a || !b || a.id !== "arrow" || b.id !== "arrow") return false;
        return arrowKey(a) === arrowKey(b);
    }

    function bowStats(stack) {
        if (!stack) return null;
        return BOWS[stack.id] || null;
    }

    function isBowStack(stack, getItem) {
        if (!bowStats(stack)) return false;
        if (typeof getItem !== "function") return true;
        const meta = getItem(stack.id);
        return !meta || meta.weapon?.type === "ranged";
    }

    /** A longbow holds the string. A shortbow does not. */
    function aimMs(stack) {
        const stats = bowStats(stack);
        return stats ? stats.aimMs : 0;
    }

    function rangeTiles(stack) {
        const stats = bowStats(stack);
        return stats ? stats.rangeTiles : RANGE_TILES;
    }

    function baseDamage(stack) {
        const stats = bowStats(stack);
        return stats ? stats.damage : BASE_DAMAGE;
    }

    function isSpearStack(stack) {
        return !!(stack && SPEAR_IDS[stack.id]);
    }

    function holdingBow(owner, getItem) {
        const idx = owner?.hotbarIndex | 0;
        const stack = owner?.inventory?.[idx];
        return isBowStack(stack, getItem) ? stack : null;
    }

    /** Hotbar order, then the backpack. The selected slot does not jump the line. */
    function firstArrow(hotbar, overflow) {
        const scan = (list) => {
            if (!Array.isArray(list)) return null;
            for (let i = 0; i < list.length; i++) {
                const stack = list[i];
                if (stack?.id === "arrow" && (Number(stack.quantity) || 0) > 0) {
                    return { list, index: i, stack };
                }
            }
            return null;
        };
        return scan(hotbar) || scan(overflow);
    }

    function hasArrow(hotbar, overflow) {
        return !!firstArrow(hotbar, overflow);
    }

    function spendArrow(found) {
        if (!found?.stack || !found.list) return null;
        const stack = found.stack;
        const spent = {
            id: "arrow",
            quantity: 1,
            knapMaterial: stack.knapMaterial || null,
            knapQuality: stack.knapQuality || null,
            stone: stack.stone || null
        };
        const qty = Math.max(1, Math.floor(Number(stack.quantity) || 1));
        if (qty <= 1) found.list[found.index] = null;
        else stack.quantity = qty - 1;
        return spent;
    }

    function findCarry(owner, pred) {
        const bags = [
            { name: "hotbar", list: owner?.inventory },
            { name: "overflow", list: owner?.overflow }
        ];
        for (const bag of bags) {
            if (!Array.isArray(bag.list)) continue;
            for (let i = 0; i < bag.list.length; i++) {
                if (bag.list[i] && pred(bag.list[i])) {
                    return { bag: bag.name, index: i, stack: bag.list[i] };
                }
            }
        }
        return null;
    }

    function bowCarry(owner, getItem) {
        return findCarry(owner, (s) => isBowStack(s, getItem));
    }

    function spearCarry(owner) {
        return findCarry(owner, isSpearStack);
    }

    function spearReach(stack, getItem) {
        if (!isSpearStack(stack)) return 0;
        const meta = typeof getItem === "function" ? getItem(stack.id) : null;
        const range = Number(meta?.weapon?.range);
        return range > 0 ? range : 12;
    }

    /**
     * Put `found` in the hand. A backpack spear swaps with whatever is held.
     * @returns {boolean}
     */
    function equipCarry(owner, found) {
        if (!owner || !found) return false;
        if (!Array.isArray(owner.inventory)) return false;
        if (found.bag === "hotbar") {
            owner.hotbarIndex = found.index;
            return true;
        }
        const hand = owner.hotbarIndex | 0;
        if (!owner.inventory[hand] && owner.inventory.length <= hand) return false;
        const tmp = owner.inventory[hand] || null;
        owner.inventory[hand] = found.stack;
        if (Array.isArray(owner.overflow)) owner.overflow[found.index] = tmp;
        owner.hotbarIndex = hand;
        return true;
    }

    function shotDamage(bowStack, arrowStack) {
        const stone = stoneApi();
        const bowQ = stone?.qualityMult?.(bowStack?.knapQuality) ?? 1;
        const tipQ = stone?.qualityMult?.(arrowStack?.knapQuality) ?? 1;
        const props = stone?.propsOf?.(arrowStack) || { hardness: 5 };
        const hard = stone?.hardnessFactor?.(props.hardness) ?? 1;
        return Math.round(baseDamage(bowStack) * bowQ * hard * tipQ * 10) / 10;
    }

    function centerOf(body) {
        if (!body) return { x: 0, y: 0 };
        if (typeof body.bodyCenter === "function") return body.bodyCenter();
        return { x: Number(body.x) || 0, y: Number(body.y) || 0 };
    }

    function bodyRadius(body) {
        const hs = Number(body?.hitboxSize);
        return (hs > 0 ? hs : 8) * 0.5;
    }

    function alive(body) {
        if (!body) return false;
        if (body.isBodyDead?.() || body._dead || body.dead) return false;
        return true;
    }

    function spriteMask() {
        if (typeof SpriteMask !== "undefined" && SpriteMask.edgeDist) return SpriteMask;
        if (typeof module === "object" && module.exports) {
            try { return require("./spriteMask"); } catch (_) { return null; }
        }
        return null;
    }

    /** On the opaque body, or inside the small center circle when there is no mask. */
    function coversPoint(body, x, y) {
        const mask = spriteMask();
        if (mask?.edgeDist) {
            const edge = mask.edgeDist(x, y, body);
            // edgeDist is 0 on a pixel center. A corner of that pixel is ~0.2.
            if (edge != null && edge <= 0.5) return { d: edge };
        }
        const c = centerOf(body);
        const d = Math.hypot(c.x - x, c.y - y);
        if (d <= bodyRadius(body)) return { d };
        return null;
    }

    function bodyUnder(bodies, x, y, skip) {
        let best = null;
        let bestD = Infinity;
        for (const body of bodies || []) {
            if (!alive(body) || body === skip) continue;
            const hit = coversPoint(body, x, y);
            if (hit && hit.d < bestD) {
                best = body;
                bestD = hit.d;
            }
        }
        return best;
    }

    /**
     * Someone the shot was meant for: on the aim point, or within a tile of their body.
     * Empty ground is not practice.
     */
    function aimedNear(bodies, x, y, skip, tile) {
        const slack = tile > 0 ? tile : 16;
        let best = null;
        let bestD = Infinity;
        for (const body of bodies || []) {
            if (!alive(body) || body === skip) continue;
            const c = centerOf(body);
            const d = Math.hypot(c.x - x, c.y - y);
            if (d <= bodyRadius(body) + slack && d < bestD) {
                best = body;
                bestD = d;
            }
        }
        return best;
    }

    function clampAim(x0, y0, x1, y1, tiles, tile) {
        const max = (tiles > 0 ? tiles : RANGE_TILES) * (tile > 0 ? tile : 16);
        const dx = (Number(x1) || 0) - x0;
        const dy = (Number(y1) || 0) - y0;
        const d = Math.hypot(dx, dy);
        if (!(d > max) || !(d > 0)) return { x: Number(x1) || x0, y: Number(y1) || y0 };
        const s = max / d;
        return { x: x0 + dx * s, y: y0 + dy * s };
    }

    /** Last clear point along the segment. The shooter's own cell is the start. */
    function clipSegment(x0, y0, x1, y1, blocked) {
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(1, Math.ceil(dist / 4));
        let lx = x0;
        let ly = y0;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;
            if (typeof blocked === "function" && blocked(x, y)) {
                return { x: lx, y: ly, stopped: true };
            }
            lx = x;
            ly = y;
        }
        return { x: x1, y: y1, stopped: false };
    }

    function firstAlong(bodies, from, to, skip) {
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.ceil(dist / 4));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = from.x + (to.x - from.x) * t;
            const y = from.y + (to.y - from.y) * t;
            const body = bodyUnder(bodies, x, y, null);
            if (body && !(typeof skip === "function" && skip(body))) {
                return { body, x, y };
            }
        }
        return null;
    }

    /**
     * A body on the ground. Within three tiles the shot is an execution (×7.5).
     * Past four tiles it is half as likely. The tile in between is unchanged.
     */
    const EXECUTION_TILES = 3;
    const LYING_FAR_TILES = 4;
    const EXECUTION_FACTOR = 7.5;
    const LYING_FACTOR = 0.5;

    function isLying(body) {
        const party = partyApi();
        return !!party?.isLying?.(body);
    }

    function postureFactor(tiles, lying) {
        if (!lying) return 1;
        const d = Number(tiles);
        if (!(d > EXECUTION_TILES)) return EXECUTION_FACTOR;
        if (d > LYING_FAR_TILES) return LYING_FACTOR;
        return 1;
    }

    /**
     * RimWorld's lighting line. Glow 0 keeps 20% of the hit chance. Glow 1 keeps
     * all of it. The glow is the light on the aim, not on the shooter.
     */
    function lightFactor(glow) {
        const g = Number(glow);
        if (!Number.isFinite(g)) return 1;
        return 0.2 + 0.8 * Math.max(0, Math.min(1, g));
    }

    function glowAtAim(opts, aim) {
        if (Number.isFinite(Number(opts?.brightness))) return Number(opts.brightness);
        const host = opts?.world;
        if (host?.gameMinutes == null) return null;
        const skills = skillsApi();
        if (!skills?.tileBrightness || !skills?.workOpts) return null;
        return skills.tileBrightness(skills.workOpts(host, { x: aim.x, y: aim.y }));
    }

    function scatterPoint(aim, aimed, rng, tile, accuracy) {
        const hs = aimed ? bodyRadius(aimed) + 4 : tile * 0.75;
        const miss = 1 - Math.max(0, Math.min(1, Number(accuracy) || 0));
        const dist = hs + tile * (0.4 + rng() * (1.2 + miss * 3));
        const ang = rng() * Math.PI * 2;
        return { x: aim.x + Math.cos(ang) * dist, y: aim.y + Math.sin(ang) * dist };
    }

    /**
     * @param {{
     *   from: {x: number, y: number},
     *   aimX: number, aimY: number,
     *   shooter?: object, bodies?: object[],
     *   blocked?: function, rng?: function,
     *   tile?: number, accuracyAt?: function
     * }} opts
     */
    function release(opts) {
        const tile = opts?.tile > 0 ? opts.tile : 16;
        const from = opts?.from || { x: 0, y: 0 };
        const rng = rollOf(opts?.rng);
        const reach = opts?.rangeTiles > 0 ? opts.rangeTiles : RANGE_TILES;
        const aim = clampAim(from.x, from.y, opts?.aimX, opts?.aimY, reach, tile);
        const tiles = Math.hypot(aim.x - from.x, aim.y - from.y) / tile;
        let accuracy = 0.5;
        const skills = skillsApi();
        if (typeof opts?.accuracyAt === "function") accuracy = Number(opts.accuracyAt(tiles)) || 0;
        else if (skills && opts?.shooter) accuracy = skills.shootingAccuracyAt(opts.shooter, tiles) || 0;
        accuracy = Math.max(0, Math.min(1, accuracy));
        const glow = glowAtAim(opts, aim);
        if (glow != null) accuracy *= lightFactor(glow);
        const aimed = bodyUnder(opts?.bodies, aim.x, aim.y, opts?.shooter);
        const posture = postureFactor(tiles, isLying(aimed));
        if (posture !== 1) accuracy *= posture;
        accuracy = Math.max(0, Math.min(1, accuracy));
        const hitRoll = rng() < accuracy;
        const flight = clipSegment(from.x, from.y, aim.x, aim.y, opts?.blocked);
        const reaches = !flight.stopped
            || Math.hypot(flight.x - aim.x, flight.y - aim.y) <= 2;
        let target = null;
        let to = flight;
        if (hitRoll && reaches && aimed) {
            target = aimed;
            to = { x: aim.x, y: aim.y, stopped: false };
        } else if (!hitRoll) {
            const scatter = scatterPoint(aim, aimed, rng, tile, accuracy);
            const wild = clipSegment(from.x, from.y, scatter.x, scatter.y, opts?.blocked);
            const along = firstAlong(opts?.bodies, from, wild, (body) => {
                if (body === opts?.shooter) return true;
                if (aimed && body === aimed) return true;
                if (typeof opts?.spare === "function" && opts.spare(body)) return true;
                return false;
            });
            if (along) {
                target = along.body;
                to = { x: along.x, y: along.y, stopped: false };
            } else {
                to = wild;
            }
        }
        return { aim, tiles, accuracy, hitRoll, aimed, target, to };
    }

    /** How long the sprite takes to cover this many pixels. */
    function flightMs(dist) {
        const d = Math.max(0, Number(dist) || 0);
        return Math.round(Math.max(FLIGHT_MIN_MS, Math.min(FLIGHT_MAX_MS, d * FLIGHT_MS_PER_PX)));
    }

    /** Wild shots skip an ally standing within five tiles of the shooter. */
    function spareAlly(shooter, body, tile) {
        const party = partyApi();
        if (!party?.sameFaction?.(shooter, body)) return false;
        const a = centerOf(shooter);
        const b = centerOf(body);
        const size = tile > 0 ? tile : 16;
        return Math.hypot(b.x - a.x, b.y - a.y) <= ALLY_SAFE_TILES * size;
    }

    return {
        RANGE_TILES,
        LONG_RANGE_TILES,
        AIM_MS,
        COOLDOWN_MS,
        ALLY_SAFE_TILES,
        BASE_DAMAGE,
        LONG_DAMAGE,
        MISS_XP,
        EXECUTION_TILES,
        LYING_FAR_TILES,
        EXECUTION_FACTOR,
        LYING_FACTOR,
        flightMs,
        postureFactor,
        lightFactor,
        sameArrow,
        arrowKey,
        bowStats,
        isBowStack,
        aimMs,
        rangeTiles,
        baseDamage,
        isSpearStack,
        holdingBow,
        firstArrow,
        hasArrow,
        spendArrow,
        bowCarry,
        spearCarry,
        spearReach,
        equipCarry,
        shotDamage,
        centerOf,
        clampAim,
        clipSegment,
        release,
        spareAlly,
        bodyUnder,
        aimedNear
    };
});

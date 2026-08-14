/**
 * Party recruiting constants and helpers — Phaser-free (client + Node).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Party = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const CAP = 6;
    const COLOR_ALLY = "#80e080";
    const COLOR_ENEMY = "#ff6666";
    const COLOR_NEUTRAL = "#ffffff";

    const FOLLOW_BEHIND = 1.75;
    const FOLLOW_DETACH = 12;
    // Hysteresis: stay put until farther than CATCH, then walk until IDLE.
    const FOLLOW_IDLE = 2.6;
    const FOLLOW_CATCH = 4.8;
    const FOLLOW_SPREAD = 1.05;
    const FOLLOW_ARRIVE = 0.55;
    const MILL_RADIUS = 5;
    const COMBAT_LEASH = 10;
    const INTERACT_TILES = 4;
    /** Local scrap radius for 1v1 pairing. */
    const DUEL_CLUSTER_TILES = 12;
    /** Stand-off from the hurtbox when 2+ allies share a target (off the pierce line). */
    const DUEL_STAND_PX = 16;
    /** Tiny unique offset so parallel 1v1s don't share a line. */
    const DUEL_HASH_OFFSET_PX = 3;
    /** Ally push while closing (skipped while planted / swinging). */
    const DUEL_ALLY_SEP_PX = 16;
    /** Close enough to the flank stand to plant and swing. */
    const DUEL_STAND_ARRIVE_PX = 8;

    const RECRUIT_EMPTY = 0.5;
    const RECRUIT_FOOD = 0.75;

    const COOLDOWN_ROOM = [60, 120];
    /** Full-party packs of 2–6: twice as long as the previous full-party wait. */
    const COOLDOWN_FULL = [480, 960];

    const AUTO_EAT_BELOW = 1000;
    const AUTO_EAT_UNTIL = 1400;

    /** Neutral passerby stroll vs player walk (3.5 tiles/s). Combat chase stays full speed. */
    const WANDER_WALK_MULT = 0.28;
    /** Walk clips are authored for this tiles/s at anim timeScale 1. */
    const WALK_ANIM_TILES_PER_SEC = 3.5;
    /** Passerby sim vs /tick. Cap so they don't teleport a chunk per frame. */
    function wandererTimeScale(tickSpeed) {
        const s = Number(tickSpeed);
        if (!Number.isFinite(s) || s <= 0) return 0;
        return Math.min(8, s);
    }
    /** Map travel speed onto the human walk clip. */
    function walkAnimTimeScale(tilesPerSec, refTilesPerSec) {
        const ref = Number(refTilesPerSec) > 0 ? Number(refTilesPerSec) : WALK_ANIM_TILES_PER_SEC;
        const t = Number(tilesPerSec);
        if (!Number.isFinite(t) || t <= 0) return 1;
        const scale = t / ref;
        if (scale < 0.15) return 0.15;
        if (scale > 8) return 8;
        return scale;
    }
    /** Hitting one passerby pulls others in this radius (covers a 6-pack line). */
    const WANDERER_ALERT_TILES = 10;

    const GEAR_TABLE = [
        { weight: 0.3, id: "pebble" },
        { weight: 0.3, id: "stick" },
        { weight: 0.3, id: "sharp_stick" },
        { weight: 0.1, id: "wooden_spear" }
    ];
    /** Full party of 6: more real weapons, including stone spears. */
    const GEAR_TABLE_FULL = [
        { weight: 0.12, id: "pebble" },
        { weight: 0.12, id: "stick" },
        { weight: 0.28, id: "sharp_stick" },
        { weight: 0.32, id: "wooden_spear" },
        { weight: 0.16, id: "stone_spear" }
    ];
    const FOOD_CHANCE = 0.18;
    const FOOD_CHANCE_FULL = 0.72;
    const PACK_FULL = [2, 6];

    function rngOf(rng) {
        return typeof rng === "function" ? rng : Math.random;
    }

    const FACTION_WILDLIFE = "Wildlife";
    const FACTION_WANDERERS = "Wanderers";

    function ownerIdOf(entity) {
        if (!entity) return null;
        return entity.ownerId || entity.leaderId || entity.playerId || null;
    }

    function partyFactionId(ownerId) {
        return ownerId ? `party:${ownerId}` : null;
    }

    /**
     * Combat team. Party members share `party:<ownerId>`; unrecruited
     * passersby are Wanderers; animals (and wild human mobs) are Wildlife.
     */
    function factionOf(entity) {
        if (!entity) return null;
        if (entity.faction) return entity.faction;
        const oid = entity.ownerId || entity._remote?.ownerId || entity.playerId || null;
        if (oid) return partyFactionId(oid);
        if (entity.role === "wanderer" || entity.wandererAI) return FACTION_WANDERERS;
        if (entity.kind === "player" && entity.role !== "wanderer") {
            const id = entity.id || entity.pawnId;
            if (id) return partyFactionId(id);
        }
        return FACTION_WILDLIFE;
    }

    function sameFaction(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        const fa = factionOf(a);
        const fb = factionOf(b);
        return !!fa && fa === fb;
    }

    function pawnIdOf(entity) {
        if (!entity) return null;
        return entity.pawnId || entity.id || null;
    }

    function wildAggroOwnerId(entity) {
        if (!entity) return null;
        return entity.aggroOwnerId
            || entity.ai?.aggroOwnerId
            || ownerIdOf(entity.ai?._combatTarget)
            || null;
    }

    /** Lock a wanderer / animal onto the party that pulled it, first hitter wins. */
    function setWildAggroOwner(entity, source) {
        const oid = ownerIdOf(source);
        if (!oid || !entity) return oid || null;
        if (!entity.aggroOwnerId) entity.aggroOwnerId = oid;
        if (entity.ai && !entity.ai.aggroOwnerId) entity.ai.aggroOwnerId = oid;
        return oid;
    }

    function clearWildAggroOwner(entity) {
        if (!entity) return;
        entity.aggroOwnerId = null;
        if (entity.ai) entity.ai.aggroOwnerId = null;
    }

    function sameWildTarget(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        const ia = pawnIdOf(a) || a.uid;
        const ib = pawnIdOf(b) || b.uid;
        return !!(ia && ia === ib);
    }

    /**
     * True if this player party started the scrap or the wild thing is hunting them.
     * Nearby other parties do not auto-join.
     */
    function ownerEngagedWithWild(ownerId, wild, opts = {}) {
        if (!ownerId || !wild) return false;
        if (sameWildTarget(opts.lastHitMob, wild)) return true;
        return wildAggroOwnerId(wild) === ownerId;
    }

    function sameParty(a, b) {
        if (!a || !b || a === b) return false;
        const oa = ownerIdOf(a);
        const ob = ownerIdOf(b);
        if (!oa || !ob) return false;
        return oa === ob;
    }

    function isOwnedPawn(sceneOrOwner, entity) {
        if (!entity) return false;
        if (sceneOrOwner?.party && Array.isArray(sceneOrOwner.party)) {
            return sceneOrOwner.party.includes(entity) || sceneOrOwner.leader === entity;
        }
        const oid = typeof sceneOrOwner === "string" ? sceneOrOwner : ownerIdOf(sceneOrOwner);
        return !!oid && ownerIdOf(entity) === oid;
    }

    function livingParty(list) {
        const out = [];
        for (const p of list || []) {
            if (!p) continue;
            if (p.isBodyDead?.() || p._bodyDead || p.dead) continue;
            if (p.active === false) continue;
            out.push(p);
        }
        return out;
    }

    function distTiles(a, b, tileSize = 16) {
        if (!a || !b) return Infinity;
        const ts = tileSize || 16;
        return Math.hypot((a.x - b.x) / ts, (a.y - b.y) / ts);
    }

    function inInteractRange(a, b, tileSize = 16) {
        const range = Number(a?.interactionRange) || INTERACT_TILES;
        return distTiles(a, b, tileSize) <= range + 0.05;
    }

    /**
     * Best auto-eat stack in the party. In-range meals win; otherwise anything
     * within seek range (so a hungry companion can walk in).
     * @returns {{ pawn, slot, stack, dist, inRange, poison }|null}
     */
    function pickAutoEat(eater, members, opts = {}) {
        if (!eater) return null;
        const ts = Number(opts.tileSize) || 16;
        const interact = (Number(opts.interactTiles) || INTERACT_TILES) * ts;
        const seek = (Number(opts.seekTiles) || FOLLOW_DETACH) * ts;
        const skipId = opts.skipHeld?.id;
        const skipSlot = opts.skipHeld?.slot;
        const getFood = opts.getFood;
        const allowPoison = !!opts.allowPoison;
        const ex = Number(eater.x) || 0;
        const ey = Number(eater.y) || 0;
        const eaterId = eater.id || eater.pawnId;
        const candidates = [];
        for (const p of members || []) {
            if (!p || p.dead || p.isBodyDead?.()) continue;
            const d = Math.hypot((Number(p.x) || 0) - ex, (Number(p.y) || 0) - ey);
            const pid = p.id || p.pawnId;
            const isSelf = p === eater || (eaterId && pid === eaterId);
            if (!isSelf && d > seek) continue;
            const inv = p.inventory || [];
            for (let i = 0; i < inv.length; i++) {
                const stack = inv[i];
                if (!stack) continue;
                if (skipId != null && pid === skipId && i === skipSlot) continue;
                const food = typeof getFood === "function"
                    ? getFood(stack)
                    : (stack.food || null);
                if (!(Number(food?.kc ?? 0) > 0)) continue;
                const poison = Number(food?.foodPoisonChance ?? 0) > 0;
                if (poison && !allowPoison) continue;
                const spoil = Number(stack.spoilAt ?? stack.spoilLeft ?? Infinity);
                candidates.push({
                    pawn: p,
                    slot: i,
                    stack,
                    spoil,
                    own: isSelf,
                    poison,
                    dist: d,
                    inRange: isSelf || d <= interact + 0.05
                });
            }
        }
        candidates.sort((a, b) => {
            if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
            if (a.spoil !== b.spoil) return a.spoil - b.spoil;
            if (a.own !== b.own) return a.own ? -1 : 1;
            return a.dist - b.dist;
        });
        return candidates[0] || null;
    }

    function nearestLiving(list, x, y) {
        let best = null;
        let bestD = Infinity;
        for (const p of livingParty(list)) {
            const d = Math.hypot((p.x || 0) - x, (p.y || 0) - y);
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        return best;
    }

    function followBehind(controlled, tileSize = 16) {
        const ts = tileSize || 16;
        const dist = FOLLOW_BEHIND * ts;
        const facing = controlled?.facing || "down";
        let dx = 0;
        let dy = 1;
        if (facing === "up") dy = -1;
        else if (facing === "left") {
            dx = -1;
            dy = 0;
        } else if (facing === "right") {
            dx = 1;
            dy = 0;
        }
        return {
            x: (controlled?.x || 0) - dx * dist,
            y: (controlled?.y || 0) - dy * dist
        };
    }

    function headingFromFacing(facing) {
        if (facing === "up") return { x: 0, y: -1 };
        if (facing === "left") return { x: -1, y: 0 };
        if (facing === "right") return { x: 1, y: 0 };
        return { x: 0, y: 1 };
    }

    /**
     * Spread trail slot behind `heading` so companions don't share one pixel.
     */
    function followBlobPoint(controlled, heading, index, count, tileSize = 16) {
        const ts = tileSize || 16;
        let hx = heading?.x || 0;
        let hy = heading?.y || 1;
        const len = Math.hypot(hx, hy) || 1;
        hx /= len;
        hy /= len;
        const n = Math.max(1, count);
        const i = Math.max(0, index);
        const mid = (n - 1) / 2;
        const lat = (i - mid) * FOLLOW_SPREAD * ts;
        const extraBack = Math.abs(i - mid) * 0.28 * ts;
        return {
            x: (controlled?.x || 0) - hx * (FOLLOW_BEHIND * ts + extraBack) - hy * lat,
            y: (controlled?.y || 0) - hy * (FOLLOW_BEHIND * ts + extraBack) + hx * lat
        };
    }

    function _randInt(rng, lo, hi) {
        const r = rngOf(rng)();
        return lo + Math.floor(r * (hi - lo + 1));
    }

    function _pickWeighted(table, rng) {
        const rows = table || [];
        let total = 0;
        for (const row of rows) total += Number(row.weight) || 0;
        if (!(total > 0)) return null;
        let r = rngOf(rng)() * total;
        for (const row of rows) {
            r -= Number(row.weight) || 0;
            if (r < 0) return row;
        }
        return rows[rows.length - 1] || null;
    }

    function isPartyFull(partyCount) {
        return (Number(partyCount) || 1) >= CAP;
    }

    /** 1 passerby, or a band of 2–6 once the party is full. */
    function wandererPackSize(partyCount, rng) {
        if (!isPartyFull(partyCount)) return 1;
        return _randInt(rng, PACK_FULL[0], PACK_FULL[1]);
    }

    /**
     * World pixels from the camera/player center to a spawn just beyond the
     * visible edge. `viewW`/`viewH` are the camera world-view size in pixels.
     */
    function wandererApproachDist(tileSize, viewW, viewH) {
        const ts = Number(tileSize) || 16;
        const half = Math.max(Number(viewW) || 0, Number(viewH) || 0) * 0.5;
        return Math.max(16 * ts, half + 6 * ts);
    }

    /** Offsets along the spawn edge so a pack walks in as a line, not a pile. */
    function wandererPackOffsets(count, heading, spacing = 22) {
        const n = Math.max(1, count | 0);
        const hx = Number(heading?.x) || 0;
        const hy = Number(heading?.y) || 0;
        const rx = -hy;
        const ry = hx;
        const mid = (n - 1) / 2;
        const out = [];
        for (let i = 0; i < n; i++) {
            const t = (i - mid) * spacing;
            out.push({ x: rx * t, y: ry * t });
        }
        return out;
    }

    function rollGearId(rng, opts = null) {
        const full = !!(opts && (opts.fullParty || isPartyFull(opts.partyCount)));
        const row = _pickWeighted(full ? GEAR_TABLE_FULL : GEAR_TABLE, rng);
        return row?.id || "pebble";
    }

    function _rollWandererFood(rng, full) {
        const chance = full ? FOOD_CHANCE_FULL : FOOD_CHANCE;
        if (rngOf(rng)() >= chance) return null;
        const table = full
            ? [
                { weight: 0.28, id: "blueberry", lo: 4, hi: 10 },
                { weight: 0.32, id: "apple", lo: 1, hi: 3 },
                { weight: 0.22, id: "roasted_apple", lo: 1, hi: 2 },
                { weight: 0.18, id: "roast_beef", lo: 1, hi: 1 }
            ]
            : [
                { weight: 0.65, id: "blueberry", lo: 2, hi: 6 },
                { weight: 0.35, id: "apple", lo: 1, hi: 2 }
            ];
        const row = _pickWeighted(table, rng);
        if (!row?.id) return null;
        return { id: row.id, quantity: _randInt(rng, row.lo, row.hi) };
    }

    /**
     * Sticks, leaves, pebbles, plus a held weapon when they rolled one.
     * Full parties see better spears and food more often. Always 5 slots.
     */
    function rollWandererInventory(rng, opts = null) {
        const r = rngOf(rng);
        const full = !!(opts && (opts.fullParty || isPartyFull(opts.partyCount)));
        const weaponId = rollGearId(r, { fullParty: full });
        const weapon = (weaponId === "sharp_stick" || weaponId === "wooden_spear" || weaponId === "stone_spear")
            ? { id: weaponId, quantity: 1 }
            : null;
        const inv = [];
        if (weapon) inv.push(weapon);
        inv.push(
            { id: "pebble", quantity: _randInt(r, 2, 4) },
            { id: "stick", quantity: _randInt(r, 2, 5) },
            { id: "leaf", quantity: _randInt(r, 3, 7) }
        );
        const food = _rollWandererFood(r, full);
        if (food) inv.push(food);
        while (inv.length < 5) inv.push(null);
        return inv.slice(0, 5);
    }

    function recruitChance(holdingFood) {
        return holdingFood ? RECRUIT_FOOD : RECRUIT_EMPTY;
    }

    function directorCooldown(partyCount, rng) {
        const [lo, hi] = isPartyFull(partyCount) ? COOLDOWN_FULL : COOLDOWN_ROOM;
        const r = rngOf(rng)();
        return lo + r * (hi - lo);
    }

    function meleeDamageOf(stack, getItem) {
        if (!stack?.id) return 0;
        const meta = typeof getItem === "function" ? getItem(stack.id) : stack;
        const knap = stack.toolClass && Number(stack.knapDamage);
        if (Number.isFinite(knap) && knap > 0) return knap;
        const dmg = Number(meta?.weapon?.melee?.damage ?? meta?.weapon?.damage);
        if (meta?.weapon?.type === "melee" && dmg > 0) return dmg;
        if (stack.toolClass && Number(meta?.weapon?.melee?.damage) > 0) {
            return Number(meta.weapon.melee.damage);
        }
        const attacks = meta?.weapon?.attacks;
        if (meta?.weapon?.type === "melee" && Array.isArray(attacks)) {
            let best = 0;
            for (const a of attacks) {
                if (a?.unarmed || a?.source === "otherHand") continue;
                const ad = Number(a.damage) || 0;
                if (ad > best) best = ad;
            }
            if (best > 0) return best;
        }
        return 0;
    }

    /**
     * Best melee inventory slot (highest damage; ties keep `current` else leftmost).
     */
    function bestMeleeSlot(inventory, getItem, current = 0) {
        const inv = Array.isArray(inventory) ? inventory : [];
        let bestI = -1;
        let bestD = 0;
        for (let i = 0; i < inv.length; i++) {
            const d = meleeDamageOf(inv[i], getItem);
            if (d > bestD + 1e-6) {
                bestD = d;
                bestI = i;
            } else if (Math.abs(d - bestD) <= 1e-6 && d > 0 && i === current) {
                bestI = i;
            }
        }
        if (bestI < 0) return current || 0;
        return bestI;
    }

    function rollRoughKc(rng) {
        const r = rngOf(rng)();
        return Math.round(300 + r * 900);
    }

    /** Non-crippling injury spec, or null. Never a missing limb / downed. */
    function rollRoughInjury(rng) {
        const r = rngOf(rng);
        if (r() >= 0.55) return null;
        const names = ["Left Arm", "Right Arm", "Left Leg", "Right Leg", "Torso"];
        const sharp = r() < 0.4;
        const sev = r() < 0.8 ? 2 + r() * 5 : 7 + r() * 6;
        return {
            partName: names[Math.floor(r() * names.length)],
            id: sharp ? "cut" : "bruise",
            name: sharp ? "Cut" : "Bruise",
            severity: Math.round(sev * 10) / 10,
            permanent: false,
            bleeding: sharp,
            bleedRate: sharp ? 0.06 : 0,
            painPerSeverity: 0.0125,
            tended: false,
            tendQuality: 0
        };
    }

    function clothingSlotFor(meta) {
        const slot = meta?.equip?.slot || meta?.equipment?.slot || meta?.equipSlot || meta?.slot;
        if (slot === "head" || slot === "torso" || slot === "legs" || slot === "feet" || slot === "waist") {
            return slot;
        }
        return null;
    }

    function publicPawn(p, extra = {}) {
        if (!p) return null;
        return {
            id: pawnIdOf(p),
            name: p.pawnName || p.name || "?",
            x: p.x,
            y: p.y,
            facing: p.facing || "down",
            sprint: !!p.isSprinting || !!p.sprint,
            dead: !!(p.isBodyDead?.() || p._bodyDead || p.dead),
            prone: !!(p._downed || p.prone || p._prone),
            look: p.look || null,
            ownerId: ownerIdOf(p),
            leaderId: p.leaderId || extra.leaderId || null,
            attacking: !!(p.isAttacking?.() || (p.attackTimer || 0) > 0),
            attackAngle: p.attackAngle ?? null,
            attackArt: p.attackArt || null,
            ...extra
        };
    }

    function _duelId(entity) {
        return pawnIdOf(entity) || entity?.uid || null;
    }

    function _duelLiving(entity) {
        if (!entity) return false;
        if (entity.isBodyDead?.() || entity._bodyDead || entity._dead || entity.dead) return false;
        if (entity.active === false) return false;
        return true;
    }

    function _duelHash(id) {
        const s = String(id || "");
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function _duelXY(entity) {
        if (!entity) return { x: 0, y: 0 };
        if (typeof entity.bodyCenter === "function") {
            const c = entity.bodyCenter();
            if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
        }
        return { x: Number(entity.x) || 0, y: Number(entity.y) || 0 };
    }

    /**
     * Sticky unique pairing. Occupy-only units (the controlled pawn) claim a
     * target but are not steered. Leftovers pile onto the least-covered enemy.
     * @param {{ entity: object, occupyOnly?: boolean, preferredTarget?: object }[]} entries
     * @param {Map<string, string>|null} prevIds fighterId -> targetId
     * @param {{ tileSize?: number, clusterTiles?: number, canFight?: function }} [opts]
     * @returns {Map<string, object>} fighterId -> enemy entity
     */
    function assignDuels(entries, prevIds, opts = {}) {
        const ts = Number(opts.tileSize) > 0 ? opts.tileSize : 16;
        const clusterPx = (opts.clusterTiles || DUEL_CLUSTER_TILES) * ts;
        const clusterSq = clusterPx * clusterPx;
        const canFight = typeof opts.canFight === "function" ? opts.canFight : null;
        const list = [];
        const seen = new Set();
        for (const raw of entries || []) {
            const entity = raw?.entity || raw;
            if (!_duelLiving(entity)) continue;
            const id = _duelId(entity);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            list.push({
                entity,
                id,
                occupyOnly: !!raw.occupyOnly,
                preferredTarget: raw.preferredTarget || null,
                x: Number(entity.x) || 0,
                y: Number(entity.y) || 0
            });
        }
        const distSq = (a, b) => {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            return dx * dx + dy * dy;
        };
        const enemiesOf = (row) => list.filter((o) => {
            if (o === row || sameFaction(row.entity, o.entity)) return false;
            if (canFight && !canFight(row.entity, o.entity)) return false;
            return distSq(row, o) <= clusterSq;
        });
        const assigned = new Map();
        const counts = new Map();
        const setAssign = (fighter, enemy) => {
            assigned.set(fighter.id, enemy.entity);
            counts.set(enemy.id, (counts.get(enemy.id) || 0) + 1);
        };
        const prev = prevIds instanceof Map ? prevIds : new Map();

        for (const row of list) {
            if (!row.occupyOnly) continue;
            const foes = enemiesOf(row);
            if (!foes.length) continue;
            let pick = null;
            const pref = row.preferredTarget;
            if (pref && _duelLiving(pref)) {
                const pid = _duelId(pref);
                pick = foes.find((f) => f.entity === pref || f.id === pid) || null;
            }
            if (!pick) {
                pick = foes.reduce((best, f) => (distSq(row, f) < distSq(row, best) ? f : best));
            }
            if (pick) setAssign(row, pick);
        }

        const unmatched = [];
        for (const row of list) {
            if (row.occupyOnly) continue;
            const foes = enemiesOf(row);
            if (!foes.length) continue;
            const prevTid = prev.get(row.id);
            const sticky = prevTid ? foes.find((f) => f.id === prevTid) : null;
            if (sticky) {
                const c = counts.get(sticky.id) || 0;
                const hasFree = foes.some((f) => f !== sticky && (counts.get(f.id) || 0) === 0);
                if (c >= 1 && hasFree) unmatched.push(row);
                else setAssign(row, sticky);
            } else {
                unmatched.push(row);
            }
        }

        unmatched.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        for (const row of unmatched) {
            const foes = enemiesOf(row);
            if (!foes.length) continue;
            foes.sort((a, b) => {
                const ca = counts.get(a.id) || 0;
                const cb = counts.get(b.id) || 0;
                if (ca !== cb) return ca - cb;
                return distSq(row, a) - distSq(row, b);
            });
            setAssign(row, foes[0]);
        }
        return assigned;
    }

    /**
     * Walk-to point beside `target` for this fighter.
     * Same-faction allies (including the occupied player) take even bearings
     * around the hurtbox so a pierce through one body misses the rest.
     * The ring is anchored on `opts.occupy`'s current angle when present.
     * @returns {{ x: number, y: number, n: number, flanking: boolean }}
     */
    function duelStandPoint(self, target, assignments, opts = {}) {
        const tc = _duelXY(target);
        if (!self || !target) return { x: tc.x, y: tc.y, n: 1, flanking: false };
        const selfId = _duelId(self);
        const tid = _duelId(target);
        const occupy = opts.occupy || null;
        const seen = new Set();
        const allies = [];
        const add = (e, isOccupy) => {
            if (!e || e === target || !_duelLiving(e)) return;
            if (!sameFaction(self, e)) return;
            const id = _duelId(e);
            if (!id || seen.has(id)) return;
            seen.add(id);
            allies.push({ entity: e, id, occupy: !!isOccupy || e === occupy });
        };
        add(self, false);
        if (occupy) add(occupy, true);
        for (const e of opts.allies || []) add(e, e === occupy);
        if (assignments instanceof Map) {
            for (const e of opts.entities || []) {
                const id = _duelId(e);
                if (!id) continue;
                const assigned = assignments.get(id);
                if (assigned === target || _duelId(assigned) === tid) add(e, e === occupy);
            }
            if (!opts.entities) {
                for (const [fid] of assignments) {
                    if (seen.has(fid)) continue;
                    const assigned = assignments.get(fid);
                    if (assigned !== target && _duelId(assigned) !== tid) continue;
                    seen.add(fid);
                    allies.push({ entity: null, id: fid, occupy: false });
                }
            }
        }
        allies.sort((a, b) => {
            if (a.occupy !== b.occupy) return a.occupy ? -1 : 1;
            return String(a.id).localeCompare(String(b.id));
        });
        const n = Math.max(1, allies.length);
        const idx = Math.max(0, allies.findIndex((a) => a.id === selfId));
        if (n <= 1) {
            const ang = (_duelHash(selfId) % 360) * (Math.PI / 180);
            const r = opts.hashPx != null ? opts.hashPx : DUEL_HASH_OFFSET_PX;
            return {
                x: tc.x + Math.cos(ang) * r,
                y: tc.y + Math.sin(ang) * r,
                n: 1,
                flanking: false
            };
        }
        let base = (_duelHash(tid) % 360) * (Math.PI / 180);
        const occ = allies.find((a) => a.occupy);
        if (occ?.entity) {
            const o = _duelXY(occ.entity);
            const dx = o.x - tc.x;
            const dy = o.y - tc.y;
            if (dx * dx + dy * dy > 1) base = Math.atan2(dy, dx);
        }
        const dist = Math.max(
            opts.standPx != null ? opts.standPx : DUEL_STAND_PX,
            DUEL_STAND_PX
        );
        const ang = base + (idx / n) * Math.PI * 2;
        return {
            x: tc.x + Math.cos(ang) * dist,
            y: tc.y + Math.sin(ang) * dist,
            n,
            flanking: true
        };
    }

    /** Unit vector-ish push away from same-faction bodies that are too close. */
    function duelRepulse(self, others, opts = {}) {
        const sep = opts.sepPx != null ? opts.sepPx : DUEL_ALLY_SEP_PX;
        const from = _duelXY(self);
        let rx = 0;
        let ry = 0;
        for (const o of others || []) {
            if (!o || o === self || !_duelLiving(o)) continue;
            if (!sameFaction(self, o)) continue;
            const p = _duelXY(o);
            const dx = from.x - p.x;
            const dy = from.y - p.y;
            const d = Math.hypot(dx, dy);
            if (d < 0.5 || d >= sep) continue;
            const w = (sep - d) / sep;
            rx += (dx / d) * w;
            ry += (dy / d) * w;
        }
        return { rx, ry };
    }

    /** Downed / dead / corpse — walk and clicks pass through. */
    function walkThrough(entity) {
        if (!entity) return true;
        if (entity.isBodyDead?.() || entity._bodyDead || entity._dead) return true;
        if (entity._downed || entity._prone) return true;
        if (entity.isIncapacitated?.() || entity.isImmobile?.()) return true;
        const stage = entity.entry?.stage;
        if (stage === "corpse" || stage === "carcass") return true;
        return false;
    }

    return {
        CAP,
        COLOR_ALLY,
        COLOR_ENEMY,
        COLOR_NEUTRAL,
        FOLLOW_BEHIND,
        FOLLOW_DETACH,
        FOLLOW_IDLE,
        FOLLOW_CATCH,
        FOLLOW_SPREAD,
        FOLLOW_ARRIVE,
        MILL_RADIUS,
        COMBAT_LEASH,
        INTERACT_TILES,
        DUEL_CLUSTER_TILES,
        DUEL_STAND_PX,
        DUEL_HASH_OFFSET_PX,
        DUEL_ALLY_SEP_PX,
        DUEL_STAND_ARRIVE_PX,
        RECRUIT_EMPTY,
        RECRUIT_FOOD,
        COOLDOWN_ROOM,
        COOLDOWN_FULL,
        AUTO_EAT_BELOW,
        AUTO_EAT_UNTIL,
        WANDER_WALK_MULT,
        WALK_ANIM_TILES_PER_SEC,
        wandererTimeScale,
        walkAnimTimeScale,
        WANDERER_ALERT_TILES,
        GEAR_TABLE,
        GEAR_TABLE_FULL,
        isPartyFull,
        wandererPackSize,
        wandererApproachDist,
        wandererPackOffsets,
        FACTION_WILDLIFE,
        FACTION_WANDERERS,
        ownerIdOf,
        partyFactionId,
        factionOf,
        sameFaction,
        pawnIdOf,
        wildAggroOwnerId,
        setWildAggroOwner,
        clearWildAggroOwner,
        sameWildTarget,
        ownerEngagedWithWild,
        sameParty,
        isOwnedPawn,
        livingParty,
        distTiles,
        inInteractRange,
        pickAutoEat,
        nearestLiving,
        followBehind,
        followBlobPoint,
        headingFromFacing,
        rollGearId,
        rollWandererInventory,
        recruitChance,
        directorCooldown,
        meleeDamageOf,
        bestMeleeSlot,
        rollRoughKc,
        rollRoughInjury,
        clothingSlotFor,
        publicPawn,
        walkThrough,
        assignDuels,
        duelStandPoint,
        duelRepulse
    };
});

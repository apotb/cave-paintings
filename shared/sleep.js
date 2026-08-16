/**
 * Lean-to rest: slots, occupancy, heal bonus, rest clock, salvage.
 * Phaser-free (Node + browser UMD).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        const Place = require("./place");
        module.exports = factory(Place);
    } else {
        root.Sleep = factory(root.Place);
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Place) {
    const CAMP_TILES = 12;
    const REST_TICK = 8;
    const HEAL_BONUS = 8;
    /** Stomach drain while lying in a lean-to (vs idle). */
    const HUNGER_RATE = 0.5;
    const SCALE = 0.85;
    const OPEN_PX = 5;
    /** Close enough to a slot to lie down (tile-center, past the solid). */
    const ARRIVE_PX = 16;

    function place() {
        return Place || (typeof root !== "undefined" ? null : null);
    }

    function isSleepThing(thingDef, entry) {
        return !!(Place && Place.isSleepThing(thingDef, entry));
    }

    function ensureSleepEntry(entry, thingDef) {
        return Place ? Place.ensureSleepEntry(entry, thingDef) : entry;
    }

    function slotCount(thingDef, entry) {
        return Place ? Place.sleepSlotCount(thingDef, entry) : 2;
    }

    function occupantAt(entry, slot) {
        const id = entry?.occupants?.[slot];
        return id || null;
    }

    function isSlotOccupied(entry, slot) {
        return !!occupantAt(entry, slot);
    }

    function isEmpty(entry) {
        const occ = entry?.occupants;
        if (!Array.isArray(occ) || !occ.length) return true;
        return occ.every((id) => !id);
    }

    function slotIndexFromTile(entry, tx, ty, tileSize, thingDef) {
        if (!Place) return -1;
        const tiles = Place.entryFootprintTiles(entry, tileSize, thingDef);
        for (let i = 0; i < tiles.length; i++) {
            if (tiles[i].tx === tx && tiles[i].ty === ty) return i;
        }
        return -1;
    }

    function injuredForAutofill(body) {
        if (!body || typeof body.parts !== "function") return false;
        if ((body.hediffs || []).some((h) => h && h.id === "infection")) return true;
        for (const part of Object.values(body.parts() || {})) {
            if (!part || part.isDead?.()) continue;
            for (const inj of part.injuries || []) {
                if (inj && !inj.permanent) return true;
            }
        }
        return false;
    }

    function capableToFight(pawn) {
        if (!pawn || pawn.isBodyDead?.() || pawn.dead) return false;
        if (pawn._downed || pawn.isIncapacitated?.() || pawn.isImmobile?.()) return false;
        return true;
    }

    /** Open side offset in world pixels (south / west / north / east). */
    function openOffset(rot) {
        const r = Place ? Place.normalizeRot(rot) : (rot || 0);
        if (r === 0) return { x: 0, y: OPEN_PX };
        if (r === 90) return { x: -OPEN_PX, y: 0 };
        if (r === 180) return { x: 0, y: -OPEN_PX };
        return { x: OPEN_PX, y: 0 };
    }

    /** Phaser rotation so the head points at the origin tile. */
    function restRotation(rot) {
        const r = Place ? Place.normalizeRot(rot) : (rot || 0);
        if (r === 0) return Math.PI / 2;
        if (r === 90) return 0;
        if (r === 180) return -Math.PI / 2;
        return Math.PI;
    }

    /** Don't block a pawn walking into / lying in this lean-to. */
    function ignoresThingCollision(pawn, thing) {
        if (!pawn || !thing) return false;
        const entry = thing.entry || thing;
        const uid = entry?.uid || thing.uid;
        if (pawn._restWalk?.uid && uid && pawn._restWalk.uid === uid) return true;
        if (pawn._resting && pawn.lastSleep?.uid && pawn.lastSleep.uid === uid) return true;
        if (pawn._wakeIframes > 0 && pawn.lastSleep?.uid && pawn.lastSleep.uid === uid) return true;
        // Returning to bed: other bunks in camp must not snag the path.
        if (pawn._restWalk && isSleepThing(thing.meta, entry)) return true;
        return false;
    }

    function collideProcess(a, b) {
        if (ignoresThingCollision(a, b) || ignoresThingCollision(b, a)) return false;
        return true;
    }

    function sleeperWorldPos(entry, slot, tileSize, thingDef) {
        const ts = Number(tileSize) || 16;
        if (!Place || !entry) return { x: Number(entry?.x) || 0, y: Number(entry?.y) || 0 };
        const tiles = Place.entryFootprintTiles(entry, ts, thingDef);
        const t = tiles[slot] || tiles[0];
        if (!t) {
            return { x: Number(entry.x) || 0, y: Number(entry.y) || 0 };
        }
        const off = openOffset(entry.rot);
        return {
            x: t.tx * ts + ts / 2 + off.x,
            y: t.ty * ts + ts / 2 + off.y
        };
    }

    function footprintBounds(entry, tileSize, thingDef) {
        const ts = Number(tileSize) || 16;
        const tiles = Place ? Place.entryFootprintTiles(entry, ts, thingDef) : [];
        const origin = (tiles && tiles[0]) || (Place && Place.originTileOf(entry, ts));
        if (!origin) return null;
        let minTx = origin.tx;
        let maxTx = origin.tx;
        let minTy = origin.ty;
        let maxTy = origin.ty;
        for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            if (t.tx < minTx) minTx = t.tx;
            if (t.tx > maxTx) maxTx = t.tx;
            if (t.ty < minTy) minTy = t.ty;
            if (t.ty > maxTy) maxTy = t.ty;
        }
        return { minTx, maxTx, minTy, maxTy, ts };
    }

    /**
     * Standing feet (origin 0,1) in the tile directly outside the open side,
     * centered on that edge. sleeperWorldPos is body-center in a bunk.
     */
    function besideWorldPos(entry, tileSize, thingDef) {
        const b = footprintBounds(entry, tileSize, thingDef);
        if (!b) return { x: Number(entry?.x) || 0, y: Number(entry?.y) || 0 };
        const r = Place.normalizeRot(entry.rot);
        const ts = b.ts;
        const midX = (b.minTx + b.maxTx + 1) * ts * 0.5;
        const midFeetY = (b.minTy + b.maxTy) * ts * 0.5 + ts;
        // cx is sprite-center in the front tile; standing origin (0,1) is feet-left.
        let cx;
        let feetY;
        if (r === 90) {
            cx = b.minTx * ts - ts * 0.5;
            feetY = midFeetY;
        } else if (r === 270) {
            cx = (b.maxTx + 1) * ts + ts * 0.5;
            feetY = midFeetY;
        } else if (r === 180) {
            cx = midX;
            feetY = b.minTy * ts;
        } else {
            cx = midX;
            feetY = (b.maxTy + 1) * ts + ts;
        }
        return { x: cx - ts * 0.5, y: feetY };
    }

    function inCampRange(ax, ay, bx, by, tileSize) {
        const ts = Number(tileSize) || 16;
        const r = CAMP_TILES * ts;
        const dx = Number(ax) - Number(bx);
        const dy = Number(ay) - Number(by);
        return dx * dx + dy * dy <= r * r;
    }

    function inHarvestRange(px, py, entry, tileSize, rangeTiles, thingDef) {
        if (!Place || !entry) return false;
        const ts = Number(tileSize) || 16;
        const range = Number(rangeTiles) || 4;
        const tiles = Place.entryFootprintTiles(entry, ts, thingDef);
        for (const t of tiles) {
            const { x, y } = { x: t.tx * ts + ts / 2, y: t.ty * ts + ts };
            if (Place.inPlaceRange(px, py, x, y, ts, range)) return true;
        }
        return false;
    }

    /**
     * Per-unit 50% salvage of a recipe map `{ id: qty }`.
     */
    function salvageStacks(recipe, rng) {
        const roll = typeof rng === "function" ? rng : Math.random;
        const out = [];
        if (!recipe || typeof recipe !== "object") return out;
        for (const [id, raw] of Object.entries(recipe)) {
            if (Place && Place.isRecipeMetaKey && Place.isRecipeMetaKey(id)) continue;
            if (id === "QUANTITY") continue;
            const qty = (raw && typeof raw === "object") ? (+raw.qty || 1) : (+raw || 0);
            let n = 0;
            for (let i = 0; i < qty; i++) {
                if (roll() < 0.5) n++;
            }
            if (n > 0) out.push({ id, quantity: n });
        }
        return out;
    }

    /**
     * Place salvage piles around the footprint tiles instead of one pixel.
     */
    function scatterSalvagePiles(stacks, tiles, tileSize, rng) {
        const ts = Number(tileSize) || 16;
        const roll = typeof rng === "function" ? rng : Math.random;
        const spots = (tiles && tiles.length) ? tiles : null;
        const list = (stacks || []).filter((s) => s?.id && s.quantity > 0);
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(roll() * (i + 1));
            const tmp = list[i];
            list[i] = list[j];
            list[j] = tmp;
        }
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            let cx;
            let cy;
            if (spots) {
                const t = spots[i % spots.length];
                cx = t.tx * ts + ts / 2;
                cy = t.ty * ts + ts;
            } else {
                cx = 0;
                cy = 0;
            }
            const jx = (roll() - 0.5) * ts * 0.75;
            const jy = (roll() - 0.5) * ts * 0.55;
            out.push({
                id: s.id,
                quantity: s.quantity,
                x: cx + jx,
                y: cy + jy
            });
        }
        return out;
    }

    function effectiveTickSpeed(base, everyoneLying) {
        const b = Number(base);
        const baseN = Number.isFinite(b) && b >= 0 ? b : 1;
        if (!everyoneLying) return baseN;
        return Math.max(REST_TICK, baseN);
    }

    function pawnIdOf(pawn) {
        return pawn?.pawnId || pawn?.id || null;
    }

    function hungerMult(resting) {
        return resting ? HUNGER_RATE : 1;
    }

    /**
     * Find this pawn's bunk in persisted chunk things. Occupancy wins over
     * lastSleep uid so rest does not follow a character into another world.
     */
    function bedInChunkMap(chunks, pawnId, lastSleep) {
        if (!chunks) return null;
        const vals = typeof chunks.values === "function" ? chunks.values() : Object.values(chunks);
        let byUid = null;
        const uid = lastSleep?.uid || null;
        const wantSlot = Number.isFinite(lastSleep?.slot) ? lastSleep.slot : 0;
        for (const c of vals) {
            const lists = [c?.things, c?.meta?.things];
            for (const things of lists) {
                if (!Array.isArray(things)) continue;
                for (const t of things) {
                    if (!t) continue;
                    if (pawnId && Array.isArray(t.occupants)) {
                        const slot = t.occupants.indexOf(pawnId);
                        if (slot >= 0) return { entry: t, slot };
                    }
                    if (uid && t.uid === uid) {
                        byUid = { entry: t, slot: wantSlot };
                    }
                }
            }
        }
        return byUid;
    }

    function clearOccupantInChunkMap(chunks, pawnId) {
        if (!chunks || !pawnId) return;
        const vals = typeof chunks.values === "function" ? chunks.values() : Object.values(chunks);
        for (const c of vals) {
            const lists = [c?.things, c?.meta?.things];
            for (const things of lists) {
                if (!Array.isArray(things)) continue;
                for (const t of things) {
                    if (!Array.isArray(t?.occupants)) continue;
                    for (let i = 0; i < t.occupants.length; i++) {
                        if (t.occupants[i] === pawnId) t.occupants[i] = null;
                    }
                }
            }
        }
    }

    return {
        CAMP_TILES,
        REST_TICK,
        HEAL_BONUS,
        HUNGER_RATE,
        hungerMult,
        bedInChunkMap,
        clearOccupantInChunkMap,
        SCALE,
        ARRIVE_PX,
        ignoresThingCollision,
        collideProcess,
        isSleepThing,
        ensureSleepEntry,
        slotCount,
        occupantAt,
        isSlotOccupied,
        isEmpty,
        slotIndexFromTile,
        injuredForAutofill,
        capableToFight,
        openOffset,
        restRotation,
        sleeperWorldPos,
        besideWorldPos,
        inCampRange,
        inHarvestRange,
        salvageStacks,
        scatterSalvagePiles,
        effectiveTickSpeed,
        pawnIdOf
    };
});

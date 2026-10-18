/**
 * Shore fishing. Counts connected water from one tile and stops at 400.
 * Hitting that cap is open water: no stock. A smaller body is one closed pool.
 * Phaser-free (Node + browser UMD). Callers pass an isWater test; this file
 * does not generate chunks.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Fish = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const TILE_CAP = 400;
    const MIN_TILES = 75;
    const BASE_MAX = 400;
    const CAST_MS = 30000;
    const OPEN_HAUL = 3;
    const REGEN_PER_DAY = 0.025;
    const DAY_MINUTES = 1440;
    const TILE = 16;
    const PAWN_W = 16;
    const ROD_ID = "flimsy_rod";
    const GRUB_ID = "grub";
    const FISH_ID = "raw_fish";
    const NEST_ID = "grub_nest";
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    /**
     * Closed-pool maximum. Under 75 tiles there are no fish.
     * 75 is a maximum of 0. The penalty fades linearly and is gone at 400.
     * @param {number} count
     * @returns {number|null} null when the count is the open-water cap
     */
    function maxForCount(count) {
        const n = Math.floor(Number(count) || 0);
        if (n >= TILE_CAP) return null;
        if (n < MIN_TILES) return 0;
        return Math.round(BASE_MAX * (n - MIN_TILES) / (TILE_CAP - MIN_TILES));
    }

    /**
     * Fish this cast brings up. Half of the shore curve, so 25→1, 100→2, and 300→3.
     * Never below 1 when the water has a fish, never more than the population.
     */
    function yieldForPop(pop) {
        const p = Number(pop);
        if (!(p >= 1)) return 0;
        let raw;
        if (p <= 25) raw = 1;
        else if (p >= 300) raw = 6;
        else if (p <= 100) raw = 1 + (p - 25) * (2 / 75);
        else raw = 3 + (p - 100) * (3 / 200);
        let n = Math.round(Math.round(raw) / 2);
        if (n < 1) n = 1;
        const cap = Math.floor(p);
        if (n > cap) n = cap;
        return n >= 1 ? n : 0;
    }

    /**
     * 4-connected water count. Stops at 400 tiles and does not look further.
     * @param {number} tx
     * @param {number} ty
     * @param {(x: number, y: number) => boolean} isWater
     */
    function measure(tx, ty, isWater) {
        const empty = { open: false, count: 0, max: 0, anchor: null, tiles: [] };
        if (typeof isWater !== "function") return empty;
        const sx = tx | 0;
        const sy = ty | 0;
        if (!isWater(sx, sy)) return empty;
        const tiles = [[sx, sy]];
        const seen = new Set([sx + "," + sy]);
        let head = 0;
        let minX = sx;
        let minY = sy;
        while (head < tiles.length && tiles.length < TILE_CAP) {
            const [x, y] = tiles[head++];
            for (let i = 0; i < DIRS.length; i++) {
                if (tiles.length >= TILE_CAP) break;
                const nx = x + DIRS[i][0];
                const ny = y + DIRS[i][1];
                const key = nx + "," + ny;
                if (seen.has(key)) continue;
                if (!isWater(nx, ny)) continue;
                if (tiles.length >= TILE_CAP) break;
                seen.add(key);
                tiles.push([nx, ny]);
                if (nx < minX || (nx === minX && ny < minY)) {
                    minX = nx;
                    minY = ny;
                }
            }
        }
        if (tiles.length >= TILE_CAP) {
            return { open: true, count: TILE_CAP, max: null, anchor: null, tiles };
        }
        const max = maxForCount(tiles.length);
        return {
            open: false,
            count: tiles.length,
            max,
            anchor: minX + "," + minY,
            tiles
        };
    }

    function fishable(measured, fisheries) {
        if (!measured) return false;
        if (measured.open) return true;
        if (!(Number(measured.max) >= 1)) return false;
        const rec = measured.anchor && fisheries ? fisheries[measured.anchor] : null;
        const pop = rec ? Number(rec.pop) : Number(measured.max);
        return pop >= 1;
    }

    /**
     * Reserve the haul. Closed pools write `{ id, pop, max }` immediately,
     * already reduced, so a second cast cannot take the same fish.
     * Open water writes nothing.
     */
    function beginCast(fisheries, measured) {
        if (!measured) return { ok: false, reason: "empty" };
        if (measured.open) return { ok: true, open: true, haul: OPEN_HAUL };
        const max = Number(measured.max);
        if (!(max >= 1) || !measured.anchor) return { ok: false, reason: "empty" };
        if (!fisheries || typeof fisheries !== "object") return { ok: false, reason: "empty" };
        let rec = fisheries[measured.anchor];
        if (!rec) {
            rec = { pop: max, max };
            fisheries[measured.anchor] = rec;
        }
        const haul = yieldForPop(rec.pop);
        if (!(haul >= 1)) return { ok: false, reason: "empty" };
        rec.pop = Number(rec.pop) - haul;
        return { ok: true, open: false, haul, id: measured.anchor, max: rec.max };
    }

    function cancelCast(fisheries, id, haul) {
        if (!fisheries || !id) return;
        const rec = fisheries[id];
        if (!rec) return;
        const back = Math.max(0, Number(haul) || 0);
        const max = Number(rec.max);
        const next = Number(rec.pop) + back;
        rec.pop = Number.isFinite(max) ? Math.min(max, next) : next;
    }

    /**
     * 2.5% of each written pool's maximum per game day. Ignores pools that
     * were never fished. Open water has no record, so it does not regen.
     */
    function regen(fisheries, minutes) {
        if (!fisheries || typeof fisheries !== "object") return;
        const mins = Number(minutes) || 0;
        if (!(mins > 0)) return;
        const frac = (mins / DAY_MINUTES) * REGEN_PER_DAY;
        for (const rec of Object.values(fisheries)) {
            if (!rec || !(Number(rec.max) > 0)) continue;
            const next = Number(rec.pop) + Number(rec.max) * frac;
            rec.pop = Math.min(Number(rec.max), next);
        }
    }

    /**
     * The pawn pose is the sprite's bottom-left, and the body is a tile wide.
     * The stand is any land tile those feet cover whose faced neighbor is water.
     * @param {number} x
     * @param {number} y
     * @param {string} facing
     * @param {(tx: number, ty: number) => string} tileKeyAt
     * @returns {{ standTx: number, standTy: number, tx: number, ty: number }|null}
     */
    function castTile(x, y, facing, tileKeyAt) {
        if (typeof tileKeyAt !== "function") return null;
        const left = Number(x) || 0;
        const feetY = Number(y) || 0;
        const ty = Math.floor(feetY / TILE);
        const tx0 = Math.floor(left / TILE);
        const tx1 = Math.floor((left + PAWN_W - 0.001) / TILE);
        const face = facing || "down";
        let dx = 0;
        let dy = 1;
        if (face === "right") { dx = 1; dy = 0; }
        else if (face === "left") { dx = -1; dy = 0; }
        else if (face === "up") { dx = 0; dy = -1; }
        const cx = left + PAWN_W * 0.5;
        let best = null;
        let bestD = Infinity;
        for (let tx = tx0; tx <= tx1; tx++) {
            const ground = tileKeyAt(tx, ty);
            if (ground === "water" || ground === "ice") continue;
            const waterTx = tx + dx;
            const waterTy = ty + dy;
            if (tileKeyAt(waterTx, waterTy) !== "water") continue;
            const d = Math.abs((tx + 0.5) * TILE - cx);
            if (d < bestD) {
                bestD = d;
                best = { standTx: tx, standTy: ty, tx: waterTx, ty: waterTy };
            }
        }
        return best;
    }

    /** Direction from the stand tile into the water. */
    function shoreFacing(standTx, standTy, waterTx, waterTy) {
        const dx = (waterTx | 0) - (standTx | 0);
        const dy = (waterTy | 0) - (standTy | 0);
        if (dx > 0) return "right";
        if (dx < 0) return "left";
        if (dy > 0) return "down";
        if (dy < 0) return "up";
        return null;
    }

    /** True while the feet still cover the stand tile the cast started on. */
    function feetCover(x, y, standTx, standTy) {
        const left = Number(x) || 0;
        const ty = Math.floor((Number(y) || 0) / TILE);
        if (ty !== (standTy | 0)) return false;
        const tx0 = Math.floor(left / TILE);
        const tx1 = Math.floor((left + PAWN_W - 0.001) / TILE);
        const tx = standTx | 0;
        return tx >= tx0 && tx <= tx1;
    }

    /** Tiles from the stand into the water. A shore cast is 1. */
    function castRangeTiles(standTx, standTy, waterTx, waterTy) {
        const d = Math.max(
            Math.abs((waterTx | 0) - (standTx | 0)),
            Math.abs((waterTy | 0) - (standTy | 0))
        );
        return Math.max(1, d);
    }

    /**
     * The line holds while any tile under the feet is within reach of the bait.
     * Reach is in tiles, chebyshev, measured from the water tile.
     */
    function lineHolds(x, y, waterTx, waterTy, reachTiles) {
        const reach = Math.max(1, Math.floor(Number(reachTiles) || 0));
        const left = Number(x) || 0;
        const ty = Math.floor((Number(y) || 0) / TILE);
        const tx0 = Math.floor(left / TILE);
        const tx1 = Math.floor((left + PAWN_W - 0.001) / TILE);
        const wx = waterTx | 0;
        const wy = waterTy | 0;
        for (let tx = tx0; tx <= tx1; tx++) {
            if (Math.max(Math.abs(tx - wx), Math.abs(ty - wy)) <= reach) return true;
        }
        return false;
    }

    function fmtPop(n) {
        const v = Math.round(Number(n) * 10) / 10;
        if (!Number.isFinite(v)) return "0";
        if (Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
        return v.toFixed(1);
    }

    function describe(measured, fisheries) {
        if (!measured || measured.count < 1) return null;
        if (measured.open) return "Population: bountiful";
        const rec = measured.anchor && fisheries ? fisheries[measured.anchor] : null;
        const max = Number(measured.max) || 0;
        const pop = rec ? Number(rec.pop) : max;
        return `Population: ${fmtPop(pop)}/${fmtPop(max)}`;
    }

    return {
        TILE_CAP,
        MIN_TILES,
        BASE_MAX,
        CAST_MS,
        OPEN_HAUL,
        REGEN_PER_DAY,
        ROD_ID,
        GRUB_ID,
        FISH_ID,
        NEST_ID,
        maxForCount,
        yieldForPop,
        measure,
        castTile,
        shoreFacing,
        feetCover,
        castRangeTiles,
        lineHolds,
        fishable,
        beginCast,
        cancelCast,
        regen,
        describe
    };
});

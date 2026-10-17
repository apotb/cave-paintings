const { test } = require("node:test");
const assert = require("node:assert/strict");

test("abandoned camp structure gen", { timeout: 120000 }, () => {
/**
 * Determinism / occupancy checks for abandoned-camp structure gen.
 */
const WorldGen = require("../shared/sim/WorldGen");
const Structures = require("../shared/structures");

const seed = WorldGen.pickWorldSeed(20260814);
WorldGen.applySeed(seed);

function tileKeyAt(tx, ty) {
    return WorldGen.tileKeyAt(tx, ty);
}

const type = Structures.typeById(Structures.getConfig(), "abandoned_camp");
if (!type) throw new Error("missing abandoned_camp type");

let found = null;
let foundCell = null;
for (let cy = -4; cy <= 4 && !found; cy++) {
    for (let cx = -4; cx <= 4; cx++) {
        const inst = Structures.resolveTypeCell(type, cx, cy, seed, tileKeyAt);
        if (inst) {
            found = inst;
            foundCell = { cx, cy };
        }
    }
}
if (!found) throw new Error("no abandoned camp in ±4 cells (try another seed start)");

const fireChunkX = Math.floor(found.fireTx / 8);
const fireChunkY = Math.floor(found.fireTy / 8);

function campThings(chunk) {
    return (chunk.things || [])
        .filter((e) =>
            e.id === "unlit_campfire"
            || e.id === "lean_to"
            || e.id === "wicker_basket"
            || e.id === "skinworking_bench"
            || e.id === "grindstone"
            || e.id === "painting_circle"
            || e.id === "storage_pit"
        )
        .map((e) => ({
            id: e.id,
            x: e.x,
            y: e.y,
            rot: e.rot,
            slots: e.slots || null,
            fuel: e.fuel || null
        }))
        .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
}

function makeStore() {
    Structures.clearPending(seed);
    const chunks = new Map();
    const getGeneratedChunk = (cx, cy) => {
        const ch = chunks.get(`${cx},${cy}`);
        if (!ch?.tiles) return null;
        return {
            cx,
            cy,
            tileSize: 16,
            things: ch.things,
            lootableThings: ch.lootableThings,
            tiles: ch.tiles
        };
    };
    const ensure = (cx, cy) => {
        const k = `${cx},${cy}`;
        if (chunks.has(k)) return chunks.get(k);
        for (const p of Structures.parentFireChunks(cx, cy, seed, tileKeyAt)) {
            if (p.cx === cx && p.cy === cy) continue;
            ensure(p.cx, p.cy);
        }
        if (chunks.has(k)) return chunks.get(k);
        const ch = WorldGen.generateChunk(cx, cy, seed, { getGeneratedChunk });
        chunks.set(k, ch);
        return ch;
    };
    return { ensure, chunks };
}

function allCampThings(inst) {
    const store = makeStore();
    store.ensure(Math.floor(inst.fireTx / 8), Math.floor(inst.fireTy / 8));
    for (const t of inst.footprints) {
        store.ensure(Math.floor(t.tx / 8), Math.floor(t.ty / 8));
    }
    const things = [];
    for (const ch of store.chunks.values()) things.push(...campThings(ch));
    return things.sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
}

const a = allCampThings(found);
const b = allCampThings(found);
const ja = JSON.stringify(a);
const jb = JSON.stringify(b);
if (ja !== jb) throw new Error("camp stamp not deterministic");
if (!a.some((e) => e.id === "unlit_campfire")) {
    throw new Error("expected unlit campfire");
}
if (!a.some((e) => e.id === "lean_to")) {
    throw new Error("expected lean-to");
}
if (!a.some((e) => e.id === "wicker_basket")) {
    throw new Error("expected wicker basket");
}

const fire = a.find((e) => e.id === "unlit_campfire");
if (fire.fuel && fire.fuel.some(Boolean)) throw new Error("campfire should be empty");

const baskets = a.filter((e) => e.id === "wicker_basket");
const basketLoot = {
    rot: [1, 3],
    stick: [2, 6],
    pebble: [1, 4],
    leaf_cord: [1, 2]
};
for (const basket of baskets) {
    assert.equal(basket.slots.length, 8);
    for (const stack of basket.slots) {
        if (!stack) continue;
        if (stack.id === "stone_spear" || stack.id === "wooden_spear") {
            assert.equal(stack.quantity, 1);
            const max = stack.id === "stone_spear" ? 120 : 100;
            assert.ok(stack.durability >= max * 0.25 && stack.durability <= max * 0.55);
            if (stack.id === "stone_spear") {
                const tx = Math.round((basket.x - 8) / 16);
                const ty = Math.round((basket.y - 16) / 16);
                assert.equal(stack.knapMaterial, "pebble");
                assert.equal(stack.stone, WorldGen.rockStoneAt(tx, ty));
            }
            continue;
        }
        const bounds = basketLoot[stack.id];
        assert.ok(bounds, `unexpected basket loot ${stack.id}`);
        assert.ok(stack.quantity >= bounds[0] && stack.quantity <= bounds[1]);
        if (stack.id === "pebble") {
            const tx = Math.round((basket.x - 8) / 16);
            const ty = Math.round((basket.y - 16) / 16);
            assert.equal(stack.stone, WorldGen.rockStoneAt(tx, ty));
        }
    }
}

{
    Structures.clearPending(seed);
    const satelliteKeys = new Set();
    for (const t of found.footprints) {
        const ccx = Math.floor(t.tx / 8);
        const ccy = Math.floor(t.ty / 8);
        if (ccx === fireChunkX && ccy === fireChunkY) continue;
        satelliteKeys.add(`${ccx},${ccy}`);
    }
    for (const key of satelliteKeys) {
        const [ccx, ccy] = key.split(",").map(Number);
        const ch = WorldGen.generateChunk(ccx, ccy, seed);
        const stray = campThings(ch);
        if (stray.some((e) => e.id === "wicker_basket") && !stray.some((e) => e.id === "unlit_campfire")) {
            throw new Error(`orphan basket in chunk ${key} without generating the fire chunk`);
        }
        if (stray.some((e) => e.id === "unlit_campfire")) {
            throw new Error(`satellite chunk ${key} stamped a campfire`);
        }
    }
}

{
    const keys = [];
    const seen = new Set();
    const add = (tx, ty) => {
        const k = `${Math.floor(tx / 8)},${Math.floor(ty / 8)}`;
        if (seen.has(k)) return;
        seen.add(k);
        keys.push(k);
    };
    for (const t of found.footprints) add(t.tx, t.ty);
    add(found.fireTx, found.fireTy);
    keys.sort();
    keys.push(keys.shift());
    const store = makeStore();
    for (const key of keys) {
        const [cx, cy] = key.split(",").map(Number);
        store.ensure(cx, cy);
    }
    const things = [];
    for (const ch of store.chunks.values()) things.push(...campThings(ch));
    if (!things.some((e) => e.id === "unlit_campfire")) {
        throw new Error("shuffled gen missing campfire");
    }
    if (things.some((e) => e.id === "wicker_basket") && !things.some((e) => e.id === "unlit_campfire")) {
        throw new Error("shuffled gen produced a basket without a fire");
    }
}

{
    const store = makeStore();
    store.ensure(fireChunkX, fireChunkY);
    for (const t of found.footprints) {
        store.ensure(Math.floor(t.tx / 8), Math.floor(t.ty / 8));
    }
    for (const t of found.footprints) {
        const ccx = Math.floor(t.tx / 8);
        const ccy = Math.floor(t.ty / 8);
        const ch = store.ensure(ccx, ccy);
        const hit = (ch.things || []).some((e) => {
            if (e.id === "unlit_campfire" || e.id === "lean_to" || e.id === "wicker_basket" || e.id === "skinworking_bench" || e.id === "grindstone" || e.id === "painting_circle" || e.id === "storage_pit") {
                return false;
            }
            const etx = Math.floor(Number(e.x) / 16);
            const ety = Math.floor((Number(e.y) - 1) / 16);
            return etx === t.tx && ety === t.ty;
        });
        const hitLoot = (ch.lootableThings || []).some((e) => {
            const etx = Math.floor(Number(e.x) / 16);
            const ety = Math.floor((Number(e.y) - 1) / 16);
            return etx === t.tx && ety === t.ty;
        });
        if (hit || hitLoot) throw new Error(`footprint ${t.tx},${t.ty} still has natural decor`);
    }
}

let mountainNull = false;
for (let cy = -12; cy <= 12 && !mountainNull; cy++) {
    for (let cx = -12; cx <= 12; cx++) {
        const ct = (type.cellChunks || 16) * 8;
        const ox = cx * ct + (ct >> 1);
        const oy = cy * ct + (ct >> 1);
        const key = tileKeyAt(ox, oy);
        if (key === "mountain" || key === "mesa" || key === "snow_mountain") {
            const inst = Structures.resolveTypeCell(type, cx, cy, seed, tileKeyAt);
            if (inst) throw new Error(`camp spawned on ${key} cell ${cx},${cy}`);
            mountainNull = true;
        }
    }
}

const originCovered = found.footprints.some((t) => t.tx === 0 && t.ty === 0);
if (originCovered) throw new Error("camp covers origin tile");
assert.ok(found);
});

test("abandoned camp storage pit", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const Structures = require("../shared/structures");
    const Place = require("../shared/place");

    const seed = WorldGen.pickWorldSeed(20260814);
    WorldGen.applySeed(seed);
    const type = Structures.typeById(Structures.getConfig(), "abandoned_camp");
    const pitGround = new Set(["grass", "grass_hill", "snow", "snow_hill"]);
    const lootQty = { rot: [1, 3], coconut: [1, 2], apple: [1, 3] };

    const camps = [];
    for (let cy = -8; cy <= 8; cy++) {
        for (let cx = -8; cx <= 8; cx++) {
            const inst = Structures.resolveTypeCell(type, cx, cy, seed, WorldGen.tileKeyAt);
            if (inst) camps.push(inst);
        }
    }
    const withPit = camps.filter((inst) => inst.spawned.some((s) => s.piece.id === "storage_pit"));
    assert.ok(camps.length >= 8, `expected several camps, got ${camps.length}`);
    assert.ok(withPit.length > 0, "expected some camps to roll a storage pit");
    assert.ok(withPit.length < camps.length, "storage pit should stay optional");

    for (const inst of withPit) {
        for (const s of inst.spawned) {
            if (s.piece.id !== "storage_pit") continue;
            const key = WorldGen.tileKeyAt(s.tx, s.ty);
            assert.ok(pitGround.has(key), `storage pit on ${key}`);
        }
    }

    function stampCamp(inst) {
        Structures.clearPending(seed);
        const chunks = new Map();
        const touch = (cx, cy) => {
            const k = `${cx},${cy}`;
            if (!chunks.has(k)) chunks.set(k, { cx, cy, tileSize: 16, things: [], lootableThings: [] });
            return chunks.get(k);
        };
        const fireCx = Math.floor(inst.fireTx / 8);
        const fireCy = Math.floor(inst.fireTy / 8);
        const order = [[fireCx, fireCy]];
        for (const s of inst.spawned) {
            const cx = Math.floor(s.tx / 8);
            const cy = Math.floor(s.ty / 8);
            if (!order.some(([x, y]) => x === cx && y === cy)) order.push([cx, cy]);
        }
        for (const [cx, cy] of order) {
            const ch = touch(cx, cy);
            Structures.stampChunk({
                cx,
                cy,
                worldSeed: seed,
                tileKeyAt: WorldGen.tileKeyAt,
                things: ch.things,
                lootableThings: ch.lootableThings,
                getGeneratedChunk: (x, y) => chunks.get(`${x},${y}`) || null
            });
        }
        return [...chunks.values()].flatMap((ch) => ch.things || []);
    }

    let emptySlots = 0;
    let filled = { rot: 0, coconut: 0, apple: 0 };
    const sample = withPit.slice(0, 24);
    for (const inst of sample) {
        const things = stampCamp(inst);
        const pits = things.filter((e) => e.id === "storage_pit");
        assert.equal(pits.length, inst.spawned.filter((s) => s.piece.id === "storage_pit").length);
        for (const pit of pits) {
            assert.equal(pit.digProgress, 1);
            assert.equal(pit.slots.length, 6);
            assert.equal(Place.pitFinished(pit), true);
            const s = inst.spawned.find((p) => p.piece.id === "storage_pit");
            const ground = WorldGen.tileKeyAt(s.tx, s.ty);
            assert.equal(pit.fillId, ground === "snow" || ground === "snow_hill" ? "snow" : "dirt");
            for (const stack of pit.slots) {
                if (!stack) {
                    emptySlots += 1;
                    continue;
                }
                const bounds = lootQty[stack.id];
                assert.ok(bounds, `unexpected pit loot ${stack.id}`);
                assert.ok(stack.quantity >= bounds[0] && stack.quantity <= bounds[1]);
                filled[stack.id] += 1;
            }
        }
    }
    assert.ok(emptySlots > 0, "a pit slot should be able to roll empty");
    assert.ok(filled.rot > filled.coconut + filled.apple, "pit loot should be mostly rot");
    assert.ok(filled.coconut + filled.apple > 0, "pit loot should sometimes include fruit");
});

test("a rock's stone matches the tile noise map", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const seed = WorldGen.pickWorldSeed(20260814);
    WorldGen.applySeed(seed);
    let rock = null;
    let tile = null;
    for (let cy = -6; cy <= 6 && !rock; cy++) {
        for (let cx = -6; cx <= 6 && !rock; cx++) {
            const chunk = WorldGen.generateChunk(cx, cy, seed);
            const found = (chunk.things || []).find((e) => e.id === "rock" && e.stone);
            if (!found) continue;
            rock = found;
            tile = {
                tx: Math.round((found.x - 8) / 16),
                ty: Math.round((found.y - 16) / 16)
            };
        }
    }
    assert.ok(rock, "expected a rock in the sample");
    assert.equal(rock.stone, WorldGen.rockStoneAt(tile.tx, tile.ty));
});

test("basket stone spear uses the stone a rock on that tile would have", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const Structures = require("../shared/structures");
    const seed = WorldGen.pickWorldSeed(20260814);
    WorldGen.applySeed(seed);
    const cfg = structuredClone(Structures.getConfig());
    cfg.lootTables.abandoned_basket = {
        slots: 8,
        eachSlot: true,
        empty: 0,
        junk: [],
        weapons: [
            { id: "stone_spear", chance: 1, durability: 120, durabilityFrac: [0.25, 0.55], localStone: true }
        ]
    };
    const type = Structures.typeById(cfg, "abandoned_camp");
    let inst = null;
    for (let cy = -4; cy <= 4 && !inst; cy++) {
        for (let cx = -4; cx <= 4; cx++) {
            inst = Structures.resolveTypeCell(type, cx, cy, seed, WorldGen.tileKeyAt);
            if (inst) break;
        }
    }
    assert.ok(inst);
    const chunks = new Map();
    const touch = (cx, cy) => {
        const k = `${cx},${cy}`;
        if (!chunks.has(k)) chunks.set(k, { cx, cy, tileSize: 16, things: [], lootableThings: [] });
        return chunks.get(k);
    };
    const order = [[Math.floor(inst.fireTx / 8), Math.floor(inst.fireTy / 8)]];
    for (const s of inst.spawned) {
        const cx = Math.floor(s.tx / 8);
        const cy = Math.floor(s.ty / 8);
        if (!order.some(([x, y]) => x === cx && y === cy)) order.push([cx, cy]);
    }
    Structures.clearPending(seed);
    for (const [cx, cy] of order) {
        const ch = touch(cx, cy);
        Structures.stampChunk({
            cx, cy, worldSeed: seed, config: cfg,
            tileKeyAt: WorldGen.tileKeyAt,
            things: ch.things,
            lootableThings: ch.lootableThings,
            getGeneratedChunk: (x, y) => chunks.get(`${x},${y}`) || null
        });
    }
    const baskets = [...chunks.values()].flatMap((ch) => ch.things || []).filter((e) => e.id === "wicker_basket");
    assert.ok(baskets.length > 0);
    for (const basket of baskets) {
        const tx = Math.round((basket.x - 8) / 16);
        const ty = Math.round((basket.y - 16) / 16);
        const stone = WorldGen.rockStoneAt(tx, ty);
        assert.equal(basket.slots.length, 8);
        assert.ok(basket.slots.every((s) => s && s.id === "stone_spear" && s.stone === stone && s.knapMaterial === "pebble"));
    }
});

test("basket pebble uses the stone a rock on that tile would have", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const Structures = require("../shared/structures");
    const seed = WorldGen.pickWorldSeed(20260814);
    WorldGen.applySeed(seed);
    const cfg = structuredClone(Structures.getConfig());
    cfg.lootTables.abandoned_basket = {
        slots: 8,
        eachSlot: true,
        junk: [
            { id: "pebble", weight: 1, min: 1, max: 1, localStone: true }
        ]
    };
    const type = Structures.typeById(cfg, "abandoned_camp");
    let inst = null;
    for (let cy = -4; cy <= 4 && !inst; cy++) {
        for (let cx = -4; cx <= 4; cx++) {
            inst = Structures.resolveTypeCell(type, cx, cy, seed, WorldGen.tileKeyAt);
            if (inst) break;
        }
    }
    assert.ok(inst);
    const chunks = new Map();
    const touch = (cx, cy) => {
        const k = `${cx},${cy}`;
        if (!chunks.has(k)) chunks.set(k, { cx, cy, tileSize: 16, things: [], lootableThings: [] });
        return chunks.get(k);
    };
    const order = [[Math.floor(inst.fireTx / 8), Math.floor(inst.fireTy / 8)]];
    for (const s of inst.spawned) {
        const cx = Math.floor(s.tx / 8);
        const cy = Math.floor(s.ty / 8);
        if (!order.some(([x, y]) => x === cx && y === cy)) order.push([cx, cy]);
    }
    Structures.clearPending(seed);
    for (const [cx, cy] of order) {
        const ch = touch(cx, cy);
        Structures.stampChunk({
            cx, cy, worldSeed: seed, config: cfg,
            tileKeyAt: WorldGen.tileKeyAt,
            things: ch.things,
            lootableThings: ch.lootableThings,
            getGeneratedChunk: (x, y) => chunks.get(`${x},${y}`) || null
        });
    }
    const baskets = [...chunks.values()].flatMap((ch) => ch.things || []).filter((e) => e.id === "wicker_basket");
    assert.ok(baskets.length > 0);
    for (const basket of baskets) {
        const tx = Math.round((basket.x - 8) / 16);
        const ty = Math.round((basket.y - 16) / 16);
        const stone = WorldGen.rockStoneAt(tx, ty);
        assert.equal(basket.slots.length, 8);
        assert.ok(basket.slots.every((s) => s && s.id === "pebble" && s.quantity === 1 && s.stone === stone));
    }
});

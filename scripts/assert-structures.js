/**
 * Determinism / occupancy checks for abandoned-camp structure gen.
 */
const WorldGen = require("../server/WorldGen");
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
for (const basket of baskets) {
    const filled = (basket.slots || []).filter((s) => s && s.quantity > 0);
    if (filled.length < 1 || filled.length > 2) {
        throw new Error(`basket should have 1–2 stacks, got ${filled.length}`);
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
            if (e.id === "unlit_campfire" || e.id === "lean_to" || e.id === "wicker_basket" || e.id === "skinworking_bench") {
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

console.log("assert-structures ok", {
    seed,
    cell: foundCell,
    fire: { tx: found.fireTx, ty: found.fireTy },
    pieces: found.spawned.map((s) => s.piece.id),
    chunk: { x: fireChunkX, y: fireChunkY }
});

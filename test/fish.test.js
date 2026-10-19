const { test } = require("node:test");
const assert = require("node:assert/strict");
const Fish = require("../shared/fish");
const Settlement = require("../shared/settlement");
const Research = require("../shared/research");
const WorldGen = require("../shared/sim/WorldGen");
const { createTestWorld } = require("./helpers/simWorld");
const { loadDefs, restoreRng, DataStore } = require("./helpers/load");

loadDefs();
test.after(() => restoreRng());

function waterSet(pairs) {
    const set = new Set(pairs.map(([x, y]) => x + "," + y));
    return (x, y) => set.has(x + "," + y);
}

function line(n) {
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([i, 0]);
    return pairs;
}

function rect(w, h, ox = 0, oy = 0) {
    const pairs = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) pairs.push([ox + x, oy + y]);
    }
    return pairs;
}

test("the flimsy rod line is leaf green", () => {
    const rod = DataStore.getItem("flimsy_rod");
    assert.equal(rod.lineColor, "#4dab36");
    assert.equal(DataStore.getItem("raw_fish").fillColor, "#5a7a8a");
});

test("water hover shows the population", () => {
    assert.equal(
        Fish.describe({ open: true, count: 400, max: null }, null),
        "Population: bountiful"
    );
    assert.equal(
        Fish.describe({ open: false, count: 200, max: 154, anchor: "0,0" }, null),
        "Population: 154/154"
    );
    assert.equal(
        Fish.describe(
            { open: false, count: 200, max: 154, anchor: "0,0" },
            { "0,0": { pop: 12.4, max: 154 } }
        ),
        "Population: 12.4/154"
    );
    assert.equal(
        Fish.describe(
            { open: false, count: 200, max: 154, anchor: "0,0" },
            { "0,0": { pop: 0, max: 154 } }
        ),
        "Population: 0/154"
    );
    assert.equal(Fish.describe({ open: false, count: 10, max: 0 }, null), "Population: 0/0");
    assert.equal(Fish.describe(null, null), null);
});

test("a water tile holds one bobber", () => {
    const mine = [{ id: "me", waterTx: 3, waterTy: 4 }];
    assert.equal(Fish.bobberTaken(3, 4, mine, "other"), true);
    assert.equal(Fish.bobberTaken(3, 4, mine, "me"), false);
    assert.equal(Fish.bobberTaken(2, 4, mine, "other"), false);
    assert.equal(Fish.bobberTaken(3, 4, [], "other"), false);
});

test("a cast uses the tiles the feet cover, not the bottom-left corner", () => {
    const key = (x) => (x < 10 ? "water" : "grass");
    const spot = Fish.castTile(156, 40, "left", key);
    assert.ok(spot, "body on the bank should cast even when the corner is in the water");
    assert.equal(spot.standTx, 10);
    assert.equal(spot.tx, 9);
    assert.equal(Fish.castTile(156, 40, "right", key), null);
    assert.equal(Fish.feetCover(156, 40, 10, 2), true);
    assert.equal(Fish.feetCover(180, 40, 10, 2), false);
    assert.equal(Fish.castRangeTiles(10, 2, 9, 2), 1);
    assert.equal(Fish.lineHolds(156, 40, 9, 2, 2), true);
    assert.equal(Fish.lineHolds((9 - 2) * 16, 2 * 16, 9, 2, 2), true);
    assert.equal(Fish.lineHolds((9 - 3) * 16, 2 * 16, 9, 2, 2), false);
    assert.equal(Fish.shoreFacing(10, 2, 9, 2), "left");
    assert.equal(Fish.shoreFacing(10, 2, 10, 3), "down");
    assert.equal(Fish.facingBobber(10.5 * 16, 2.5 * 16, 9, 2), "left");
    assert.equal(Fish.facingBobber(10.5 * 16, 2.5 * 16, 10, 3), "down");
    // A tile to the side of a down-cast, the bait is beside them.
    assert.equal(Fish.facingBobber((10 - 1.5) * 16, 3.5 * 16, 10, 3, "down"), "right");
});

test("a cast stays faced into the water and a turn does not stick", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    pawn.x = (shore.tx + 0.5) * 16;
    pawn.y = (shore.ty + 0.5) * 16;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 1 };
    pawn.hotbarIndex = 0;
    pawn.facing = shore.wx > shore.tx ? "right" : shore.wx < shore.tx ? "left" : shore.wy > shore.ty ? "down" : "up";
    world.handleAction(pawn.id, {
        type: Protocol.Actions.FISH,
        pawnId: pawn.id
    });
    const face = pawn.fishChannel?.facing;
    assert.ok(face);
    assert.equal(pawn.facing, face);
    const away = { left: "right", right: "left", up: "down", down: "up" }[face];
    world.setMove(pawn.id, {
        x: 1,
        y: 0,
        facing: away,
        px: pawn.x,
        py: pawn.y,
        pawnId: pawn.id
    });
    world.tick(50);
    assert.equal(pawn.facing, face);
    assert.equal(pawn.fishChannel.facing, face);

    const rec = world._settlerFromSnap({
        id: "fisher-face",
        name: "Fisher",
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id,
        inventory: [{ id: "flimsy_rod", quantity: 1, durability: 40 }, null, null, null, null]
    });
    rec.hotbarIndex = 0;
    rec.facing = away;
    rec.fishChannel = {
        remaining: 10000,
        max: 30000,
        haul: 1,
        open: true,
        standTx: shore.tx,
        standTy: shore.ty,
        waterTx: shore.wx,
        waterTy: shore.wy,
        facing: face
    };
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    world.tick(50);
    assert.equal(rec.facing, face);
    assert.equal(world.creatures.get(rec.id).facing, face);
});

test("a fisher turns toward the bobber after stepping along the shore", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    pawn.x = (shore.tx + 0.5) * 16;
    pawn.y = (shore.ty + 0.5) * 16;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 1 };
    pawn.hotbarIndex = 0;
    pawn.facing = shore.wx > shore.tx ? "right" : shore.wx < shore.tx ? "left" : shore.wy > shore.ty ? "down" : "up";
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    const ch = pawn.fishChannel;
    assert.ok(ch);
    const castFace = ch.facing;
    const besideX = (ch.waterTx - 1.5) * 16;
    const besideY = (ch.waterTy + 0.5) * 16;
    world.setMove(pawn.id, {
        x: 1,
        y: 0,
        facing: castFace === "left" ? "right" : "left",
        px: besideX,
        py: besideY,
        pawnId: pawn.id
    });
    assert.equal(pawn.fishChannel.facing, "right");
    assert.equal(pawn.facing, "right");
    const creature = pawn.creature || world.creatures.get(pawn.id);
    if (creature) assert.equal(creature.facing, "right");
});

test("a cast holds while you walk out to twice the cast range, then the line snaps", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    pawn.x = (shore.tx + 0.5) * 16;
    pawn.y = (shore.ty + 0.5) * 16;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 1 };
    pawn.hotbarIndex = 0;
    pawn.facing = shore.wx > shore.tx ? "right" : shore.wx < shore.tx ? "left" : shore.wy > shore.ty ? "down" : "up";
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    const ch = pawn.fishChannel;
    assert.ok(ch);
    assert.equal(ch.reach, 2);
    const awayX = Math.sign(ch.standTx - ch.waterTx);
    const awayY = Math.sign(ch.standTy - ch.waterTy);
    const ts = 16;
    pawn.x = (ch.standTx + awayX) * ts;
    pawn.y = (ch.standTy + awayY) * ts;
    world._tickFishChannel(pawn, 50);
    assert.ok(pawn.fishChannel, "one tile back is still inside a reach of 2");
    pawn.x = (ch.standTx + awayX * 2) * ts;
    pawn.y = (ch.standTy + awayY * 2) * ts;
    world._tickFishChannel(pawn, 50);
    assert.equal(pawn.fishChannel, null);
});

test("a cast finishes faster at a higher tick speed and holds while paused", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    pawn.x = (shore.tx + 0.5) * 16;
    pawn.y = (shore.ty + 0.5) * 16;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 1 };
    pawn.hotbarIndex = 0;
    pawn.facing = shore.wx > shore.tx ? "right" : shore.wx < shore.tx ? "left" : shore.wy > shore.ty ? "down" : "up";
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    assert.ok(pawn.fishChannel);
    world.tickSpeed = 8;
    world.baseTickSpeed = 8;
    const before = pawn.fishChannel.remaining;
    world.tick(40);
    const elapsed = before - pawn.fishChannel.remaining;
    assert.ok(pawn.fishChannel, "40ms at 8× is still mid-cast");
    assert.ok(elapsed > 200, `8× should chew ~320ms of the cast (got ${elapsed})`);
    world.tickSpeed = 0;
    world.baseTickSpeed = 0;
    const held = pawn.fishChannel.remaining;
    world.tick(40);
    assert.equal(pawn.fishChannel.remaining, held);
});

test("closed-pool debuff and the yield curve", () => {
    assert.equal(Fish.maxForCount(74), 0);
    assert.equal(Fish.maxForCount(75), 0);
    assert.equal(Fish.maxForCount(76), 1);
    assert.equal(Fish.maxForCount(238), Math.round(400 * (238 - 75) / 325));
    assert.equal(Fish.maxForCount(238), 201);
    assert.equal(Fish.maxForCount(399), Math.round(400 * (399 - 75) / 325));
    assert.equal(Fish.maxForCount(400), null);
    assert.equal(Fish.yieldForPop(25), 1);
    assert.equal(Fish.yieldForPop(100), 2);
    assert.equal(Fish.yieldForPop(200), 3);
    assert.equal(Fish.yieldForPop(300), 3);
    assert.equal(Fish.yieldForPop(0.4), 0);
});

test("a fill stops at 400 tiles and never asks about a 401st", () => {
    let probed = -1;
    const isWater = (x, y) => {
        if (y !== 0 || x < 0) return false;
        if (x >= Fish.TILE_CAP) {
            probed = x;
            return true;
        }
        return x < 500;
    };
    const measured = Fish.measure(0, 0, isWater);
    assert.equal(measured.open, true);
    assert.equal(measured.tiles.length, 400);
    assert.equal(measured.anchor, null);
    assert.equal(probed, -1);
    assert.equal(measured.tiles.some(([x]) => x >= 400), false);
});

test("a pool under 400 shares one id from both shores", () => {
    const isWater = waterSet(rect(10, 20));
    const west = Fish.measure(0, 0, isWater);
    const east = Fish.measure(9, 19, isWater);
    assert.equal(west.open, false);
    assert.equal(west.count, 200);
    assert.equal(west.anchor, "0,0");
    assert.equal(east.anchor, west.anchor);
    assert.equal(east.count, west.count);
    assert.equal(Fish.maxForCount(200), Math.round(400 * (200 - 75) / 325));
});

test("open water is not saved and a cast there grants 3", () => {
    const fisheries = {};
    const measured = Fish.measure(0, 0, waterSet(line(400)));
    assert.equal(measured.open, true);
    const cast = Fish.beginCast(fisheries, measured);
    assert.equal(cast.ok, true);
    assert.equal(cast.open, true);
    assert.equal(cast.haul, 3);
    assert.deepEqual(fisheries, {});
});

test("the first cast reserves the haul, and cancel puts it back", () => {
    const fisheries = {};
    const measured = {
        open: false,
        count: 238,
        max: 200,
        anchor: "3,4",
        tiles: []
    };
    const first = Fish.beginCast(fisheries, measured);
    assert.equal(first.ok, true);
    assert.equal(first.haul, Fish.yieldForPop(200));
    assert.equal(fisheries["3,4"].pop, 200 - first.haul);
    assert.equal(fisheries["3,4"].max, 200);
    const second = Fish.beginCast(fisheries, measured);
    assert.equal(second.ok, true);
    assert.ok(second.haul <= Math.floor(200 - first.haul));
    assert.equal(fisheries["3,4"].pop, 200 - first.haul - second.haul);
    Fish.cancelCast(fisheries, first.id, first.haul);
    assert.equal(fisheries["3,4"].pop, 200 - second.haul);
    Fish.cancelCast(fisheries, second.id, second.haul);
    assert.equal(fisheries["3,4"].pop, 200);
});

test("an empty pool refuses the cast and keeps the reserved fish", () => {
    const fisheries = { "1,1": { pop: 0.4, max: 200 } };
    const measured = { open: false, count: 200, max: 200, anchor: "1,1", tiles: [] };
    const cast = Fish.beginCast(fisheries, measured);
    assert.equal(cast.ok, false);
    assert.equal(fisheries["1,1"].pop, 0.4);
});

test("regen is 2.5% of max, stops at max, and ignores unfished water", () => {
    const fisheries = { pond: { pop: 100, max: 200 } };
    Fish.regen(fisheries, 1440);
    assert.equal(fisheries.pond.pop, 105);
    Fish.regen(fisheries, 1440 * 1000);
    assert.equal(fisheries.pond.pop, 200);
    const before = Object.keys(fisheries).length;
    Fish.regen(fisheries, 1440);
    assert.equal(Object.keys(fisheries).length, before);
    assert.equal(fisheries.pond.pop, 200);
});

test("job order is Chop, then Fish, then Tail", () => {
    const jobs = Settlement.JOBS;
    assert.ok(jobs.indexOf("chop") >= 0);
    assert.ok(jobs.indexOf("chop") < jobs.indexOf("fish"));
    assert.ok(jobs.indexOf("fish") < jobs.indexOf("leather"));
    assert.equal(Settlement.jobLabel("fish"), "Fish");
    assert.equal(Settlement.JOB_NAMES.fish, "Fishing");
    assert.ok(Settlement.jobTooltip("fish").includes("Fish at the shore"));
    assert.equal(Fish.CAST_MS, 30000);
});

test("a new save keeps grub and raw fish at the stock default", () => {
    const stock = Settlement.normalizeStock({ stick: 4, clay: 0 });
    assert.equal(stock.stick, 4);
    assert.equal(stock.clay, 0);
    assert.equal(stock.grub, 12);
    assert.equal(stock.raw_fish, 12);
    const off = Settlement.normalizeStock({ grub: 0, raw_fish: 0 });
    assert.equal(off.grub, 0);
    assert.equal(off.raw_fish, 0);
});

function twoBanks() {
    WorldGen.applySeed(1);
    const isWater = (x, y) => WorldGen.tileKeyAt(x, y) === "water";
    for (let ty = 2; ty < 28; ty++) {
        for (let tx = 2; tx < 28; tx++) {
            if (!isWater(tx, ty)) continue;
            const measured = Fish.measure(tx, ty, isWater);
            if (!(measured.open || measured.max >= 1)) continue;
            const stands = [];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const sx = tx + dx;
                const sy = ty + dy;
                const ground = WorldGen.tileKeyAt(sx, sy);
                if (ground === "water" || ground === "ice") continue;
                stands.push({
                    tx: sx,
                    ty: sy,
                    face: dx > 0 ? "left" : dx < 0 ? "right" : dy > 0 ? "up" : "down"
                });
            }
            if (stands.length >= 2) return { wx: tx, wy: ty, stands };
        }
    }
    return null;
}

function shoreNearOrigin() {
    WorldGen.applySeed(1);
    const isWater = (x, y) => WorldGen.tileKeyAt(x, y) === "water";
    for (let ty = 1; ty < 20; ty++) {
        for (let tx = 1; tx < 20; tx++) {
            const ground = WorldGen.tileKeyAt(tx, ty);
            if (ground === "water" || ground === "ice") continue;
            const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of nbs) {
                if (!isWater(tx + dx, ty + dy)) continue;
                const measured = Fish.measure(tx + dx, ty + dy, isWater);
                if (!(measured.open || measured.max >= 1)) continue;
                return { tx, ty, wx: tx + dx, wy: ty + dy };
            }
        }
    }
    return null;
}

function parkDigger(world, pawn, inventory) {
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    const rec = world._settlerFromSnap({
        id: "digger1",
        name: "Digger",
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: inventory || [{ id: "digging_stick", quantity: 1 }, null, null, null, null]
    });
    const jobs = Settlement.defaultJobs();
    for (const id of Settlement.JOBS) jobs[id] = 0;
    jobs.gather = 3;
    settle.jobs = { [rec.id]: jobs };
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    return { settle, rec };
}

test("a finished cast spends one grub and does not generate chunks", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore, "origin seed should have a shore");
    let generated = 0;
    const orig = WorldGen.generateChunk;
    WorldGen.generateChunk = function () {
        generated += 1;
        return orig.apply(this, arguments);
    };
    try {
        const { world, pawn, Protocol } = createTestWorld();
        world.seed = 1;
        WorldGen.applySeed(1);
        Research.unlock(pawn, "fishing");
        Research.unlock(pawn, "digging");
        pawn.x = (shore.tx + 0.5) * 16;
        pawn.y = (shore.ty + 0.5) * 16;
        pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
        pawn.inventory[1] = { id: "grub", quantity: 3 };
        pawn.hotbarIndex = 0;
        pawn.facing = shore.wy > shore.ty ? "up" : shore.wy < shore.ty ? "down" : shore.wx > shore.tx ? "left" : "right";
        world.handleAction(pawn.id, {
            type: Protocol.Actions.FISH,
            tx: shore.wx,
            ty: shore.wy,
            pawnId: pawn.id
        });
        assert.ok(!pawn.fishChannel, "a cast away from the water does not start");
        pawn.facing = shore.wx > shore.tx ? "right" : shore.wx < shore.tx ? "left" : shore.wy > shore.ty ? "down" : "up";
        const before = WorldGen.generateChunk;
        world.handleAction(pawn.id, {
            type: Protocol.Actions.FISH,
            tx: shore.wx,
            ty: shore.wy,
            pawnId: pawn.id
        });
        assert.ok(pawn.fishChannel, "cast should start");
        assert.equal(pawn.inventory[1].quantity, 3);
        const reserved = pawn.fishChannel.open ? null : world.fisheries[pawn.fishChannel.id].pop;
        world._cancelFishChannel(pawn);
        assert.equal(pawn.fishChannel, null);
        assert.equal(pawn.inventory[1].quantity, 3);
        if (reserved != null) {
            assert.ok(world.fisheries[Object.keys(world.fisheries)[0]].pop > reserved);
        }
        world.handleAction(pawn.id, {
            type: Protocol.Actions.FISH,
            tx: shore.wx,
            ty: shore.wy,
            pawnId: pawn.id
        });
        assert.ok(pawn.fishChannel);
        assert.equal(pawn.fishChannel.hook, true);
        assert.ok(pawn.fishChannel.remaining >= Fish.BITE_MIN_MS);
        assert.ok(pawn.fishChannel.remaining <= Fish.BITE_MAX_MS);
        const haul = pawn.fishChannel.haul;
        const speed = world.tickSpeed;
        world.rng = () => 0.5;
        world._tickFishChannel(pawn, pawn.fishChannel.remaining, 0);
        assert.equal(pawn.fishChannel.bite, true);
        world.handleAction(pawn.id, {
            type: Protocol.Actions.FISH,
            op: "hook",
            pawnId: pawn.id
        });
        assert.equal(world.tickSpeed, speed);
        assert.equal(pawn.fishChannel, null);
        assert.equal(pawn.inventory[1].quantity, 2);
        const held = pawn.inventory[0];
        assert.equal(held.durability, 39);
        const got = (pawn.inventory || []).reduce((n, s) => {
            return n + (s?.id === "raw_fish" ? (s.quantity || 1) : 0);
        }, 0);
        assert.equal(got, haul);
        assert.equal(before, WorldGen.generateChunk);
        assert.equal(generated, 0);
    } finally {
        WorldGen.generateChunk = orig;
    }
});

test("Get digs a grub nest only while grubs are short, and still digs clay", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkDigger(world, pawn);
    Research.unlock(pawn, "digging");
    const chunk = world.chunks.get(require("./helpers/simWorld").chunkKey(0, 0));
    const grub = { id: "grub_nest", uid: "grub1", x: pawn.x + 14, y: pawn.y, digProgress: 0 };
    const clay = { id: "clay_patch", uid: "clay1", x: pawn.x + 48, y: pawn.y, digProgress: 0 };
    chunk.things.push(grub, clay);
    settle.stock = Settlement.normalizeStock({ clay: 0 });
    for (let i = 0; i < 12; i++) world.tick(400);
    assert.ok((grub.digProgress || 0) > 0 || (grub.digTaken || 0) > 0, "short grubs are dug");
    assert.equal(clay.digProgress || 0, 0);

    grub.digProgress = 0;
    grub.digTaken = 0;
    grub.digAccrued = 0;
    settle.stock = Settlement.normalizeStock({ grub: 0, clay: 25 });
    rec._settlerScan = null;
    rec._busyJob = null;
    rec._workHold = false;
    for (let i = 0; i < 16; i++) world.tick(400);
    assert.equal(grub.digProgress || 0, 0);
    assert.ok((clay.digProgress || 0) > 0 || (clay.digTaken || 0) > 0, "clay is still dug when it is short");
});

test("no Digging tech means the nest stays untouched", () => {
    const { world, pawn } = createTestWorld();
    const { settle } = parkDigger(world, pawn);
    const chunk = world.chunks.get(require("./helpers/simWorld").chunkKey(0, 0));
    const grub = { id: "grub_nest", uid: "grub2", x: pawn.x + 14, y: pawn.y, digProgress: 0 };
    chunk.things.push(grub);
    settle.stock = Settlement.normalizeStock({ clay: 0 });
    for (let i = 0; i < 8; i++) world.tick(400);
    assert.equal(grub.digProgress || 0, 0);
    assert.equal(grub.digTaken || 0, 0);
});

test("a finished grub nest regrows after one game day", () => {
    const { world } = createTestWorld();
    const chunk = world.chunks.get(require("./helpers/simWorld").chunkKey(0, 0));
    const bank = {
        id: "grub_nest",
        uid: "grub3",
        x: 40,
        y: 48,
        digProgress: 1,
        digTaken: 4,
        regrowAt: world.worldMinuteIndex() + 10
    };
    chunk.things.push(bank);
    world._tickGrubNests();
    assert.equal(bank.digProgress, 1);
    bank.regrowAt = world.worldMinuteIndex();
    world._tickGrubNests();
    assert.equal(bank.digProgress, 0);
    assert.equal(bank.digTaken, 0);
    assert.equal(bank.regrowAt, undefined);
    assert.equal(chunk.things.includes(bank), true);
});

test("Fish waits for the tech, a rod, a grub, and room in the fish stock", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    const x = (shore.tx + 0.5) * 16;
    const y = (shore.ty + 0.5) * 16;
    pawn.x = x;
    pawn.y = y;
    const settle = Settlement.createSettlement({ x, y, ownerId: pawn.id });
    const rec = world._settlerFromSnap({
        id: "fisher1",
        name: "Fisher",
        x,
        y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: [null, null, null, null, null]
    });
    const jobs = Settlement.defaultJobs();
    for (const id of Settlement.JOBS) jobs[id] = 0;
    jobs.fish = 3;
    settle.jobs = { [rec.id]: jobs };
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    const chunk = world.chunks.get(require("./helpers/simWorld").chunkKey(
        Math.floor(x / (8 * 16)),
        Math.floor(y / (8 * 16))
    ));
    const bank = { id: "grub_nest", uid: "grub4", x: x + 20, y, digProgress: 0 };
    chunk?.things.push(bank);

    for (let i = 0; i < 4; i++) world.tick(200);
    assert.ok(!rec.fishChannel);
    assert.notEqual(rec._busyJob?.type, "fish");

    Research.unlock(pawn, "fishing");
    rec.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    rec.hotbarIndex = 0;
    rec._settlerScan = null;
    for (let i = 0; i < 4; i++) world.tick(200);
    assert.ok(!rec.fishChannel);

    rec.inventory[1] = { id: "grub", quantity: 2 };
    rec.inventory[2] = { id: "raw_fish", quantity: 12 };
    rec._settlerScan = null;
    for (let i = 0; i < 4; i++) world.tick(200);
    assert.ok(!rec.fishChannel);
    assert.equal(bank.digProgress || 0, 0);

    rec.inventory[2] = null;
    rec._settlerScan = null;
    rec._busyJob = null;
    rec._workHold = false;
    for (let i = 0; i < 8; i++) world.tick(200);
    assert.ok(rec.fishChannel, "a stocked shore with a rod and a grub is fished");
    assert.equal(rec.fishChannel.hook, false);
    assert.ok(rec.fishChannel.remaining <= Fish.CAST_MS);
    assert.ok(rec.fishChannel.remaining > Fish.CAST_MS - 5000);
    assert.equal(bank.digProgress || 0, 0);
    const before = rec.inventory[1].quantity;
    for (let i = 0; i < 40; i++) world._tickFishChannel(rec, 1000);
    assert.equal(rec.fishChannel, null);
    assert.equal(rec.inventory[1].quantity, before - 1);
});

test("a second line cannot land on a tile that already has a bobber", () => {
    const banks = twoBanks();
    assert.ok(banks, "seed 1 should have a water tile with two shores");
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    const stand = banks.stands[0];
    pawn.x = (stand.tx + 0.5) * 16;
    pawn.y = (stand.ty + 0.5) * 16;
    pawn.facing = stand.face;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 2 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    assert.ok(pawn.fishChannel, "the first cast starts");
    assert.equal(pawn.fishChannel.waterTx, banks.wx);
    assert.equal(pawn.fishChannel.waterTy, banks.wy);
    const reserved = pawn.fishChannel.open ? null : world.fisheries[pawn.fishChannel.id].pop;

    const other = banks.stands[1];
    const x = (other.tx + 0.5) * 16;
    const y = (other.ty + 0.5) * 16;
    const settle = Settlement.createSettlement({ x, y, ownerId: pawn.id });
    const rec = world._settlerFromSnap({
        id: "fisher2",
        name: "Fisher",
        x,
        y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: [
            { id: "flimsy_rod", quantity: 1, durability: 40 },
            { id: "grub", quantity: 2 },
            null, null, null
        ]
    });
    rec.hotbarIndex = 0;
    rec.facing = other.face;
    const jobs = Settlement.defaultJobs();
    for (const id of Settlement.JOBS) jobs[id] = 0;
    jobs.fish = 3;
    settle.jobs = { [rec.id]: jobs };
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);

    world._tryFish(rec);
    assert.ok(!rec.fishChannel, "a settler cannot drop a second bobber here");
    if (reserved != null) assert.equal(world.fisheries[pawn.fishChannel.id].pop, reserved);

    for (let i = 0; i < 6; i++) world.tick(200);
    if (rec.fishChannel) {
        const same = (rec.fishChannel.waterTx | 0) === banks.wx
            && (rec.fishChannel.waterTy | 0) === banks.wy;
        assert.equal(same, false, "the fishing job picks a free tile");
    }
    assert.ok(pawn.fishChannel, "the first bobber stays out");

    world._cancelFishChannel(pawn);
    rec.fishChannel = null;
    rec.x = x;
    rec.y = y;
    rec.facing = other.face;
    rec._busyJob = null;
    rec._workHold = false;
    rec._settlerScan = null;
    const body = world.creatures.get(rec.id);
    if (body) {
        body.x = x;
        body.y = y;
        body.facing = other.face;
    }
    world._tryFish(rec);
    assert.ok(rec.fishChannel, "the shore is free once the first line is in");
    assert.equal(rec.fishChannel.waterTx, banks.wx);
    assert.equal(rec.fishChannel.waterTy, banks.wy);
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    assert.ok(!pawn.fishChannel, "the player cannot cast onto that bobber");
});

test("a snag restores fish and blocks the next snag; a rare does not", () => {
    const { world, pawn } = createTestWorld();
    pawn.name = "Ada";
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 4 };
    pawn.hotbarIndex = 0;
    world.fisheries = Object.create(null);
    world.fishCastEvents = { snagAt: null };
    world.rng = () => 0;
    const measured = { open: false, anchor: "pond", max: 40 };
    const first = Fish.beginCast(world.fisheries, measured);
    const reserved = world.fisheries.pond.pop;
    pawn.fishChannel = {
        hook: false,
        open: false,
        id: first.id,
        haul: first.haul,
        max: Fish.CAST_MS,
        remaining: 0
    };
    world._finishFishChannel(pawn);
    assert.equal(world.fisheries.pond.pop, reserved + first.haul);
    assert.equal(world.fishCastEvents.snagAt, world.worldMinuteIndex());
    const saved = world.toSaveData();
    assert.equal(saved.fishCastEvents.snagAt, world.fishCastEvents.snagAt);
    const loaded = world.constructor.loadFromData(saved, {});
    assert.equal(loaded.fishCastEvents.snagAt, saved.fishCastEvents.snagAt);
    assert.equal(pawn.inventory.some((s) => s?.id === "raw_fish"), false);
    assert.equal(pawn.inventory[1].quantity, 3);

    const second = Fish.beginCast(world.fisheries, measured);
    const again = world.fisheries.pond.pop;
    pawn.fishChannel = {
        hook: false,
        open: false,
        id: second.id,
        haul: second.haul,
        max: Fish.CAST_MS,
        remaining: 0
    };
    world._finishFishChannel(pawn);
    assert.equal(world.fisheries.pond.pop, again + second.haul);
    assert.equal(pawn.inventory.some((s) => s?.id === "deer_hide"), true);
    assert.equal(pawn.inventory.some((s) => s?.id === "raw_human_flesh"), false);
});

test("open water rare rows are the pond table plus a heavier tail", () => {
    const pond = Fish.rareTable(false);
    const sea = Fish.rareTable(true);
    const weight = (rows, id) => rows.find((row) => row.id === id)?.weight || 0;
    assert.equal(pond.some((row) => row.id === "raw_human_flesh"), false);
    assert.equal(pond.some((row) => row.id === "clay"), true);
    assert.ok(weight(sea, "stone_spear") > weight(pond, "stone_spear"));
    assert.ok(weight(sea, "hide_bundle") > weight(pond, "hide_bundle"));
    assert.equal(sea.some((row) => row.id === "raw_human_flesh"), true);
    const sum = (rows) => rows.reduce((n, row) => n + row.weight, 0);
    assert.equal(sum(pond), 112);
    assert.equal(sum(sea), 136);
});

test("space before the bite reels in, and a missed bite spends the grub", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    pawn.x = (shore.tx + 0.5) * 16;
    pawn.y = (shore.ty + 0.5) * 16;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 3 };
    pawn.hotbarIndex = 0;
    pawn.facing = shore.wx > shore.tx ? "right" : shore.wx < shore.tx ? "left" : shore.wy > shore.ty ? "down" : "up";
    const speed = world.tickSpeed;
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    assert.equal(pawn.fishChannel.hook, true);
    const reserved = pawn.fishChannel.open ? null : world.fisheries[pawn.fishChannel.id].pop;
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, op: "reel", pawnId: pawn.id });
    assert.equal(pawn.fishChannel, null);
    assert.equal(pawn.inventory[1].quantity, 3);
    assert.equal(pawn.inventory[0].durability, 40);
    assert.equal(world.tickSpeed, speed);
    if (reserved != null) {
        assert.ok(world.fisheries[Object.keys(world.fisheries)[0]].pop > reserved);
    }

    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    assert.ok(pawn.fishChannel.hook);
    const haulPop = pawn.fishChannel.open ? null : world.fisheries[pawn.fishChannel.id].pop;
    world._tickFishChannel(pawn, pawn.fishChannel.remaining, 0);
    assert.equal(pawn.fishChannel.bite, true);
    const grub = pawn.inventory[1].quantity;
    world._tickFishChannel(pawn, 99999, Fish.HOOK_MS);
    assert.equal(pawn.fishChannel, null);
    assert.equal(pawn.inventory[1].quantity, grub - 1);
    assert.equal(pawn.inventory.some((s) => s?.id === "raw_fish"), false);
    assert.equal(pawn.fishChannel, null, "a finished bite does not cast again");
    assert.equal(world.tickSpeed, speed);
    if (haulPop != null) {
        assert.ok(world.fisheries[Object.keys(world.fisheries)[0]].pop >= haulPop);
    }
});

test("a party member finishes fishing before following", () => {
    const shore = shoreNearOrigin();
    assert.ok(shore);
    const { world, pawn, Protocol } = createTestWorld();
    world.seed = 1;
    WorldGen.applySeed(1);
    Research.unlock(pawn, "fishing");
    pawn.x = (shore.tx + 0.5) * 16;
    pawn.y = (shore.ty + 0.5) * 16;
    pawn.inventory[0] = { id: "flimsy_rod", quantity: 1, durability: 40 };
    pawn.inventory[1] = { id: "grub", quantity: 3 };
    pawn.hotbarIndex = 0;
    pawn.facing = shore.wx > shore.tx ? "right"
        : shore.wx < shore.tx ? "left"
            : shore.wy > shore.ty ? "down" : "up";
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: pawn.id });
    assert.equal(pawn.fishChannel?.hook, true);

    const isWater = (x, y) => WorldGen.tileKeyAt(x, y) === "water";
    let stand = null;
    for (let ty = 1; ty < 24 && !stand; ty++) {
        for (let tx = 1; tx < 24; tx++) {
            const ground = WorldGen.tileKeyAt(tx, ty);
            if (ground === "water" || ground === "ice") continue;
            const dist = Math.hypot(tx - shore.tx, ty - shore.ty);
            if (dist < 6 || dist > 14) continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (!isWater(tx + dx, ty + dy)) continue;
                if ((tx + dx) === shore.wx && (ty + dy) === shore.wy) continue;
                stand = { tx, ty, wx: tx + dx, wy: ty + dy };
                break;
            }
            if (stand) break;
        }
    }
    assert.ok(stand, "a second bank within follow range");
    const mate = {
        id: "mate",
        name: "Mate",
        x: (stand.tx + 0.5) * 16,
        y: (stand.ty + 0.5) * 16,
        facing: stand.wx > stand.tx ? "right"
            : stand.wx < stand.tx ? "left"
                : stand.wy > stand.ty ? "down" : "up",
        vx: 0,
        vy: 0,
        inventory: [
            { id: "flimsy_rod", quantity: 1, durability: 40 },
            { id: "grub", quantity: 2 },
            null, null, null
        ],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        hotbarIndex: 0,
        kc: 1200,
        dead: false,
        prone: false,
        ownerId: pawn.id,
        leaderId: pawn.id,
        role: "companion"
    };
    pawn.party = [mate];
    world._ensureCompanionCreature(pawn, mate);
    world._setControlId(pawn, mate.id);
    assert.ok(pawn.fishChannel, "switching control leaves the first line out");
    world.handleAction(pawn.id, { type: Protocol.Actions.FISH, pawnId: mate.id });
    assert.ok(mate.fishChannel?.hook, "the controlled member can cast too");
    assert.ok(pawn.fishChannel, "the first line stays out while the next one starts");

    const sx = pawn.x;
    const sy = pawn.y;
    for (let i = 0; i < 8; i++) world.tick(200);
    assert.ok(pawn.fishChannel, "the cast keeps running after the switch");
    assert.ok(Math.hypot(pawn.x - sx, pawn.y - sy) < 2, "they wait on the bank instead of following");

    world.rng = () => 0.5;
    const haul = pawn.fishChannel.haul;
    world._tickFishChannel(pawn, pawn.fishChannel.remaining, 0);
    assert.equal(pawn.fishChannel.bite, true, "an uncontrolled bite still plays");
    assert.ok(Math.hypot(pawn.x - sx, pawn.y - sy) < 2, "they stay through the bite");
    world._tickFishChannel(pawn, 0, Fish.HOOK_MS);
    assert.equal(pawn.fishChannel, null);
    const got = (pawn.inventory || []).reduce((n, s) => {
        return n + (s?.id === "raw_fish" ? (s.quantity || 1) : 0);
    }, 0);
    assert.equal(got, haul);
    assert.equal(pawn.inventory[1].quantity, 2);
    assert.ok(mate.fishChannel, "the controlled cast is still waiting on a bite");

    const before = { x: pawn.x, y: pawn.y };
    for (let i = 0; i < 40; i++) world.tick(200);
    const moved = Math.hypot(pawn.x - before.x, pawn.y - before.y);
    assert.ok(moved > 8, `they follow once the line is in (moved ${moved.toFixed(1)})`);
});

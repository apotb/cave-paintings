const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs, restoreRng } = require("./helpers/load");
const Settlement = require("../shared/settlement");
const Place = require("../shared/place");
const Hide = require("../shared/hide");

loadDefs();
test.after(() => restoreRng());

function parkSettler(world, pawn, opts = {}) {
    const x = opts.x ?? pawn.x;
    const y = opts.y ?? pawn.y;
    const settle = Settlement.createSettlement({
        x,
        y,
        ownerId: pawn.id
    });
    const rec = world._settlerFromSnap({
        id: opts.id || "settler1",
        name: "Parked",
        x,
        y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: opts.inventory || [null, null, null, null, null]
    });
    settle.jobs = settle.jobs || {};
    settle.jobs[rec.id] = Settlement.defaultJobs();
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    return { settle, rec };
}

function addBasket(world, settle, x, y, uid = "basket1") {
    const chunk = originChunk(world);
    const def = world._thingDef("wicker_basket");
    const entry = { uid, id: "wicker_basket", x, y };
    Place.ensureStorageEntry(entry, def);
    entry.uid = uid;
    chunk.things.push(entry);
    if (!settle.stationUids) settle.stationUids = [];
    if (!settle.stationUids.includes(uid)) settle.stationUids.push(uid);
    return entry;
}

function addStation(world, settle, id, x, y, uid) {
    const chunk = originChunk(world);
    const def = world._thingDef(id);
    const entry = { uid, id, x, y };
    Place.ensureStorageEntry(entry, def);
    entry.uid = uid;
    chunk.things.push(entry);
    if (!settle.stationUids) settle.stationUids = [];
    if (!settle.stationUids.includes(uid)) settle.stationUids.push(uid);
    return entry;
}

function workOnce(world, rec) {
    const mob = world._ensureSettlerCreature(rec);
    rec._settlerScan = null;
    rec._settlerScanMs = 280;
    return world._tickSettlerWork(mob, 300);
}

test("dedicated settler harvests a lootable in range", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn);
    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt1", id: "sticks", x: rec.x, y: rec.y });
    workOnce(world, rec);
    assert.ok(
        rec.inventory.some((s) => s && s.id === "stick")
        || chunk.drops.some((d) => d.id === "stick"),
        "settler should harvest sticks"
    );
    const lt = chunk.lootableThings.find((e) => e.uid === "lt1");
    assert.ok(!lt || lt.gone || lt.id !== "sticks" || lt.regrowAt != null);
});

test("dedicated settler stashes cargo into a matching basket", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [{ id: "stick", quantity: 4 }, null, null, null, null]
    });
    const basket = addBasket(world, settle, rec.x, rec.y);
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(rec.inventory[0], null);
    assert.ok(
        (basket.slots || []).some((s) => s && s.id === "stick" && s.quantity >= 4),
        "basket should hold the sticks"
    );
});

test("dedicated settler hauls a ground drop into a basket", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    const basket = addBasket(world, settle, rec.x, rec.y);
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "d1", id: "stick", quantity: 3, x: rec.x, y: rec.y });
    workOnce(world, rec);
    workOnce(world, rec);
    assert.equal(chunk.drops.some((d) => d.uid === "d1"), false);
    const inInv = rec.inventory.some((s) => s && s.id === "stick");
    const inBasket = (basket.slots || []).some((s) => s && s.id === "stick");
    assert.ok(inInv || inBasket, "sticks should leave the ground");
});

test("dedicated settler does not haul a fleshed hide soaking in water", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn);
    addBasket(world, settle, rec.x, rec.y);
    const chunk = originChunk(world);
    chunk.tiles = Array.from({ length: 64 }, () => "water");
    chunk.drops.push({
        uid: "hide1",
        id: "deer_hide_fleshed",
        quantity: 1,
        x: rec.x,
        y: rec.y
    });
    const fleshed = world._itemDef("deer_hide_fleshed");
    assert.ok(Hide.leaveHaulInWater(fleshed, world._dropIsOnWater(chunk.drops[0])));
    workOnce(world, rec);
    workOnce(world, rec);
    assert.ok(chunk.drops.some((d) => d.uid === "hide1"), "soaking hide stays on the water");
    assert.ok(!rec.inventory.some((s) => s && s.id === "deer_hide_fleshed"));
});

test("dedicated settler fleshes a hang over the scrape channel", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "pebble", toolClass: "scraper", knapQuality: "rough", quantity: 1 },
            null, null, null, null
        ]
    });
    const rack = addStation(world, settle, "drying_rack", rec.x, rec.y, "rack1");
    rack.slots[0] = { id: "deer_hide", quantity: 1 };
    Settlement.addBill(settle, rack.uid, { recipeId: "flesh_hide", mode: "forever" });
    workOnce(world, rec);
    assert.equal(rack.slots[0]?.id, "deer_hide", "hide stays raw until the channel finishes");
    assert.equal(rec._workChannel?.kind, "flesh");
    world.tick(100);
    assert.equal(rack.slots[0]?.id, "deer_hide");
    world.tick(11000);
    const onRack = rack.slots[0]?.id === "deer_hide_fleshed";
    const inInv = rec.inventory.some((s) => s && s.id === "deer_hide_fleshed");
    assert.ok(onRack || inInv, "hide should be fleshed after ~10s");
    assert.notEqual(rack.slots[0]?.id, "deer_hide");
    assert.equal(rec._workChannel, null);
});

test("dedicated settler crafts at a bench over craftSeconds", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "deer_hide_dry", quantity: 1 },
            { id: "leaf_cord", quantity: 4 },
            { id: "bone", quantity: 1 },
            null, null
        ]
    });
    const bench = addStation(world, settle, "skinworking_bench", rec.x, rec.y, "bench1");
    Settlement.addBill(settle, bench.uid, { recipeId: "hide_pouch", mode: "forever" });
    workOnce(world, rec);
    assert.ok(!rec.inventory.some((s) => s && s.id === "hide_pouch"));
    assert.equal(rec._workChannel?.kind, "craft");
    world.tick(100);
    assert.ok(!rec.inventory.some((s) => s && s.id === "hide_pouch"));
    world.tick(13000);
    assert.ok(
        rec.inventory.some((s) => s && s.id === "hide_pouch"),
        "pouch should exist after CRAFT_SECONDS"
    );
    assert.equal(rec._workChannel, null);
});

function fillGrass(world) {
    for (const c of world.chunks.values()) {
        c.tiles = Array.from({ length: 8 * 8 }, () => "grass");
    }
}

test("dedicated founding and destroying a settlement announces in world chat", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "settling_stone", quantity: 1 };
    pawn.hotbarIndex = 0;
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx,
        ty,
        rot: 0,
        name: "River Camp"
    });
    const founded = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(
        founded.some((e) => e.text === "River Camp has been founded" && e.system && !e.to),
        "founding should broadcast"
    );
    assert.equal(world.settlements.length, 1);
    const settle = world.settlements[0];
    world._destroySettlement(settle);
    const wrecked = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(
        wrecked.some((e) => e.text === "River Camp has been destroyed!" && e.system && !e.to),
        "destruction should broadcast"
    );
    assert.equal(world.settlements.length, 0);
});

test("picking up a settler makes them follow instead of idling at the stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const { settle, rec } = parkSettler(world, pawn, { x: 32, y: 32 });
    pawn.x = 200;
    pawn.y = 32;
    const leader = world._ensurePlayerCreature(pawn);
    leader.x = pawn.x;
    leader.y = pawn.y;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "pick",
        pawnId: rec.id,
        settlementId: settle.id
    });
    assert.equal((world.settlers || []).some((s) => s.id === rec.id), false);
    assert.ok((pawn.party || []).some((m) => m.id === rec.id), "should join the traveling party");
    const cc = rec.creature || world.creatures.get(rec.id);
    assert.equal(cc.role, "companion");
    assert.equal(cc.homeSettlementId || null, null);
    const startDist = Math.hypot(rec.x - pawn.x, rec.y - pawn.y);
    for (let i = 0; i < 90; i++) world.tick(16);
    const endDist = Math.hypot(rec.x - pawn.x, rec.y - pawn.y);
    assert.ok(
        endDist < startDist - 20,
        `should follow the leader (start ${startDist.toFixed(1)} end ${endDist.toFixed(1)})`
    );
});

test("dropping a companion at a settlement starts settler work instead of standing still", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "drop1",
        name: "Parked",
        x: pawn.x,
        y: pawn.y
    });
    pawn.party = [mem];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: settle.id
    });
    assert.equal((pawn.party || []).some((m) => m.id === mem.id), false);
    assert.ok((world.settlers || []).some((s) => s.id === mem.id), "should park at the camp");
    assert.equal(mem.role, "settler");
    assert.equal(mem.homeSettlementId, settle.id);
    const cc = mem.creature || world.creatures.get(mem.id);
    assert.equal(cc.role, "settler");
    assert.equal(cc.homeSettlementId, settle.id);

    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt-drop", id: "sticks", x: mem.x + 80, y: mem.y });
    const startX = mem.x;
    const startY = mem.y;
    for (let i = 0; i < 180; i++) world.tick(16);
    const moved = Math.hypot(mem.x - startX, mem.y - startY) > 8;
    const harvested = mem.inventory.some((s) => s && s.id === "stick")
        || chunk.drops.some((d) => d.id === "stick");
    assert.ok(
        moved || harvested,
        `dropped settler should mill or gather (moved ${Math.hypot(mem.x - startX, mem.y - startY).toFixed(1)})`
    );
});

test("drop-off still parks when settlementId is stale", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "drop2",
        name: "Parked",
        x: pawn.x,
        y: pawn.y
    });
    pawn.party = [mem];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: "missing-camp"
    });
    assert.ok((world.settlers || []).some((s) => s.id === mem.id));
    assert.equal(mem.homeSettlementId, settle.id);
});

function addLeanTo(world, x, y, tx, ty) {
    const chunk = originChunk(world);
    const entry = { uid: "lean1", id: "lean_to", x, y, tx, ty, rot: 0 };
    chunk.things.push(entry);
    return entry;
}

function stepSettlerWalk(world, rec, tx, ty, dt = 16) {
    const cc = world._ensureSettlerCreature(rec);
    const aiWorld = world._aiWorld();
    cc.x = rec.x;
    cc.y = rec.y;
    cc.role = "settler";
    cc.homeSettlementId = rec.homeSettlementId;
    cc.ai._walkToward(tx, ty, false, aiWorld, dt);
    cc.applyDesiredVel(dt);
    const sec = dt / 1000;
    const nx = cc.x + (cc.vx || 0) * sec;
    const ny = cc.y + (cc.vy || 0) * sec;
    if (!world._partyPoseBlocked(cc, nx, cc.y)) cc.x = nx;
    if (!world._partyPoseBlocked(cc, cc.x, ny)) cc.y = ny;
    rec.x = cc.x;
    rec.y = cc.y;
}

test("dedicated settler walks around a lean-to instead of sticking to it", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, { x: 40, y: 96 });
    addLeanTo(world, 40, 48, 2, 2);
    const dest = { x: 40, y: 16 };
    const startY = rec.y;
    let overlappedMs = 0;
    for (let i = 0; i < 240; i++) {
        const cc = world._ensureSettlerCreature(rec);
        stepSettlerWalk(world, rec, dest.x, dest.y, 16);
        if (world._partyPoseBlocked(cc, rec.x, rec.y)) overlappedMs += 16;
    }
    assert.ok(overlappedMs < 400, `stuck overlapping lean-to for ${overlappedMs}ms`);
    assert.ok(rec.y < startY - 20, `should walk north around the lean-to, y=${rec.y}`);
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), false);
});

test("dedicated settler pops out when standing inside a lean-to", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, { x: 40, y: 40 });
    addLeanTo(world, 40, 48, 2, 2);
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), true);
    for (let i = 0; i < 30; i++) {
        stepSettlerWalk(world, rec, 40, 96, 16);
    }
    assert.equal(world._partyPoseBlocked(cc, rec.x, rec.y), false);
});


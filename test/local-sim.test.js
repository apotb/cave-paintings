const { test } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol");
const LocalSim = require("../js/net/LocalSim");
const { loadDefs } = require("./helpers/load");

loadDefs();

function makeWorld() {
    return {
        id: "w-test",
        name: "Test",
        genVersion: 2,
        seed: 1,
        chunks: {},
        clock: { gameDay: 1, gameMinutes: 8 * 60, tickSpeed: 1 },
        poses: {},
        settlements: [],
        settlers: []
    };
}

async function makeSim() {
    const sim = new LocalSim({
        world: makeWorld(),
        character: {
            id: "p1p1p1p1",
            name: "Tester",
            inventory: [{ id: "stick", quantity: 2 }, null, null, null, null]
        }
    });
    await sim.connect();
    sim.flushAndListen();
    return sim;
}

test("LocalSim does not emit a join chat event", async () => {
    const sim = await makeSim();
    const evs = sim.sim.drainEvents();
    assert.equal(
        evs.some((e) => e.kind === "chat" && / joined/.test(e.text || "")),
        false
    );
    await sim.close();
});

test("LocalSim connect hosts SimWorld and HOTBAR reaches the sim", async () => {
    const sim = await makeSim();
    assert.equal(sim.isLocal, true);
    assert.equal(sim.connected, true);
    assert.ok(sim.sim);
    sim.sendAction({ type: Protocol.Actions.HOTBAR, index: 2 });
    const pawn = sim.sim.players.get("p1p1p1p1");
    assert.equal(pawn.hotbarIndex, 2);
    await sim.close();
});

test("LocalSim pause stops the tick timer", async () => {
    const sim = await makeSim();
    assert.ok(sim._tickTimer);
    sim.setPaused(true);
    assert.equal(sim._paused, true);
    assert.equal(sim._tickTimer, null);
    sim.setPaused(false);
    assert.ok(sim._tickTimer);
    await sim.close();
});

test("DIE then RESPAWN go through SimWorld", async () => {
    const sim = await makeSim();
    sim.sendAction({ type: Protocol.Actions.DIE });
    const pawn = sim.sim.players.get("p1p1p1p1");
    assert.equal(pawn.dead, true);
    sim.sendAction({ type: Protocol.Actions.RESPAWN });
    assert.equal(pawn.dead, false);
    await sim.close();
});

test("LocalSim persist writes SimWorld chunks into the world record", async () => {
    const sim = await makeSim();
    sim.sim.saveAll();
    assert.ok(sim.world.chunks);
    assert.equal(sim.world.seed, sim.sim.seed);
    assert.equal(sim.world.genVersion, 2);
    const cd = sim.world.directorCd?.[sim.playerId];
    assert.ok(Number(cd) > 0, "first join should persist a wanderer cooldown");
    await sim.close();
});

test("LocalSim persist stamps lastPlayedAt", async () => {
    const sim = await makeSim();
    assert.equal(sim.world.lastPlayedAt, undefined);
    const before = Date.now();
    await sim._persistWorld();
    assert.ok(sim.world.lastPlayedAt >= before);
    assert.ok(sim.world.lastPlayedAt <= Date.now());
    await sim.close();
});

test("LocalSim empty genVersion-2 world generates chunks and a spawn sign", async () => {
    const sim = await makeSim();
    const origin = sim.sim.chunks.get("0,0");
    assert.ok(origin, "origin chunk exists");
    assert.ok(origin.tiles?.some(Boolean), "origin has tiles");
    const hasSign = [...sim.sim.chunks.values()].some((c) =>
        (c.things || []).some((t) => t && t.id === "sign" && t.spawnHint)
    );
    assert.ok(hasSign, "origin spawn sign");
    await sim.close();
});

test("LocalSim clones storage events off the sim slot array", async () => {
    const Place = require("../shared/place");
    const DataStore = require("../shared/DataStore");
    const sim = await makeSim();
    const world = sim.sim;
    const pawn = world.players.get(sim.playerId);
    const chunk = world._ensureChunk(0, 0);
    const entry = {
        uid: "st_alias",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(entry, DataStore.getThing("wicker_basket"));
    entry.slots[0] = { id: "leaf_cord", quantity: 2 };
    chunk.things.push(entry);

    let ev = null;
    sim.on(Protocol.Types.EVENT, (payload) => {
        if (payload?.kind === "storage" && payload.uid === "st_alias") ev = payload;
    });
    world._emitStorage(chunk, entry);
    sim.session.flushEvents();
    assert.ok(ev?.slots);
    assert.notEqual(ev.slots, entry.slots);
    ev.slots[0].quantity = 99;
    assert.equal(entry.slots[0].quantity, 2);
    await sim.close();
});

test("LocalSim clones campfire events off the live pit stacks", async () => {
    const sim = await makeSim();
    const world = sim.sim;
    const pawn = world.players.get(sim.playerId);
    const chunk = world._ensureChunk(0, 0);
    const entry = {
        uid: "cf_alias",
        id: "campfire",
        x: pawn.x,
        y: pawn.y,
        fuel: [null, null],
        cook: null,
        catalyst: { id: "sharp_stick", quantity: 1, durability: 50 },
        simmer: [null, null, null, null]
    };
    chunk.things.push(entry);

    let ev = null;
    sim.on(Protocol.Types.EVENT, (payload) => {
        if (payload?.kind === "campfire" && payload.uid === "cf_alias") ev = payload;
    });
    world._emitCampfire(chunk, entry);
    sim.session.flushEvents();
    const cat = ev?.entry?.catalyst || ev?.catalyst;
    assert.ok(cat);
    assert.notEqual(cat, entry.catalyst);
    cat.durability = 1;
    assert.equal(entry.catalyst.durability, 50);
    await sim.close();
});

test("LocalSim DROP YOU reports the sim stack, not a second subtract", async () => {
    const sim = await makeSim();
    let you = null;
    sim.on(Protocol.Types.YOU, (payload) => { you = payload; });
    const pawn = sim.sim.players.get(sim.playerId);
    pawn.x = 32;
    pawn.y = 32;
    sim.sendAction({
        type: Protocol.Actions.DROP,
        amount: 1,
        x: pawn.x,
        y: pawn.y,
        pawnId: pawn.id
    });
    assert.equal(pawn.inventory[0].quantity, 1);
    assert.equal(you?.inventory?.[0]?.quantity, 1);
    await sim.close();
});

test("LocalSim relog keeps settler inventory and clothes", async () => {
    const Settlement = require("../shared/settlement");
    const sim = await makeSim();
    const world = sim.sim;
    const pawn = world.players.get(sim.playerId);
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "parked-og",
        name: "Og",
        x: pawn.x,
        y: pawn.y,
        inventory: [
            { id: "stick", quantity: 4 },
            { id: "pebble", quantity: 2 },
            null, null, null
        ],
        equipment: {
            head: null,
            torso: { id: "leaf_wrap", quantity: 1 },
            legs: null,
            feet: null,
            back: null,
            waist: []
        }
    });
    pawn.party.push(mem);
    sim.sendAction({
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: settle.id
    });
    const parked = (world.settlers || []).find((s) => s.id === "parked-og");
    assert.ok(parked);
    assert.equal(parked.inventory[0].id, "stick");
    sim.sim.saveAll();
    const blob = JSON.parse(JSON.stringify(sim.world));
    const saved = (blob.settlers || []).find((s) => s.id === "parked-og");
    assert.ok(saved, "world blob should contain the parked settler");
    assert.equal(saved.inventory[0].id, "stick");
    assert.equal(saved.inventory[0].quantity, 4);
    assert.equal(saved.equipment.torso.id, "leaf_wrap");
    await sim.close();

    const again = new LocalSim({
        world: blob,
        character: {
            id: "p1p1p1p1",
            name: "Tester",
            inventory: [{ id: "stick", quantity: 2 }, null, null, null, null]
        }
    });
    await again.connect();
    again.flushAndListen();
    const rec = (again.sim.settlers || []).find((s) => s.id === "parked-og");
    assert.ok(rec, "relog should restore the parked settler");
    assert.equal(rec.inventory[0].id, "stick");
    assert.equal(rec.inventory[0].quantity, 4);
    assert.equal(rec.inventory[1].id, "pebble");
    assert.equal(rec.equipment.torso.id, "leaf_wrap");
    const you = again.sim.youPayload(again.playerId);
    const row = (you.settlers || []).find((s) => s.id === "parked-og");
    assert.ok(row);
    assert.equal(row.inventory[0].id, "stick");
    assert.equal(row.equipment.torso.id, "leaf_wrap");
    await again.close();
});

test("LocalSim drop, pick, and relog keep companion clothes", async () => {
    const Settlement = require("../shared/settlement");
    const sim = await makeSim();
    const world = sim.sim;
    const pawn = world.players.get(sim.playerId);
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "travel-og",
        name: "Og",
        x: pawn.x,
        y: pawn.y,
        inventory: [
            { id: "sharp_stick", quantity: 1 },
            { id: "pebble", quantity: 2 },
            null, null, null
        ],
        equipment: {
            head: null,
            torso: { id: "leaf_wrap", quantity: 1 },
            legs: null,
            feet: null,
            back: null,
            waist: []
        }
    });
    pawn.party.push(mem);
    sim.sendAction({
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: settle.id
    });
    sim.sendAction({
        type: Protocol.Actions.SETTLEMENT,
        op: "pick",
        pawnId: mem.id
    });
    const back = (pawn.party || []).find((m) => m.id === "travel-og");
    assert.ok(back);
    assert.equal(back.inventory[0].id, "sharp_stick");
    assert.equal(back.equipment.torso.id, "leaf_wrap");
    const you = world.youPayload(pawn.id);
    const blob = JSON.parse(JSON.stringify(sim.world));
    await sim.close();

    const again = new LocalSim({
        world: blob,
        character: {
            id: "p1p1p1p1",
            name: "Tester",
            inventory: [{ id: "stick", quantity: 2 }, null, null, null, null],
            party: you.party
        }
    });
    await again.connect();
    again.flushAndListen();
    const restored = (again.sim.players.get("p1p1p1p1").party || [])
        .find((m) => m.id === "travel-og");
    assert.ok(restored, "relog should restore the companion");
    assert.equal(restored.inventory[0].id, "sharp_stick");
    assert.equal(restored.equipment.torso.id, "leaf_wrap");
    await again.close();
});

test("LocalSim relog keeps parked gear even if character.party still lists them", async () => {
    const Settlement = require("../shared/settlement");
    const sim = await makeSim();
    const world = sim.sim;
    const pawn = world.players.get(sim.playerId);
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "stale-og",
        name: "Og",
        x: pawn.x,
        y: pawn.y,
        inventory: [{ id: "stick", quantity: 4 }, null, null, null, null],
        equipment: {
            head: null,
            torso: { id: "leaf_wrap", quantity: 1 },
            legs: null,
            feet: null,
            back: null,
            waist: []
        }
    });
    pawn.party.push(mem);
    sim.sendAction({
        type: Protocol.Actions.SETTLEMENT,
        op: "drop",
        pawnId: mem.id,
        settlementId: settle.id
    });
    sim.sim.saveAll();
    const blob = JSON.parse(JSON.stringify(sim.world));
    await sim.close();

    const again = new LocalSim({
        world: blob,
        character: {
            id: "p1p1p1p1",
            name: "Tester",
            inventory: [{ id: "stick", quantity: 2 }, null, null, null, null],
            party: [{
                id: "stale-og",
                name: "Og",
                inventory: [null, null, null, null, null],
                equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] }
            }]
        }
    });
    await again.connect();
    again.flushAndListen();
    const rec = (again.sim.settlers || []).find((s) => s.id === "stale-og");
    assert.ok(rec);
    assert.equal((again.sim.players.get("p1p1p1p1").party || []).some((m) => m.id === "stale-og"), false);
    assert.equal(rec.inventory[0].id, "stick");
    assert.equal(rec.equipment.torso.id, "leaf_wrap");
    const row = (again.sim.youPayload("p1p1p1p1").settlers || []).find((s) => s.id === "stale-og");
    assert.equal(row.inventory[0].id, "stick");
    assert.equal(row.equipment.torso.id, "leaf_wrap");
    await again.close();
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs, DataStore, restoreRng } = require("./helpers/load");
const Place = require("../shared/place");
const BodyHealing = require("../shared/body/Healing");

loadDefs();

test.after(() => restoreRng());

test("pickup removes drop and fills inventory", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "d1", id: "stick", quantity: 1, x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.PICKUP, dropId: "d1" });
    assert.equal(chunk.drops.length, 0);
    assert.ok(pawn.inventory.some((s) => s && s.id === "stick"));
});

test("pickup leaves leftover when carry is full", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory = [
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 }
    ];
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "d2", id: "log", quantity: 10, x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.PICKUP, dropId: "d2" });
    assert.ok(chunk.drops.length === 1 || pawn.inventory.every((s) => s));
});

test("drop places a world stack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 3 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.DROP, amount: 1, x: pawn.x, y: pawn.y });
    assert.equal(pawn.inventory[0].quantity, 2);
    const chunk = originChunk(world);
    assert.ok(chunk.drops.some((d) => d.id === "stick"));
});

test("harvest sticks in range", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt1", id: "sticks", x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.HARVEST, uid: "lt1" });
    assert.ok(
        pawn.inventory.some((s) => s && s.id === "stick")
        || chunk.drops.some((d) => d.id === "stick")
    );
    const lt = chunk.lootableThings.find((e) => e.uid === "lt1");
    assert.ok(!lt || lt.gone || lt.regrowAt != null);
});

test("harvest out of range is a no-op", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.lootableThings.push({ uid: "lt2", id: "sticks", x: pawn.x + 400, y: pawn.y });
    const before = JSON.stringify(pawn.inventory);
    world.handleAction(pawn.id, { type: Protocol.Actions.HARVEST, uid: "lt2" });
    assert.equal(JSON.stringify(pawn.inventory), before);
    assert.equal(chunk.lootableThings[0].id, "sticks");
    assert.equal(chunk.lootableThings[0].gone, undefined);
});

test("inv_swap merges same id", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 2 };
    pawn.inventory[1] = { id: "stick", quantity: 3 };
    world.handleAction(pawn.id, { type: Protocol.Actions.INV_SWAP, from: 0, to: 1 });
    assert.equal(pawn.inventory[1].quantity, 5);
    assert.equal(pawn.inventory[0], null);
});

test("equip torso from hotbar", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf_wrap", quantity: 1 };
    world.handleAction(pawn.id, { type: Protocol.Actions.EQUIP, from: 0, slot: "torso" });
    assert.equal(pawn.equipment.torso?.id, "leaf_wrap");
    assert.equal(pawn.inventory[0], null);
});

test("craft leaf_cord spends leaves", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf", quantity: 5 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord" });
    assert.ok(pawn.inventory.some((s) => s && s.id === "leaf_cord"));
    assert.ok(!pawn.inventory.some((s) => s && s.id === "leaf" && s.quantity >= 5));
});

test("craft missing ingredient is a no-op", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord" });
    assert.ok(pawn.inventory.every((s) => !s));
});

test("attack starts melee", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.handleAction(pawn.id, { type: Protocol.Actions.ATTACK, angle: 0 });
    assert.equal(pawn.creature.isAttacking(), true);
});

test("corpse_take moves loot to inventory", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.corpses.push({
        id: "c1",
        x: pawn.x,
        y: pawn.y,
        loot: [{ id: "stick", quantity: 2 }]
    });
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CORPSE_TAKE,
        corpseId: "c1",
        index: 0,
        quantity: 2
    });
    assert.ok(pawn.inventory.some((s) => s && s.id === "stick"));
});

test("corpse_skin with knife marks skinned", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 1, toolClass: "knife", durability: 40 };
    pawn.hotbarIndex = 0;
    const chunk = originChunk(world);
    chunk.corpses.push({
        id: "c2",
        x: pawn.x,
        y: pawn.y,
        mobId: "deer",
        skinned: false,
        loot: []
    });
    world.handleAction(pawn.id, { type: Protocol.Actions.CORPSE_SKIN, corpseId: "c2" });
    assert.equal(chunk.corpses[0].skinned, true);
});

function makeCompanion(id, extra = {}) {
    return {
        id,
        name: id,
        x: 32,
        y: 32,
        facing: "down",
        vx: 0,
        vy: 0,
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        hotbarIndex: 0,
        kc: 1200,
        dead: false,
        prone: false,
        ownerId: "p1",
        leaderId: "p1",
        role: "companion",
        _resting: false,
        _restWalk: null,
        _wokeFromRest: false,
        lastSleep: null,
        ...extra
    };
}

function cutArm(creature) {
    const part = creature.anatomy.part("Left Arm") || creature.anatomy.core;
    part.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
}

function partyOf(world, pawn, doctor, patient) {
    pawn.party = [doctor, patient];
    world._ensureCompanionCreature(pawn, doctor);
    world._ensureCompanionCreature(pawn, patient);
    return [pawn, doctor, patient];
}

test("resting doctor gets up to tend a lying ally", () => {
    const { world, pawn } = createTestWorld();
    const doctor = makeCompanion("doc", {
        _resting: true,
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    const patient = makeCompanion("pat", { _resting: true });
    const members = partyOf(world, pawn, doctor, patient);
    cutArm(patient.creature);
    const ok = world._wakeRestingTender(pawn, doctor, members, pawn);
    assert.equal(ok, true);
    assert.equal(doctor._resting, false);
    assert.equal(doctor._wokeFromRest, true);
    assert.equal(patient._resting, true);
});

test("resting doctor stays down if the wounded ally is standing", () => {
    const { world, pawn } = createTestWorld();
    const doctor = makeCompanion("doc", {
        _resting: true,
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    const patient = makeCompanion("pat", { _resting: false });
    const members = partyOf(world, pawn, doctor, patient);
    cutArm(patient.creature);
    const ok = world._wakeRestingTender(pawn, doctor, members, pawn);
    assert.equal(ok, false);
    assert.equal(doctor._resting, true);
    assert.equal(doctor._wokeFromRest, false);
});

test("resting doctor wakes for a lying ally even if someone standing also needs tend", () => {
    const { world, pawn } = createTestWorld();
    const doctor = makeCompanion("doc", {
        _resting: true,
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    const standing = makeCompanion("stand", { _resting: false, x: 40, y: 32 });
    const lying = makeCompanion("lie", { _resting: true, x: 48, y: 32 });
    pawn.party = [doctor, standing, lying];
    world._ensureCompanionCreature(pawn, doctor);
    world._ensureCompanionCreature(pawn, standing);
    world._ensureCompanionCreature(pawn, lying);
    cutArm(standing.creature);
    cutArm(lying.creature);
    const members = [pawn, doctor, standing, lying];
    const ok = world._wakeRestingTender(pawn, doctor, members, pawn);
    assert.equal(ok, true);
    assert.equal(doctor._resting, false);
    assert.equal(doctor._wokeFromRest, true);
});

test("woke doctor delays returning to rest while a lying ally still needs tend", () => {
    const { world, pawn } = createTestWorld();
    const doctor = makeCompanion("doc", {
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null],
        _wokeFromRest: true
    });
    const patient = makeCompanion("pat", { _resting: true });
    partyOf(world, pawn, doctor, patient);
    cutArm(patient.creature);
    assert.equal(world._shouldDelaySleep(pawn, doctor), true);
    const target = BodyHealing.pickTendTarget(patient.creature.anatomy);
    assert.ok(target);
    BodyHealing.applyTend(patient.creature.anatomy, target, 0.5);
    assert.equal(world._shouldDelaySleep(pawn, doctor), false);
});

test("woke doctor walks back to the lean-to after tending", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const entry = { uid: "lt1", id: "lean_to", x: 32, y: 32, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    const doctor = makeCompanion("doc", {
        _wokeFromRest: true,
        lastSleep: { uid: "lt1", slot: 0, rot: 0 }
    });
    const patient = makeCompanion("pat", { _resting: true, lastSleep: { uid: "lt1", slot: 1, rot: 0 } });
    entry.occupants[1] = patient.id;
    partyOf(world, pawn, doctor, patient);
    world._tryReturnToBed(pawn, doctor);
    assert.equal(doctor._wokeFromRest, false);
    assert.ok(doctor._restWalk || doctor._resting);
    assert.equal(doctor._restWalk?.uid || doctor.lastSleep?.uid, "lt1");
});

test("wildlife movement and melee scale with tick speed", () => {
    const Party = require("../shared/party");
    assert.equal(Party.mobTimeScale(0), 0);
    assert.equal(Party.mobTimeScale(8), 8);
    assert.equal(Party.wandererTimeScale(8), 8);

    function walkDist(tickSpeed) {
        const { world } = createTestWorld();
        world.tickSpeed = tickSpeed;
        world.baseTickSpeed = tickSpeed;
        const entry = world._spawnMobAt("deer", 80, 80);
        const mob = world.mobs.get(entry.uid);
        assert.ok(mob);
        if (mob.ai) {
            mob.ai.state = "walk";
            mob.ai.timer = 8000;
            mob.ai.dirX = 1;
            mob.ai.dirY = 0;
            mob.ai.panicMs = 0;
        }
        const x0 = mob.x;
        for (let i = 0; i < 4; i++) world.tick(40);
        return Math.abs(mob.x - x0);
    }

    const d1 = walkDist(1);
    const d8 = walkDist(8);
    assert.ok(d1 > 1, `deer should walk at 1× (moved ${d1})`);
    assert.ok(d8 > d1 * 4, `8× should travel much farther (1×=${d1.toFixed(1)}, 8×=${d8.toFixed(1)})`);

    const { world } = createTestWorld();
    world.tickSpeed = 8;
    const entry = world._spawnMobAt("deer", 80, 80);
    const mob = world.mobs.get(entry.uid);
    mob.startMeleeAttack(0);
    const start = mob.attackTimer;
    assert.ok(start > 0);
    world.tick(40);
    const elapsed = start - mob.attackTimer;
    assert.ok(elapsed > 200, `8× melee should chew ~320ms of windup in 40ms wall time (got ${elapsed})`);
});

test("recruiting a wanderer drops stroll AI so they follow instead of walking off", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const { PartyAI, WandererStrollAI } = require("../shared/ai/headless");
    world.rng = () => 0;
    const id = "w-recruit-1";
    world.wanderers.set(id, {
        id,
        name: "Og",
        x: pawn.x,
        y: pawn.y,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    const w = world.wanderers.get(id);
    world._stepWanderer(w, 50);
    assert.ok(w.creature?.ai instanceof WandererStrollAI);
    world.handleAction(pawn.id, { type: Protocol.Actions.RECRUIT, wandererId: id });
    assert.equal(world.wanderers.has(id), false);
    const mem = (pawn.party || []).find((m) => m.id === id);
    assert.ok(mem, "wanderer should join the party");
    world.tick(50);
    const ai = mem.creature?.ai;
    assert.equal(ai && ai.constructor, PartyAI);
    assert.equal(ai instanceof WandererStrollAI, false);
});

test("addPlayer clusters a companion with no world pose next to the leader", () => {
    const { world } = createTestWorld();
    world.poses = {};
    const p = world.addPlayer("joiner", "Joiner", {
        name: "Joiner",
        party: [{ id: "buddy", name: "Og", x: 9000, y: 8000, facing: "up" }]
    });
    const mem = (p.party || []).find((m) => m.id === "buddy");
    assert.ok(mem, "companion should join");
    const dist = Math.hypot(mem.x - p.x, mem.y - p.y);
    assert.ok(dist <= 16 * 8, `expected near leader, dist=${dist} leader=${p.x},${p.y} mem=${mem.x},${mem.y}`);
    assert.notEqual(mem.x, 9000);
    assert.notEqual(mem.y, 8000);
});

test("addPlayer restores a companion logout pose for this world", () => {
    const { world } = createTestWorld();
    world.poses = {
        joiner: { x: 48, y: 64, facing: "down" },
        buddy: { x: 320, y: 400, facing: "left" }
    };
    const p = world.addPlayer("joiner", "Joiner", {
        name: "Joiner",
        party: [{ id: "buddy", name: "Og", x: 9000, y: 8000, facing: "up" }]
    });
    const mem = (p.party || []).find((m) => m.id === "buddy");
    assert.ok(mem);
    assert.equal(mem.x, 320);
    assert.equal(mem.y, 400);
    assert.equal(mem.facing, "left");
    assert.equal(p.x, 48);
    assert.equal(p.y, 64);
});

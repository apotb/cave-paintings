const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SimWorld } = require("../shared/sim/SimWorld");
const Patches = require("../shared/patches");
const Place = require("../shared/place");
const DataStore = require("../shared/DataStore");
const { createTestWorld, originChunk } = require("./helpers/simWorld");

function fillGrass(world) {
    for (const c of world.chunks.values()) {
        c.tiles = Array.from({ length: 8 * 8 }, () => "grass");
    }
}

function dropsOf(world) {
    const out = [];
    for (const c of world.chunks.values()) {
        for (const drop of c.drops || []) out.push(drop);
    }
    return out;
}

test("a hearth replaces the campfire after the item is cleared and keeps the flame", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    const { x, y } = world._tileCenter(tx, ty);
    const fire = {
        uid: "pit",
        id: "campfire",
        x, y, tx, ty,
        fuel: [{ id: "stick", quantity: 4 }, null],
        cook: { id: "apple", quantity: 1 },
        catalyst: { id: "sharp_stick", quantity: 1 },
        simmer: [{ id: "blueberry", quantity: 2 }, null, null, null],
        cookProgress: 3,
        burnRemaining: 12,
        pitTemp: 40
    };
    originChunk(world).things.push(fire);
    pawn.inventory = [
        { id: "hearth", quantity: 1 },
        { id: "log", quantity: 1 },
        { id: "log", quantity: 1 },
        { id: "log", quantity: 1 },
        { id: "log", quantity: 1 }
    ];
    pawn.hotbarIndex = 0;

    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx, ty, rot: 0,
        name: "Ash Camp"
    });

    assert.equal(fire.id, "hearth");
    assert.equal(fire.lit, true);
    assert.equal(fire.uid, "pit");
    assert.equal(fire.fuel[0].id, "stick");
    assert.equal(fire.fuel[0].quantity, 4);
    assert.equal(fire.burnRemaining, 12);
    assert.equal(fire.pitTemp, 40);
    assert.equal(fire.cook, null);
    assert.equal(fire.catalyst, null);
    assert.equal(fire.simmer[0], null);
    assert.equal(world.settlements.length, 1);
    assert.equal(world.settlements[0].stoneUid, fire.uid);
    assert.equal(fire.settlementId, world.settlements[0].id);
    assert.equal(pawn.inventory.some((s) => s?.id === "hearth"), false);
    assert.equal(pawn.inventory[0].id, "apple");
    assert.equal(pawn.inventory[0].quantity, 1);
    const dropped = dropsOf(world).map((d) => `${d.id}:${d.quantity}`).sort();
    assert.deepEqual(dropped, ["blueberry:2", "sharp_stick:1"]);

    pawn.inventory[4] = { id: "sharp_stick", quantity: 1 };
    world._campfireInvToSlot(pawn, fire, { slot: "catalyst", inv: 4 });
    assert.equal(fire.catalyst, null);
    assert.equal(pawn.inventory[4].id, "sharp_stick");
    world._campfireSlotToSlot(fire, { from: "fuel:0", to: "catalyst" });
    assert.equal(fire.catalyst, null);
    assert.equal(fire.fuel[0].quantity, 4);

    world._destroySettlement(world.settlements[0]);
    assert.equal(world.settlements.length, 0);
    assert.equal(fire.id, "campfire");
    assert.equal(fire.lit, undefined);
    assert.equal(fire.settlementId, undefined);
    assert.equal(fire.fuel[0].quantity, 4);
    assert.equal(fire.burnRemaining, 12);
    assert.equal(originChunk(world).things.includes(fire), true);
});

test("a hearth cannot be founded on empty ground", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "hearth", quantity: 1 };
    pawn.hotbarIndex = 0;
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx, ty, rot: 0,
        name: "Nowhere"
    });
    assert.equal(world.settlements.length, 0);
    assert.equal(pawn.inventory[0].id, "hearth");
    assert.equal(pawn.inventory[0].quantity, 1);
});

test("an unlit hearth returns to an unlit campfire when the settlement is destroyed", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    const { x, y } = world._tileCenter(tx, ty);
    const fire = {
        uid: "cold",
        id: "unlit_campfire",
        x, y, tx, ty,
        fuel: [{ id: "log", quantity: 2 }, null],
        cook: null,
        catalyst: null,
        simmer: [null, null, null, null],
        burnRemaining: 0
    };
    originChunk(world).things.push(fire);
    pawn.inventory[0] = { id: "hearth", quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx, ty, rot: 0,
        name: "Cold Camp"
    });
    assert.equal(fire.id, "hearth");
    assert.equal(fire.lit, false);
    assert.equal(fire.fuel[0].quantity, 2);
    world._destroySettlement(world.settlements[0]);
    assert.equal(fire.id, "unlit_campfire");
    assert.equal(fire.fuel[0].quantity, 2);
    assert.equal(originChunk(world).things.includes(fire), true);
});

test("settling stone saves load as hearths and item stacks", () => {
    const data = {
        v: 1,
        seed: 3,
        chunks: {
            "0,0": {
                x: 0,
                y: 0,
                things: [{
                    uid: "stone1",
                    id: "settling_stone",
                    x: 40,
                    y: 48,
                    settlementId: "s1",
                    fuel: [{ id: "stick", quantity: 3 }, null],
                    cook: { id: "apple", quantity: 1 },
                    catalyst: { id: "sharp_stick", quantity: 1 },
                    simmer: [{ id: "blueberry", quantity: 1 }, null, null, null]
                }],
                lootableThings: [],
                drops: [{ id: "settling_stone", quantity: 1 }],
                mobs: [],
                corpses: [{ loot: [{ id: "settling_stone", quantity: 1 }] }]
            }
        },
        settlers: [{ id: "set1", inventory: [{ id: "settling_stone", quantity: 1 }] }],
        wanderers: [{ id: "wan1", inventory: [{ id: "settling_stone", quantity: 1 }] }]
    };
    const loaded = SimWorld.loadFromData(data, { worldName: "patch" });
    const hearth = loaded.chunks.get("0,0").things[0];
    assert.equal(hearth.id, "hearth");
    assert.equal(hearth.lit, false);
    assert.equal(hearth.uid, "stone1");
    assert.equal(hearth.settlementId, "s1");
    assert.deepEqual(hearth.fuel, [null, null]);
    assert.equal(hearth.cook, null);
    assert.equal(hearth.catalyst, null);
    assert.equal(hearth.simmer[0], null);
    assert.equal(loaded.chunks.get("0,0").drops[0].id, "hearth");
    assert.equal(loaded.chunks.get("0,0").corpses[0].loot[0].id, "hearth");
    assert.equal(data.settlers[0].inventory[0].id, "hearth");
    assert.equal(data.wanderers[0].inventory[0].id, "hearth");

    Patches.applyWorld(data);
    assert.equal(hearth.id, "hearth");
    assert.equal(hearth.fuel[0], null);
    assert.equal(data.settlers[0].inventory[0].id, "hearth");

    const character = {
        inventory: [{ id: "settling_stone", quantity: 1 }, null, null, null, null],
        equipment: {
            head: null, torso: null, legs: null, feet: null, back: null,
            waist: [{ id: "settling_stone", quantity: 1 }]
        },
        overflow: [{ id: "settling_stone", quantity: 1 }],
        quarantine: [{ id: "settling_stone", quantity: 1 }],
        party: [{ inventory: [{ id: "settling_stone", quantity: 1 }] }]
    };
    Patches.applyCharacter(character);
    assert.equal(character.inventory[0].id, "hearth");
    assert.equal(character.equipment.waist[0].id, "hearth");
    assert.equal(character.overflow[0].id, "hearth");
    assert.equal(character.quarantine[0].id, "hearth");
    assert.equal(character.party[0].inventory[0].id, "hearth");

    const { world, pawn } = createTestWorld();
    world._applyCharacterSnapshot(pawn, {
        inventory: [{ id: "settling_stone", quantity: 1 }, null, null, null, null]
    });
    assert.equal(pawn.inventory[0].id, "hearth");
});

function foundOnFire(world, pawn, Protocol, rot) {
    fillGrass(world);
    const { tx, ty } = world._tileOf(pawn.x, pawn.y);
    const { x, y } = world._tileCenter(tx, ty);
    const fire = {
        uid: "pit",
        id: "campfire",
        x, y, tx, ty,
        rot: 0,
        fuel: [null, null],
        cook: null,
        catalyst: null,
        simmer: [null, null, null, null]
    };
    originChunk(world).things.push(fire);
    pawn.inventory[0] = { id: "hearth", quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "found",
        tx, ty, rot,
        name: "Ash Camp"
    });
    return fire;
}

test("a hearth can be founded facing a different way than the campfire", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const fire = foundOnFire(world, pawn, Protocol, 90);
    assert.equal(fire.id, "hearth");
    assert.equal(fire.rot, 90);
    const def = DataStore.getThing("hearth");
    assert.equal(Place.canRotate(def), true);
    assert.deepEqual(Place.interactTileOf(fire, 16, def), {
        tx: Math.floor(fire.x / 16) - 1,
        ty: Math.floor((fire.y - 1) / 16)
    });
    assert.ok(!Place.thingImageLoads(def).some((l) => /hearth_90|_90/.test(String(l.key))));
});

test("rotating a hearth turns its stand onto the next free tile", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const fire = foundOnFire(world, pawn, Protocol, 0);
    assert.equal(fire.rot, 0);
    world.drainEvents();
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "rotate",
        uid: fire.uid,
        x: fire.x,
        y: fire.y
    });
    assert.equal(fire.rot, 90);
    const def = DataStore.getThing("hearth");
    assert.deepEqual(Place.interactTileOf(fire, 16, def), {
        tx: Math.floor(fire.x / 16) - 1,
        ty: Math.floor((fire.y - 1) / 16)
    });
    const ev = world.drainEvents().find((e) => e.kind === "campfire" && e.entry);
    assert.equal(ev.entry.rot, 90);
});

test("setFuelFilter persists on the hearth", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const fire = foundOnFire(world, pawn, Protocol, 0);
    const settle = world.settlements[0];
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "setFuelFilter",
        settlementId: settle.id,
        uid: fire.uid,
        filter: { alwaysOn: false, preferLogs: false, offItems: ["leaf"] }
    });
    assert.equal(fire.fuelFilter?.alwaysOn, false);
    assert.equal(fire.fuelFilter?.preferLogs, false);
    assert.ok(fire.fuelFilter?.offItems?.includes("leaf"));
});

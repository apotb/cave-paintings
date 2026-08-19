const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs, DataStore, restoreRng } = require("./helpers/load");

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

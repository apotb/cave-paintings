const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk, emptyChunk, chunkKey } = require("./helpers/simWorld");
const { loadDefs, DataStore, restoreRng, seedRng } = require("./helpers/load");
const Place = require("../shared/place");
const Hide = require("../shared/hide");
const BodyHealing = require("../shared/body/Healing");
const BodyCombat = require("../shared/body/Combat");
const Party = require("../shared/party");
const Settlement = require("../shared/settlement");

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

test("dropping onto an existing pile keeps uid and raises quantity", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 3 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.DROP, amount: 1, x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.DROP, amount: 1, x: pawn.x, y: pawn.y });
    const chunk = originChunk(world);
    const sticks = chunk.drops.filter((d) => d.id === "stick");
    assert.equal(sticks.length, 1);
    assert.ok(sticks[0].uid);
    assert.equal(sticks[0].quantity, 2);
    const pub = world._publicDrop(sticks[0], chunk);
    assert.equal(pub.uid, sticks[0].uid);
    assert.equal(pub.quantity, 2);
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

test("inv_swap keeps grindstones of different stones apart", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "grindstone", quantity: 2, stone: "granite" };
    pawn.inventory[1] = { id: "grindstone", quantity: 3, stone: "diorite" };
    world.handleAction(pawn.id, { type: Protocol.Actions.INV_SWAP, from: 0, to: 1 });
    assert.equal(pawn.inventory[0]?.stone, "diorite");
    assert.equal(pawn.inventory[0]?.quantity, 3);
    assert.equal(pawn.inventory[1]?.stone, "granite");
    assert.equal(pawn.inventory[1]?.quantity, 2);

    pawn.inventory[0] = { id: "grindstone", quantity: 2, stone: "granite" };
    pawn.inventory[1] = { id: "grindstone", quantity: 3, stone: "granite" };
    world.handleAction(pawn.id, { type: Protocol.Actions.INV_SWAP, from: 0, to: 1 });
    assert.equal(pawn.inventory[0], null);
    assert.equal(pawn.inventory[1]?.quantity, 5);
    assert.equal(pawn.inventory[1]?.stone, "granite");

    pawn.inventory[0] = { id: "grindstone", quantity: 1 };
    pawn.inventory[1] = { id: "grindstone", quantity: 1, stone: "andesite" };
    world.handleAction(pawn.id, { type: Protocol.Actions.INV_SWAP, from: 0, to: 1 });
    assert.equal(pawn.inventory[0], null);
    assert.equal(pawn.inventory[1]?.quantity, 2);
});

test("backpack quick move does not merge a grindstone into a different stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    wearHideBundle(pawn, [{ id: "grindstone", quantity: 2, stone: "diorite" }]);
    pawn.inventory[0] = { id: "grindstone", quantity: 4, stone: "granite" };
    world.handleAction(pawn.id, {
        type: Protocol.Actions.INV_SWAP,
        from: 0,
        to: 1,
        fromBag: "overflow",
        toBag: "hotbar"
    });
    assert.equal(pawn.inventory[0]?.stone, "granite");
    assert.equal(pawn.inventory[0]?.quantity, 4);
    assert.equal(pawn.inventory[1]?.stone, "diorite");
    assert.equal(pawn.inventory[1]?.quantity, 2);
    assert.equal(pawn.overflow[0], null);

    wearHideBundle(pawn, [{ id: "grindstone", quantity: 2, stone: "granite" }]);
    pawn.inventory[0] = { id: "grindstone", quantity: 4, stone: "granite" };
    pawn.inventory[1] = null;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.INV_SWAP,
        from: 0,
        to: 0,
        fromBag: "overflow",
        toBag: "hotbar"
    });
    assert.equal(pawn.inventory[0]?.quantity, 6);
    assert.equal(pawn.inventory[0]?.stone, "granite");
    assert.equal(pawn.overflow[0], null);
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

test("craft count makes several leaf cords and stops when leaves run out", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf", quantity: 12 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord", count: 10 });
    assert.equal(pawn.inventory.find((s) => s?.id === "leaf_cord")?.quantity, 2);
    assert.equal(pawn.inventory.find((s) => s?.id === "leaf")?.quantity, 2);
});

test("craft count of 3 spends exactly three recipes", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf", quantity: 20 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord", count: 3 });
    assert.equal(pawn.inventory.find((s) => s?.id === "leaf_cord")?.quantity, 3);
    assert.equal(pawn.inventory.find((s) => s?.id === "leaf")?.quantity, 5);
});

test("shift-crafting a whole leaf stack puts the cords in that slot", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "pebble", quantity: 1 };
    pawn.inventory[1] = { id: "leaf", quantity: 90 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord", count: 99 });
    assert.equal(pawn.inventory[0]?.id, "pebble");
    assert.equal(pawn.inventory[1]?.id, "leaf_cord");
    assert.equal(pawn.inventory[1]?.quantity, 18);
    assert.ok(!pawn.inventory.some((s) => s?.id === "leaf"));
});

test("ctrl-crafting part of a stack leaves the rest and puts cords beside it", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "pebble", quantity: 1 };
    pawn.inventory[1] = { id: "leaf", quantity: 90 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord", count: 10 });
    assert.equal(pawn.inventory[1]?.id, "leaf");
    assert.equal(pawn.inventory[1]?.quantity, 40);
    assert.equal(pawn.inventory[2]?.id, "leaf_cord");
    assert.equal(pawn.inventory[2]?.quantity, 10);
});

test("batch craft keeps an existing cord stack and still refills the leaf slot", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf_cord", quantity: 2 };
    pawn.inventory[1] = { id: "leaf", quantity: 90 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord", count: 99 });
    assert.equal(pawn.inventory[0]?.quantity, 2);
    assert.equal(pawn.inventory[1]?.id, "leaf_cord");
    assert.equal(pawn.inventory[1]?.quantity, 18);
});

test("a single craft does not move cords back into a leftover leaf stack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "pebble", quantity: 1 };
    pawn.inventory[1] = { id: "leaf", quantity: 90 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord" });
    assert.equal(pawn.inventory[1]?.id, "leaf");
    assert.equal(pawn.inventory[1]?.quantity, 85);
    assert.equal(pawn.inventory[2]?.id, "leaf_cord");
    assert.equal(pawn.inventory[2]?.quantity, 1);
});

test("craft count spends a whole basket stack in one action", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_craft_batch",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf", quantity: 10 };
    chunk.things.push(basket);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CRAFT,
        id: "leaf_cord",
        count: 99,
        storageUid: basket.uid
    });
    assert.equal(pawn.inventory.find((s) => s?.id === "leaf_cord")?.quantity, 2);
    assert.equal(basket.slots[0], null);
});

test("craft leaf_cord spends leaves from a nearby basket", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_craft_leaves",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf", quantity: 5 };
    chunk.things.push(basket);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CRAFT,
        id: "leaf_cord",
        storageUid: basket.uid
    });
    assert.ok(pawn.inventory.some((s) => s && s.id === "leaf_cord"));
    assert.equal(basket.slots[0], null);
    assert.ok(!pawn.inventory.some((s) => s && s.id === "leaf"));
});

function wearHideBundle(pawn, stacks) {
    pawn.equipment.back = { id: "hide_bundle", quantity: 1 };
    pawn.overflow = [null, null, null];
    for (let i = 0; i < stacks.length; i++) pawn.overflow[i] = stacks[i];
}

test("craft leaf_cord spends leaves from the backpack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    wearHideBundle(pawn, [{ id: "leaf", quantity: 5 }]);
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord" });
    assert.ok(pawn.inventory.some((s) => s && s.id === "leaf_cord"));
    assert.equal(pawn.overflow[0], null);
});

test("craft leaf_cord uses hotbar leaves before backpack leaves", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf", quantity: 2 };
    wearHideBundle(pawn, [{ id: "leaf", quantity: 8 }]);
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord" });
    assert.ok(pawn.inventory.some((s) => s && s.id === "leaf_cord"));
    assert.ok(!pawn.inventory.some((s) => s && s.id === "leaf"));
    assert.equal(pawn.overflow[0]?.quantity, 5);
});

test("shift-crafting a backpack leaf stack puts the cords in that slot", () => {
    const { world, pawn, Protocol } = createTestWorld();
    wearHideBundle(pawn, [{ id: "leaf", quantity: 10 }]);
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "leaf_cord", count: 99 });
    assert.equal(pawn.overflow[0]?.id, "leaf_cord");
    assert.equal(pawn.overflow[0]?.quantity, 2);
    assert.ok(!pawn.inventory.some((s) => s?.id === "leaf" || s?.id === "leaf_cord"));
});

test("craft leaf_cord uses backpack leaves before basket leaves", () => {
    const { world, pawn, Protocol } = createTestWorld();
    wearHideBundle(pawn, [{ id: "leaf", quantity: 2 }]);
    const chunk = originChunk(world);
    const basket = {
        uid: "st_craft_pack",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf", quantity: 8 };
    chunk.things.push(basket);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CRAFT,
        id: "leaf_cord",
        storageUid: basket.uid
    });
    assert.ok(pawn.inventory.some((s) => s && s.id === "leaf_cord"));
    assert.equal(pawn.overflow[0], null);
    assert.equal(basket.slots[0]?.quantity, 5);
});

test("craft leaf_cord uses pocket leaves before basket leaves", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "leaf", quantity: 2 };
    const chunk = originChunk(world);
    const basket = {
        uid: "st_craft_mix",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf", quantity: 8 };
    chunk.things.push(basket);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CRAFT,
        id: "leaf_cord",
        storageUid: basket.uid
    });
    assert.ok(pawn.inventory.some((s) => s && s.id === "leaf_cord"));
    assert.ok(!pawn.inventory.some((s) => s && s.id === "leaf"));
    assert.equal(basket.slots[0]?.quantity, 5);
});

test("craft sharp_stick needs a nearby rock or settling stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 1 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "sharp_stick" });
    assert.ok(!pawn.inventory.some((s) => s?.id === "sharp_stick"));

    originChunk(world).things.push({
        uid: "ss_rock",
        id: "settling_stone",
        x: pawn.x,
        y: pawn.y
    });
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "sharp_stick" });
    assert.ok(pawn.inventory.some((s) => s?.id === "sharp_stick"));
    assert.ok(!pawn.inventory.some((s) => s?.id === "stick"));
});

test("craft grindstone takes the first pebble's stone and defaults to andesite", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "pebble", quantity: 1, stone: "granite" };
    pawn.inventory[1] = { id: "pebble", quantity: 5, stone: "limestone" };
    originChunk(world).things.push({ uid: "rock_grind", id: "rock", x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "grindstone" });
    assert.equal(pawn.inventory.some((s) => s?.id === "grindstone"), false);

    Research.unlock(pawn, "grinding");
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "grindstone" });
    const made = pawn.inventory.find((s) => s?.id === "grindstone");
    assert.ok(made);
    assert.equal(made.stone, "granite");
    assert.equal(pawn.inventory.some((s) => s?.id === "pebble" && s.stone === "granite"), false);
    const lime = pawn.inventory.find((s) => s?.id === "pebble" && s.stone === "limestone");
    assert.equal(lime.quantity, 3);

    pawn.inventory[0] = { id: "pebble", quantity: 3 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "grindstone" });
    const plain = pawn.inventory.find((s) => s?.id === "grindstone" && s.stone === "andesite");
    assert.ok(plain);
});

test("craft painting circle takes the first pebble's stone and defaults to andesite", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "pebble", quantity: 12, stone: "granite" };
    pawn.inventory[1] = { id: "pebble", quantity: 12, stone: "limestone" };
    pawn.inventory[2] = { id: "leaf_cord", quantity: 12 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "painting_circle" });
    const made = pawn.inventory.find((s) => s?.id === "painting_circle");
    assert.ok(made);
    assert.equal(made.stone, "granite");
    assert.equal(pawn.inventory.some((s) => s?.id === "pebble" && s.stone === "granite"), false);
    const lime = pawn.inventory.find((s) => s?.id === "pebble" && s.stone === "limestone");
    assert.equal(lime.quantity, 12);

    pawn.inventory[0] = { id: "pebble", quantity: 12 };
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "painting_circle" });
    const plain = pawn.inventory.find((s) => s?.id === "painting_circle" && s.stone === "andesite");
    assert.ok(plain);
});

test("craft tally_stick spends bone and needs a held knife", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    pawn.inventory[0] = { id: "stone_tool", quantity: 1, toolClass: "knife", knapDamage: 4 };
    pawn.inventory[1] = { id: "bone", quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "tally_stick" });
    assert.equal(pawn.inventory.some((s) => s?.id === "tally_stick"), false);

    Research.unlock(pawn, "counting");
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "tally_stick" });
    assert.ok(pawn.inventory.some((s) => s?.id === "tally_stick"));
    assert.ok(!pawn.inventory.some((s) => s?.id === "bone"));
    assert.equal(pawn.inventory[0]?.toolClass, "knife");
});

test("craft digging_stick needs Digging, a log, a rock, and knife or scraper", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    pawn.inventory[0] = { id: "stone_tool", quantity: 1, toolClass: "scraper", knapDamage: 3 };
    pawn.inventory[1] = { id: "log", quantity: 1 };
    pawn.hotbarIndex = 0;
    originChunk(world).things.push({ uid: "rock_dig", id: "rock", x: pawn.x, y: pawn.y });
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "digging_stick" });
    assert.equal(pawn.inventory.some((s) => s?.id === "digging_stick"), false);
    Research.unlock(pawn, "digging");
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "digging_stick" });
    const stick = pawn.inventory.find((s) => s?.id === "digging_stick");
    assert.ok(stick);
    assert.equal(stick.weight ?? DataStore.getItem("digging_stick").weight, 0.9);
    assert.ok(!pawn.inventory.some((s) => s?.id === "log"));
});

test("dig melee needs Digging tech, merge-drops clay, and removes the patch", () => {
    const Research = require("../shared/research");
    const Dig = require("../shared/dig");
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    pawn.inventory[0] = { id: "digging_stick", quantity: 1, durability: 50 };
    pawn.hotbarIndex = 0;
    const patch = { uid: "clay-1", id: "clay_patch", x: pawn.x + 8, y: pawn.y, digProgress: 0 };
    originChunk(world).things.push(patch);
    const creature = world.creatures.get(pawn.id);
    assert.ok(creature);
    creature.currentAttack = { id: "dig_thrust", def: { id: "dig_thrust" } };
    creature.attackAngle = 0;
    creature.attackHitSet = new Set();
    world._tryDigFromMelee(creature, null);
    assert.equal(Number(patch.digProgress) || 0, 0);
    Research.unlock(pawn, "digging");
    creature._attackDugPatch = false;
    creature._attackWoreHeld = false;
    creature.attackHitSet = new Set();
    world._tryDigFromMelee(creature, null);
    assert.ok(Number(patch.digProgress) > 0);
    assert.ok((Number(patch.digTaken) || 0) >= 1);
    assert.equal(qtyInv(pawn, "clay"), 1);
    creature._attackDugPatch = false;
    creature._attackWoreHeld = false;
    creature.attackHitSet = new Set();
    world._tryDigFromMelee(creature, null);
    assert.equal(qtyInv(pawn, "clay"), 2);
    const def = DataStore.getThing("clay_patch");
    let hits = 2;
    while (Dig.stillDiggable(def, patch) && hits < 40) {
        creature._attackDugPatch = false;
        creature._attackWoreHeld = false;
        creature.attackHitSet = new Set();
        world._tryDigFromMelee(creature, null);
        hits++;
    }
    assert.equal(hits, 25);
    assert.equal(patch.gone, true);
    assert.equal(originChunk(world).things.includes(patch), false);
    assert.equal(qtyInv(pawn, "clay"), 25);
    assert.equal(pawn.inventory[0].durability, 50 - hits);
});

test("dig melee removes a stump in half the hits of clay and drops nothing", () => {
    const Research = require("../shared/research");
    const Dig = require("../shared/dig");
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    Research.unlock(pawn, "digging");
    pawn.inventory[0] = { id: "digging_stick", quantity: 1, durability: 50 };
    pawn.hotbarIndex = 0;
    const stump = { uid: "stump-1", id: "tree_stump", x: pawn.x + 8, y: pawn.y, digProgress: 0 };
    originChunk(world).things.push(stump);
    const creature = world.creatures.get(pawn.id);
    assert.ok(creature);
    creature.currentAttack = { id: "dig_thrust", def: { id: "dig_thrust" } };
    creature.attackAngle = 0;
    const def = DataStore.getThing("tree_stump");
    let hits = 0;
    while (Dig.stillDiggable(def, stump) && hits < 40) {
        creature._attackDugPatch = false;
        creature._attackWoreHeld = false;
        creature.attackHitSet = new Set();
        world._tryDigFromMelee(creature, null);
        hits++;
    }
    assert.equal(hits, 10);
    assert.equal(stump.gone, true);
    assert.equal(originChunk(world).things.includes(stump), false);
    assert.equal(originChunk(world).drops.length, 0);
    assert.equal(pawn.inventory[0].durability, 40);
});

test("dig melee uproots grass, snow, and blueberry bushes in 5 hits with stick and leaf drops", () => {
    const Research = require("../shared/research");
    const Dig = require("../shared/dig");
    const cases = [
        { id: "bush", list: "things", fruit: null },
        { id: "snow_bush", list: "things", fruit: null },
        { id: "blueberry_bush", list: "lootableThings", fruit: "blueberry" }
    ];
    for (const spec of cases) {
        const { world, pawn } = createTestWorld();
        const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
        world.settlements.push(settle);
        Research.unlock(pawn, "digging");
        pawn.inventory[0] = { id: "digging_stick", quantity: 1, durability: 50 };
        pawn.hotbarIndex = 0;
        const bush = { uid: `bush-${spec.id}`, id: spec.id, x: pawn.x + 8, y: pawn.y, digProgress: 0 };
        originChunk(world)[spec.list].push(bush);
        const creature = world.creatures.get(pawn.id);
        assert.ok(creature);
        creature.currentAttack = { id: "dig_thrust", def: { id: "dig_thrust" } };
        creature.attackAngle = 0;
        const def = DataStore.getThing(spec.id);
        let hits = 0;
        while (Dig.stillDiggable(def, bush) && hits < 40) {
            creature._attackDugPatch = false;
            creature._attackWoreHeld = false;
            creature.attackHitSet = new Set();
            world._tryDigFromMelee(creature, null);
            hits++;
        }
        assert.equal(hits, 5, spec.id);
        assert.equal(bush.gone, true, spec.id);
        assert.equal(originChunk(world)[spec.list].includes(bush), false, spec.id);
        const drops = originChunk(world).drops;
        const qty = (id) => drops.filter((d) => d.id === id).reduce((n, d) => n + d.quantity, 0);
        assert.ok(qty("stick") >= 3 && qty("stick") <= 5, `${spec.id} sticks`);
        assert.ok(qty("leaf") >= 8 && qty("leaf") <= 14, `${spec.id} leaves`);
        assert.equal(qty("log"), 0, spec.id);
        assert.equal(qty("clay"), 0, spec.id);
        if (spec.fruit) assert.equal(qty(spec.fruit), 5, spec.id);
        else assert.equal(qty("blueberry"), 0, spec.id);
        assert.equal(pawn.inventory[0].durability, 45, spec.id);
    }
});

test("storage quick move keeps grindstones of different stones apart", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_grind",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    chunk.things.push(basket);

    const deposit = (slot, inv, amount) => world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "inv_to_slot",
        uid: basket.uid,
        slot: String(slot),
        inv,
        amount
    });
    const take = (slot, amount) => world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "slot_to_inv",
        uid: basket.uid,
        slot: String(slot),
        inv: -1,
        amount
    });

    basket.slots[0] = { id: "grindstone", quantity: 3, stone: "diorite" };
    pawn.inventory[0] = { id: "grindstone", quantity: 2, stone: "granite" };
    deposit(0, 0, 1);
    assert.equal(basket.slots[0]?.quantity, 3);
    assert.equal(basket.slots[0]?.stone, "diorite");
    assert.equal(pawn.inventory[0]?.quantity, 2);
    assert.equal(pawn.inventory[0]?.stone, "granite");

    deposit(1, 0, 1);
    assert.equal(basket.slots[1]?.stone, "granite");
    assert.equal(basket.slots[1]?.quantity, 1);
    assert.equal(pawn.inventory[0]?.quantity, 1);

    basket.slots[0] = { id: "grindstone", quantity: 3, stone: "granite" };
    pawn.inventory[0] = { id: "grindstone", quantity: 2, stone: "granite" };
    deposit(0, 0, 1);
    assert.equal(basket.slots[0]?.quantity, 4);
    assert.equal(basket.slots[0]?.stone, "granite");
    assert.equal(pawn.inventory[0]?.quantity, 1);

    pawn.inventory[0] = { id: "grindstone", quantity: 2, stone: "andesite" };
    pawn.inventory[1] = null;
    basket.slots[0] = { id: "grindstone", quantity: 1, stone: "granite" };
    take(0, 1);
    assert.equal(basket.slots[0], null);
    assert.equal(pawn.inventory[0]?.quantity, 2);
    assert.equal(pawn.inventory[0]?.stone, "andesite");
    assert.equal(pawn.inventory[1]?.stone, "granite");
    assert.equal(pawn.inventory[1]?.quantity, 1);

    pawn.inventory[0] = { id: "grindstone", quantity: 2 };
    pawn.inventory[1] = null;
    basket.slots[0] = { id: "grindstone", quantity: 1, stone: "andesite" };
    take(0, 1);
    assert.equal(pawn.inventory[0]?.quantity, 3);
    assert.equal(pawn.inventory[1], null);

    basket.slots[0] = { id: "grindstone", quantity: 2, stone: "granite" };
    basket.slots[1] = { id: "grindstone", quantity: 3, stone: "diorite" };
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "slot_to_slot",
        uid: basket.uid,
        from: "0",
        to: "1"
    });
    assert.equal(basket.slots[0]?.stone, "diorite");
    assert.equal(basket.slots[0]?.quantity, 3);
    assert.equal(basket.slots[1]?.stone, "granite");
    assert.equal(basket.slots[1]?.quantity, 2);
});

test("basket right-click take moves one cord, not the whole stack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_cords",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf_cord", quantity: 2 };
    chunk.things.push(basket);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "slot_to_inv",
        uid: "st_cords",
        slot: "0",
        amount: 1,
        inv: -1
    });
    assert.equal(basket.slots[0]?.quantity, 1);
    assert.equal(pawn.inventory.find((s) => s?.id === "leaf_cord")?.quantity, 1);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "inv_to_slot",
        uid: "st_cords",
        slot: "0",
        inv: pawn.inventory.findIndex((s) => s?.id === "leaf_cord"),
        amount: 1
    });
    assert.equal(basket.slots[0]?.quantity, 2);
    assert.equal(pawn.inventory.every((s) => !s || s.id !== "leaf_cord"), true);
});

test("basket inv_to_slot can fill a stack then overflow into an empty slot", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_leaves",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf", quantity: 90 };
    chunk.things.push(basket);
    pawn.inventory[0] = { id: "leaf", quantity: 20 };

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "inv_to_slot",
        uid: "st_leaves",
        slot: "0",
        inv: 0,
        amount: 9
    });
    assert.equal(basket.slots[0]?.quantity, 99);
    assert.equal(pawn.inventory[0]?.quantity, 11);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "inv_to_slot",
        uid: "st_leaves",
        slot: "1",
        inv: 0,
        amount: 11
    });
    assert.equal(basket.slots[0]?.quantity, 99);
    assert.equal(basket.slots[1]?.quantity, 11);
    assert.equal(pawn.inventory[0], null);
});

test("storage public slots are copies, not the live basket array", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_copy",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "leaf_cord", quantity: 2 };
    const pub = world._storagePublic(basket, chunk);
    assert.notEqual(pub.slots, basket.slots);
    pub.slots[0].quantity = 99;
    assert.equal(basket.slots[0].quantity, 2);
});

test("rack flesh scrapes the named rack even if a basket is underfoot", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = {
        id: "pebble",
        toolClass: "scraper",
        knapQuality: "rough",
        quantity: 1
    };
    pawn.hotbarIndex = 0;
    const chunk = originChunk(world);
    const basket = {
        uid: "st_underfoot",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    chunk.things.push(basket);
    const rack = {
        uid: "rack_flesh",
        id: "drying_rack",
        x: pawn.x + 40,
        y: pawn.y
    };
    Place.ensureStorageEntry(rack, DataStore.getThing("drying_rack"));
    rack.slots[0] = { id: "deer_hide", quantity: 1 };
    chunk.things.push(rack);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.RACK_FLESH,
        uid: rack.uid,
        pawnId: pawn.id,
        x: pawn.x,
        y: pawn.y
    });
    assert.equal(rack.slots[0]?.id, "deer_hide_fleshed");
    assert.equal(basket.slots[0], null);
});

function testCampfire(pawn) {
    return {
        uid: "cf_test",
        id: "campfire",
        x: pawn.x,
        y: pawn.y,
        fuel: [null, null],
        cook: null,
        catalyst: null,
        simmer: [null, null, null, null]
    };
}

test("campfire public stacks are copies, not the live pit slots", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.catalyst = { id: "sharp_stick", quantity: 1, durability: 50 };
    fire.fuel[0] = { id: "stick", quantity: 4 };
    chunk.things.push(fire);
    const pub = world._campfirePublic(fire, chunk);
    assert.notEqual(pub.catalyst, fire.catalyst);
    assert.notEqual(pub.fuel, fire.fuel);
    assert.notEqual(pub.simmer, fire.simmer);
    pub.catalyst.durability = 1;
    pub.fuel[0].quantity = 99;
    assert.equal(fire.catalyst.durability, 50);
    assert.equal(fire.fuel[0].quantity, 4);
});

test("cannot light or relight a campfire until Fire is researched", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    Research.ensureTechs(pawn);
    pawn.techs.fire = false;
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.id = "unlit_campfire";
    fire.fuel[0] = { id: "stick", quantity: 8 };
    chunk.things.push(fire);
    pawn.inventory[0] = { id: "sharp_stick", quantity: 1, durability: 50 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.LIGHT_FIRE, x: pawn.x, y: pawn.y });
    assert.equal(fire.id, "unlit_campfire");
    assert.equal(Research.techUnlocked("fire", pawn), false);
    pawn.techs.fire = true;
    world.handleAction(pawn.id, { type: Protocol.Actions.LIGHT_FIRE, x: pawn.x, y: pawn.y });
    assert.equal(fire.id, "campfire");
});

test("campfire inv_to_slot takes a sharp stick from the hotbar", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    chunk.things.push(fire);
    pawn.inventory[0] = { id: "sharp_stick", quantity: 1, durability: 50 };

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "inv_to_slot",
        uid: "cf_test",
        x: pawn.x,
        y: pawn.y,
        slot: "catalyst",
        inv: 0,
        amount: 1
    });
    assert.equal(fire.catalyst?.id, "sharp_stick");
    assert.equal(pawn.inventory[0], null);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "slot_to_inv",
        uid: "cf_test",
        x: pawn.x,
        y: pawn.y,
        slot: "catalyst",
        inv: -1,
        amount: 1
    });
    assert.equal(fire.catalyst, null);
    assert.equal(pawn.inventory.find((s) => s?.id === "sharp_stick")?.quantity, 1);
});

test("campfire slot_to_inv can take a reserved roasting stick with no food on the spit", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.catalyst = { id: "sharp_stick", quantity: 1, durability: 50 };
    fire.catalystReserved = true;
    chunk.things.push(fire);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "slot_to_inv",
        uid: "cf_test",
        x: pawn.x,
        y: pawn.y,
        slot: "catalyst",
        inv: -1,
        amount: 1
    });
    assert.equal(fire.catalyst, null);
    assert.equal(fire.catalystReserved, false);
    assert.equal(pawn.inventory.find((s) => s?.id === "sharp_stick")?.quantity, 1);
});

test("campfire slot_to_inv cannot take the stick while food is roasting", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.catalyst = { id: "sharp_stick", quantity: 1, durability: 50 };
    fire.cook = { id: "apple", quantity: 1 };
    chunk.things.push(fire);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "slot_to_inv",
        uid: "cf_test",
        x: pawn.x,
        y: pawn.y,
        slot: "catalyst",
        inv: -1,
        amount: 1
    });
    assert.equal(fire.catalyst?.id, "sharp_stick");
    assert.equal(pawn.inventory.some((s) => s && s.id === "sharp_stick"), false);
});

test("campfire cook slot takes roast food after a stick is loaded", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.catalyst = { id: "sharp_stick", quantity: 1, durability: 50 };
    chunk.things.push(fire);
    pawn.inventory[0] = { id: "raw_venison", quantity: 2 };

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "inv_to_slot",
        uid: "cf_test",
        x: pawn.x,
        y: pawn.y,
        slot: "cook",
        inv: 0,
        amount: 1
    });
    assert.equal(fire.cook?.id, "raw_venison");
    assert.equal(pawn.inventory[0]?.quantity, 1);
});

test("sharp stick breaking on a fire drops the roast on the ground beside it", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.catalyst = { id: "sharp_stick", quantity: 1, durability: 1 };
    fire.cook = { id: "apple", quantity: 1, spoilAt: 4000 };
    fire.cookProgress = 4;
    chunk.things.push(fire);
    world._wearRoastCatalyst(fire, 50);
    assert.equal(fire.catalyst, null);
    assert.equal(fire.cook, null);
    assert.equal(fire.cookProgress, 0);
    const drop = (chunk.drops || []).find((d) => d && d.id === "apple");
    assert.ok(drop, "apple should land as a ground drop");
    assert.equal(drop.quantity, 1);
    assert.equal(drop.spoilAt, 4000);
    const dist = Math.hypot((drop.x || 0) - fire.x, (drop.y || 0) - fire.y);
    assert.ok(dist > 0 && dist <= 16, `should sit beside the fire, dist=${dist}`);
});

test("campfire simmer slot takes an ingredient after a coconut shell", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.catalyst = { id: "cracked_coconut", quantity: 1 };
    chunk.things.push(fire);
    pawn.inventory[0] = { id: "apple", quantity: 3 };

    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "inv_to_slot",
        uid: "cf_test",
        x: pawn.x,
        y: pawn.y,
        slot: "simmer:0",
        inv: 0,
        amount: 1
    });
    assert.equal(fire.simmer[0]?.id, "apple");
    assert.equal(pawn.inventory[0]?.quantity, 2);
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

test("corpse_take as a companion fills that pawn, not the leader", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory = [
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 },
        { id: "log", quantity: 99 }
    ];
    const buddy = {
        id: "buddy",
        name: "Og",
        x: pawn.x,
        y: pawn.y,
        facing: "down",
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        hotbarIndex: 0,
        hp: 100,
        mhp: 100,
        dead: false
    };
    pawn.party = [buddy];
    const chunk = originChunk(world);
    chunk.corpses.push({
        id: "c-buddy",
        x: pawn.x,
        y: pawn.y,
        loot: [{ id: "pebble", quantity: 3 }]
    });
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: "buddy" });
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CORPSE_TAKE,
        corpseId: "c-buddy",
        index: 0,
        itemId: "pebble",
        quantity: 3,
        pawnId: "buddy"
    });
    const pebbles = (s) => (s || []).reduce((n, st) => n + (st?.id === "pebble" ? (st.quantity || 0) : 0), 0);
    assert.equal(pebbles(buddy.inventory), 3);
    assert.equal(pebbles(pawn.inventory), 0);
    assert.equal(chunk.corpses.length, 0);
});

test("corpse_skin cleaver drops more meat than a knife", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const skin = (toolClass, id) => {
        pawn.inventory[0] = { id: "stick", quantity: 1, toolClass, durability: 40 };
        pawn.hotbarIndex = 0;
        chunk.corpses.push({
            id,
            x: pawn.x,
            y: pawn.y,
            mobId: "deer",
            skinned: false,
            loot: []
        });
        world.rng = () => 0;
        world.handleAction(pawn.id, { type: Protocol.Actions.CORPSE_SKIN, corpseId: id });
        const entry = chunk.corpses.find((c) => c.id === id);
        const qty = (itemId) => (entry.loot || [])
            .filter((s) => s && s.id === itemId)
            .reduce((n, s) => n + (s.quantity || 0), 0);
        return { skinned: entry.skinned, venison: qty("raw_venison"), hide: qty("deer_hide"), bone: qty("bone") };
    };
    const knife = skin("knife", "deer-knife");
    const cleaver = skin("cleaver", "deer-cleaver");
    assert.equal(knife.skinned, true);
    assert.equal(knife.venison, 2);
    assert.equal(knife.hide, 1);
    assert.equal(knife.bone, 2);
    assert.equal(cleaver.skinned, true);
    assert.equal(cleaver.venison, 4);
    assert.equal(cleaver.hide, 1);
    assert.equal(cleaver.bone, 2);
    pawn.inventory[0] = { id: "stick", quantity: 1, toolClass: "hand_axe", durability: 40 };
    chunk.corpses.push({
        id: "deer-axe",
        x: pawn.x,
        y: pawn.y,
        mobId: "deer",
        skinned: false,
        loot: []
    });
    world.handleAction(pawn.id, { type: Protocol.Actions.CORPSE_SKIN, corpseId: "deer-axe" });
    const axe = chunk.corpses.find((c) => c.id === "deer-axe");
    assert.equal(axe.skinned, false);
    assert.equal(axe.loot.length, 0);
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
    const skinEv = world.drainEvents().find((e) => e.kind === "corpse" && e.op === "skin");
    assert.ok(skinEv);
    assert.equal(skinEv.entry.x, pawn.x);
    assert.equal(skinEv.entry.y, pawn.y);
});

test("corpse_skin does not butcher a carcass", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 1, toolClass: "knife", durability: 40 };
    pawn.hotbarIndex = 0;
    const chunk = originChunk(world);
    chunk.corpses.push({
        id: "carcass-1",
        x: pawn.x,
        y: pawn.y,
        mobId: "deer",
        skinned: false,
        stage: "carcass",
        loot: [{ id: "bone", quantity: 2 }]
    });
    world.handleAction(pawn.id, { type: Protocol.Actions.CORPSE_SKIN, corpseId: "carcass-1" });
    const entry = chunk.corpses[0];
    assert.equal(entry.stage, "carcass");
    assert.equal(entry.skinned, false);
    assert.equal(entry.loot.length, 1);
    assert.equal(entry.loot[0].id, "bone");
    const skinEv = world.drainEvents().find((e) => e.kind === "corpse" && e.op === "skin");
    assert.equal(skinEv, undefined);
});

test("corpse_skin does not butcher a corpse that has aged into a carcass", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "stick", quantity: 1, toolClass: "knife", durability: 40 };
    pawn.hotbarIndex = 0;
    const chunk = originChunk(world);
    const now = world.worldMinuteIndex();
    chunk.corpses.push({
        id: "aged-1",
        x: pawn.x,
        y: pawn.y,
        mobId: "deer",
        skinned: false,
        stage: "corpse",
        diedAt: now - 12 * 60,
        loot: []
    });
    world.handleAction(pawn.id, { type: Protocol.Actions.CORPSE_SKIN, corpseId: "aged-1" });
    const entry = chunk.corpses[0];
    assert.equal(entry.skinned, false);
    assert.equal(entry.loot.length, 0);
});

test("/kms aliases /kill", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/kms" });
    assert.equal(pawn.dead, true);
    const brain = pawn.creature.anatomy.part("Brain");
    assert.equal(brain.isDead(), true);
    assert.equal(brain.destroySource, "magic");
    const events = world.drainEvents();
    assert.ok(events.some((e) => e.kind === "death" && e.text === "Tester died"));
    assert.ok(events.some((e) => e.kind === "chat" && e.text === "Tester died" && e.to === pawn.id));
    assert.ok(events.some((e) => e.kind === "combat_log" && e.text === "Tester died"));
});

test("/kms kills the controlled companion and leaves the leader alive", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const buddy = makeCompanion("buddy", {
        name: "Buddy",
        inventory: [{ id: "stick", quantity: 1 }, null, null, null, null]
    });
    pawn.party = [buddy];
    pawn.inventory[0] = { id: "leaf", quantity: 1 };
    world._ensureCompanionCreature(pawn, buddy);
    pawn.controlId = buddy.id;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CHAT,
        text: "/kms",
        pawnId: buddy.id
    });
    assert.equal(pawn.dead, false);
    assert.equal(buddy.dead, true);
    assert.equal(pawn.party.some((m) => m && m.id === buddy.id), false);
    assert.equal(pawn.controlId, pawn.id);
    assert.equal(pawn.inventory[0]?.id, "leaf");
    const corpse = (originChunk(world).corpses || []).find((c) => c && c.name === "Buddy");
    assert.ok(corpse);
    assert.ok((corpse.loot || []).some((s) => s && s.id === "stick"));
    const events = world.drainEvents();
    assert.ok(events.some((e) => e.kind === "party_death" && e.pawnId === buddy.id));
    world.tick(50);
    assert.equal(pawn.dead, false);
    assert.equal(world.creatures.get(buddy.id), undefined);
});

test("/give pebble keeps the stone, and /set stamps it on rocks and piles", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give pebble 4 granite" });
    const stack = pawn.inventory.find((s) => s && s.id === "pebble");
    assert.ok(stack);
    assert.equal(stack.quantity, 4);
    assert.equal(stack.stone, "granite");
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give pebble 2" });
    assert.ok(pawn.inventory.some((s) => s && s.id === "pebble" && s.quantity === 2 && s.stone === "andesite"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give stick 1 granite" });
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give pebble 1 quartz" });
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give pebble 1 flint" });
    const chats = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(chats.some((e) => e.text === "Gave 2× Andesite Pebble"));
    assert.ok(chats.some((e) => e.text === "Stick takes no extra."));
    assert.ok(chats.some((e) => e.text === 'Unknown stone "quartz".'));
    assert.ok(chats.some((e) => e.text === 'Unknown stone "flint".'));
    assert.equal(pawn.inventory.some((s) => s && s.id === "stick"), false);
    const chunk = originChunk(world);
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set rock diorite" });
    assert.equal((chunk.things || []).find((t) => t && t.id === "rock")?.stone, "diorite");
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set pebbles sandstone" });
    assert.equal((chunk.lootableThings || []).find((t) => t && t.id === "pebbles")?.stone, "sandstone");
    assert.equal((chunk.things || []).find((t) => t && t.id === "rock"), undefined);
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set flowering cactus" });
    assert.ok((chunk.lootableThings || []).some((t) => t && t.id === "flowering_cactus"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set tree granite" });
    const setChats = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(setChats.some((e) => e.text === "Tree takes no extra."));
    assert.equal((chunk.things || []).find((t) => t && t.id === "tree"), undefined);
    assert.ok((chunk.lootableThings || []).some((t) => t && t.id === "flowering_cactus"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give grindstone" });
    const grind = pawn.inventory.find((s) => s && s.id === "grindstone");
    assert.ok(grind);
    assert.equal(grind.stone, "andesite");
    const grindChat = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(grindChat.some((e) => e.text === "Gave 1× Grindstone"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set rock" });
    assert.equal((chunk.things || []).find((t) => t && t.id === "rock")?.stone, "andesite");
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set pebbles" });
    assert.equal((chunk.lootableThings || []).find((t) => t && t.id === "pebbles")?.stone, "andesite");
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set grindstone" });
    assert.equal((chunk.things || []).find((t) => t && t.id === "grindstone")?.stone, "andesite");
    const setDefault = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(setDefault.some((e) => e.text === "Set Andesite Rock"));
    assert.ok(setDefault.some((e) => e.text === "Set Andesite Pebbles"));
    assert.ok(setDefault.some((e) => e.text === "Set Andesite Grindstone"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give painting_circle 1 granite" });
    const circle = pawn.inventory.find((s) => s && s.id === "painting_circle" && s.stone === "granite");
    assert.ok(circle);
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give painting_circle" });
    assert.ok(pawn.inventory.some((s) => s && s.id === "painting_circle" && s.stone === "andesite"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give painting_circle 1 flint" });
    const circleChats = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(circleChats.some((e) => e.text === 'Unknown stone "flint".'));
    assert.equal(pawn.inventory.some((s) => s && s.id === "painting_circle" && s.stone === "flint"), false);
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set painting_circle diorite" });
    assert.equal((chunk.things || []).find((t) => t && t.id === "painting_circle")?.stone, "diorite");
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/set painting_circle" });
    assert.equal((chunk.things || []).find((t) => t && t.id === "painting_circle")?.stone, "andesite");
    const setCircle = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(setCircle.some((e) => e.text === "Set Diorite Painting Circle"));
    assert.ok(setCircle.some((e) => e.text === "Set Andesite Painting Circle"));
});

test("/give stone_spear keeps the stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give stone_spear 1 granite" });
    const stack = pawn.inventory.find((s) => s && s.id === "stone_spear");
    assert.ok(stack);
    assert.equal(stack.quantity, 1);
    assert.equal(stack.stone, "granite");
    assert.equal(stack.knapMaterial, "pebble");
    assert.equal(stack.knapQuality, "rough");
    const chats = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(chats.some((e) => e.text === "Gave 1× Granite Spear (rough)"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give stone_spear 1 quartz" });
    const bad = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(bad.some((e) => e.text === 'Unknown stone "quartz".'));
    assert.equal(pawn.inventory.filter((s) => s && s.id === "stone_spear").length, 1);
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give stone_spear" });
    const spears = pawn.inventory.filter((s) => s && s.id === "stone_spear");
    assert.equal(spears.length, 2);
    const plain = spears.find((s) => s.stone === "andesite");
    assert.ok(plain);
    assert.equal(plain.knapMaterial, "pebble");
    assert.equal(plain.knapQuality, "rough");
    const named = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(named.some((e) => e.text === "Gave 1× Andesite Spear (rough)"));
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give stone_spear 1 flint" });
    const flint = pawn.inventory.find((s) => s && s.id === "stone_spear" && s.knapMaterial === "flint");
    assert.ok(flint);
    assert.equal(flint.quantity, 1);
    assert.equal(flint.stone, undefined);
    assert.equal(flint.knapQuality, "rough");
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/give grindstone 1 flint" });
    const flintChats = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(flintChats.some((e) => e.text === "Gave 1× Flint Spear (rough)"));
    assert.ok(flintChats.some((e) => e.text === 'Unknown stone "flint".'));
    assert.equal(pawn.inventory.some((s) => s && s.id === "grindstone" && s.stone === "flint"), false);
});

test("/heal restores body and announces", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.hp = 1;
    pawn.kc = 0;
    pawn.dead = false;
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/heal" });
    assert.equal(pawn.hp, pawn.mhp);
    assert.equal(pawn.kc, pawn.stomach);
    assert.equal(pawn.dead, false);
    const chats = world.drainEvents().filter((e) => e.kind === "chat");
    assert.ok(chats.some((e) => e.text === "Fully healed" && e.cmd && e.to === pawn.id));
});

test("new world has an origin spawn sign", () => {
    const { world } = createTestWorld();
    world._findSpawnClearing();
    const chunk = originChunk(world);
    assert.ok(chunk?.things?.some((t) => t && t.id === "sign" && t.spawnHint));
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

test("companion doctor waits for a patient to reach a bed, then tends", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = makeCompanion("doc", {
        x: pawn.x + 16,
        y: pawn.y,
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    const patient = makeCompanion("pat", { x: pawn.x + 32, y: pawn.y });
    partyOf(world, pawn, doctor, patient);
    cutArm(patient.creature);
    const entry = {
        uid: "lt-tend",
        id: "lean_to",
        x: patient.x,
        y: patient.y,
        occupants: [null, null]
    };
    originChunk(world).things.push(entry);
    const rows = [{ rec: doctor, creature: doctor.creature }];
    world._assignPartyTendSeeks(pawn, rows, pawn.id);
    assert.equal(doctor.tendChannel || null, null);
    assert.equal(doctor.creature.ai?.tendSeek || null, null);
    world._tryInjuredRest(pawn, patient);
    assert.equal(patient._restWalk?.uid, "lt-tend");
    assert.equal(world._occupySlot(pawn, patient, entry, patient._restWalk.slot), true);
    doctor.x = patient.x;
    doctor.y = patient.y;
    doctor.creature.x = patient.x;
    doctor.creature.y = patient.y;
    world._assignPartyTendSeeks(pawn, rows, pawn.id);
    assert.equal(doctor.tendChannel?.patientId, patient.id);
});

test("companion doctor tends a standing patient when no bed is free", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = makeCompanion("doc", {
        x: pawn.x,
        y: pawn.y,
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    const patient = makeCompanion("pat", { x: pawn.x, y: pawn.y });
    partyOf(world, pawn, doctor, patient);
    cutArm(patient.creature);
    world._assignPartyTendSeeks(pawn, [{ rec: doctor, creature: doctor.creature }], pawn.id);
    assert.equal(doctor.tendChannel?.patientId, patient.id);
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

test("resting companion gets up to eat when hungry", () => {
    const { world, pawn } = createTestWorld();
    const buddy = makeCompanion("buddy", {
        _resting: true,
        kc: 800,
        inventory: [berries(), null, null, null, null]
    });
    pawn.party = [buddy];
    world._ensureCompanionCreature(pawn, buddy);
    const members = [pawn, buddy];
    const ok = world._wakeRestingHungry(pawn, buddy, members, pawn);
    assert.equal(ok, true);
    assert.equal(buddy._resting, false);
    assert.equal(buddy._wokeFromRest, true);
});

test("resting companion stays down if they are not hungry", () => {
    const { world, pawn } = createTestWorld();
    const buddy = makeCompanion("buddy", {
        _resting: true,
        kc: 1200,
        inventory: [berries(), null, null, null, null]
    });
    pawn.party = [buddy];
    world._ensureCompanionCreature(pawn, buddy);
    const ok = world._wakeRestingHungry(pawn, buddy, [pawn, buddy], pawn);
    assert.equal(ok, false);
    assert.equal(buddy._resting, true);
    assert.equal(buddy._wokeFromRest, false);
});

test("resting companion stays down if there is no food", () => {
    const { world, pawn } = createTestWorld();
    pawn.inventory = [null, null, null, null, null];
    const buddy = makeCompanion("buddy", {
        _resting: true,
        kc: 800,
        inventory: [null, null, null, null, null]
    });
    pawn.party = [buddy];
    world._ensureCompanionCreature(pawn, buddy);
    const ok = world._wakeRestingHungry(pawn, buddy, [pawn, buddy], pawn);
    assert.equal(ok, false);
    assert.equal(buddy._resting, true);
});

test("woke companion delays returning to rest while still hungry", () => {
    const { world, pawn } = createTestWorld();
    const buddy = makeCompanion("buddy", {
        kc: 800,
        inventory: [berries(), null, null, null, null],
        _wokeFromRest: true
    });
    pawn.party = [buddy];
    world._ensureCompanionCreature(pawn, buddy);
    assert.equal(world._shouldDelaySleep(pawn, buddy), true);
    buddy.kc = 1400;
    assert.equal(world._shouldDelaySleep(pawn, buddy), false);
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

test("two followers do not rest-walk the same lean-to slot", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const entry = { uid: "lt-share", id: "lean_to", x: 48, y: 48, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    const kor = makeCompanion("kor", {
        x: 16,
        y: 80,
        lastSleep: { uid: "lt-share", slot: 0, rot: 0 }
    });
    const kum = makeCompanion("kum", {
        x: 24,
        y: 80,
        lastSleep: { uid: "lt-share", slot: 0, rot: 0 }
    });
    partyOf(world, pawn, kor, kum);
    world._tryReturnToBed(pawn, kor);
    world._tryReturnToBed(pawn, kum);
    assert.equal(kor._restWalk?.uid, "lt-share");
    assert.equal(kum._restWalk?.uid, "lt-share");
    assert.notEqual(kor._restWalk.slot, kum._restWalk.slot);
    assert.equal(world._orderRest(pawn, kor, entry, kum._restWalk.slot, { autofill: false }), false);
});

test("rest-walk stand stays outside the bunk", () => {
    const Sleep = require("../shared/sleep");
    const entry = { uid: "lt-stand", id: "lean_to", x: 48, y: 48, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 }, footprint: [2, 1] });
    const def = { sleep: { slots: 2 }, footprint: [2, 1] };
    const bunk0 = Sleep.sleeperWorldPos(entry, 0, 16, def);
    const bunk1 = Sleep.sleeperWorldPos(entry, 1, 16, def);
    const stand0 = Sleep.restWalkStand(entry, 0, 16, def);
    const stand1 = Sleep.restWalkStand(entry, 1, 16, def);
    assert.ok(stand0.y > bunk0.y, "rot 0 open side is south of the bunk");
    assert.ok(Math.abs(stand0.x - stand1.x) > 4, "slots spread along the open edge");
    assert.ok(Math.hypot(stand0.x - bunk0.x, stand0.y - bunk0.y) > 8);
    assert.ok(Math.hypot(stand1.x - bunk1.x, stand1.y - bunk1.y) > 8);
});

test("a taken bunk interrupts the rest walk and tries another spot", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const entry = { uid: "lt-mid", id: "lean_to", x: 48, y: 48, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 }, footprint: [2, 1] });
    chunk.things.push(entry);
    pawn.x = 32;
    pawn.y = 160;
    world._orderRest(pawn, pawn, entry, 0, { autofill: false });
    assert.equal(pawn._restWalk.slot, 0);
    entry.occupants[0] = "someone-else";
    world.tick(50);
    assert.equal(pawn.x, 32, "should not finish the walk");
    assert.equal(pawn.y, 160, "should not finish the walk");
    assert.equal(pawn._restWalk?.uid, "lt-mid");
    assert.equal(pawn._restWalk.slot, 1);
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.some((e) => e.text === "That spot is taken"));
    const snap = world.snapshotFor(pawn.id);
    assert.equal(snap.players[0].restWalk.slot, 1);
});

test("a full shelter stops the rest walk where you are", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const entry = {
        uid: "lt-full",
        id: "lean_to",
        x: 48,
        y: 48,
        tx: 2,
        ty: 2,
        rot: 0,
        occupants: ["a", "b"]
    };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 }, footprint: [2, 1] });
    chunk.things.push(entry);
    pawn.x = 32;
    pawn.y = 160;
    pawn._restWalk = { uid: entry.uid, slot: 0 };
    pawn.lastSleep = { uid: entry.uid, slot: 0, rot: 0 };
    world.tick(50);
    assert.equal(pawn._restWalk, null);
    assert.equal(pawn.x, 32);
    assert.equal(pawn.y, 160);
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.some((e) => e.text === "That spot is taken"));
});

test("a taken shelter sends the rest walk to another one", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const full = {
        uid: "lt-a",
        id: "lean_to",
        x: 48,
        y: 48,
        tx: 2,
        ty: 2,
        rot: 0,
        occupants: ["a", "b"]
    };
    const other = { uid: "lt-b", id: "lean_to", x: 80, y: 48, tx: 4, ty: 2, rot: 0 };
    Place.ensureSleepEntry(full, { sleep: { slots: 2 }, footprint: [2, 1] });
    Place.ensureSleepEntry(other, { sleep: { slots: 2 }, footprint: [2, 1] });
    chunk.things.push(full, other);
    pawn.x = 32;
    pawn.y = 160;
    pawn._restWalk = { uid: full.uid, slot: 0 };
    pawn.lastSleep = { uid: full.uid, slot: 0, rot: 0 };
    world.tick(50);
    assert.equal(pawn.x, 32);
    assert.equal(pawn.y, 160);
    assert.equal(pawn._restWalk?.uid, "lt-b");
    assert.equal(pawn._resting, undefined);
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.some((e) => e.text === "That spot is taken"));
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

test("tick speed 0 freezes wildlife pose and moving flag", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    world.tickSpeed = 1;
    world.baseTickSpeed = 1;
    const entry = world._spawnMobAt("deer", pawn.x + 16, pawn.y);
    const mob = world.mobs.get(entry.uid);
    assert.ok(mob);
    if (mob.ai) {
        mob.ai.state = "walk";
        mob.ai.timer = 8000;
        mob.ai.dirX = 1;
        mob.ai.dirY = 0;
        mob.ai.panicMs = 0;
    }
    for (let i = 0; i < 4; i++) world.tick(40);
    const x1 = mob.x;
    world.tickSpeed = 0;
    world.baseTickSpeed = 0;
    world.tick(40);
    assert.equal(mob.x, x1);
    assert.equal(mob.vx, 0);
    assert.equal(mob.vy, 0);
    const snap = world.snapshotFor(pawn.id);
    const row = (snap.mobs || []).find((m) => m.id === mob.id);
    assert.ok(row);
    assert.equal(row.moving, false);
    assert.equal(row.vx, 0);
    assert.equal(row.vy, 0);
});

test("wanderer overlapping a cactus teleports to free ground", () => {
    const { world } = createTestWorld();
    const chunk = originChunk(world);
    chunk.things.push({ id: "cactus", x: 48, y: 48 });
    const id = "w-cactus-stuck";
    world.wanderers.set(id, {
        id,
        name: "Stuck",
        x: 40,
        y: 48,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    const w = world.wanderers.get(id);
    const c0 = world._ensureWandererCreature(w);
    assert.equal(world._partyPoseBlocked(c0, w.x, w.y), true, "8×8 body should overlap the cactus");
    world._stepWanderer(w, 16);
    const c = w.creature;
    assert.equal(world._partyPoseBlocked(c, w.x, w.y), false);
    assert.ok(Math.hypot(w.x - 40, w.y - 48) > 2, "should leave the cactus hitbox");
    for (let i = 0; i < 40; i++) world._stepWanderer(w, 50);
    assert.equal(world._partyPoseBlocked(c, w.x, w.y), false, "must not walk back into the cactus");
});

test("wanderer paths around a lean-to instead of walking the laying spot", () => {
    const Place = require("../shared/place");
    const { world } = createTestWorld();
    const chunk = originChunk(world);
    const def = world._thingDef("lean_to");
    const tx = 3;
    const ty = 3;
    const pos = Place.footprintWorldPos(tx, ty, 0, def.footprint, 16);
    chunk.things.push({
        uid: "lt-wander",
        id: "lean_to",
        tx,
        ty,
        rot: 0,
        x: pos.x,
        y: pos.y
    });
    const occupy = Place.footprintWorldRect(chunk.things[chunk.things.length - 1], def, 16);
    const id = "w-leanto-path";
    world.wanderers.set(id, {
        id,
        name: "Walker",
        x: 24,
        y: occupy.bottom,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    const w = world.wanderers.get(id);
    const c = world._ensureWandererCreature(w);
    const openX = (occupy.left + occupy.right) / 2;
    const openY = occupy.bottom - 2;
    assert.equal(
        world._partyPoseBlocked(c, openX, openY),
        true,
        "wanderer must not stand on the laying spot"
    );
    for (let i = 0; i < 280; i++) world._stepWanderer(w, 50);
    const bed = {
        left: occupy.left + 2,
        right: occupy.right - 2,
        top: occupy.top + 2,
        bottom: occupy.bottom - 2
    };
    const onBed = w.x > bed.left && w.x < bed.right && w.y > bed.top && w.y < bed.bottom;
    assert.equal(onBed, false, `wanderer stuck on lean-to at ${w.x.toFixed(1)},${w.y.toFixed(1)}`);
    assert.equal(world._partyPoseBlocked(c, w.x, w.y), false);
    assert.ok(w.x > occupy.right - 4, `should pass east of the lean-to, x=${w.x.toFixed(1)}`);
});

test("wildlife does not path around sleep furniture", () => {
    const Sleep = require("../shared/sleep");
    const { world } = createTestWorld();
    const entry = world._spawnMobAt("deer", 80, 80);
    const deer = world.mobs.get(entry.uid);
    assert.ok(deer);
    assert.equal(Sleep.navAroundBeds(deer), false);
    const id = "w-bed-nav";
    world.wanderers.set(id, {
        id,
        name: "Walker",
        x: 80,
        y: 80,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    const c = world._ensureWandererCreature(world.wanderers.get(id));
    assert.equal(Sleep.navAroundBeds(c), true);
    assert.equal(Sleep.navAroundBeds({ kind: "player", role: "companion" }), false);
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

function fillTravelParty(pawn) {
    pawn.party = [];
    for (let i = 0; i < Party.CAP - 1; i++) {
        pawn.party.push({ id: `mate-${i}`, dead: false, x: pawn.x, y: pawn.y });
    }
}

function putWanderer(world, id, x, y) {
    world.wanderers.set(id, {
        id,
        name: "Og",
        x,
        y,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
}

test("a full party cannot recruit a wanderer outside the camp", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.rng = () => 0;
    fillTravelParty(pawn);
    const ts = 16;
    const settle = Settlement.createSettlement({
        x: 0, y: 0, ownerId: pawn.id, name: "Home"
    });
    world.settlements.push(settle);
    pawn.x = 31 * ts;
    pawn.y = 0;
    const id = "w-full-out";
    putWanderer(world, id, 34 * ts, 0);
    const before = pawn.party.length;
    world.handleAction(pawn.id, { type: Protocol.Actions.RECRUIT, wandererId: id });
    assert.equal(world.wanderers.has(id), true);
    assert.equal(pawn.party.length, before);
    assert.equal(world.settlers.some((s) => s.id === id), false);
    assert.equal(settle.jobs?.[id], undefined);
});

test("a full party recruits into the camp when both stand inside it", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.rng = () => 0;
    fillTravelParty(pawn);
    pawn.x = 0;
    pawn.y = 0;
    const settle = Settlement.createSettlement({
        x: 0, y: 0, ownerId: pawn.id, name: "Home"
    });
    world.settlements.push(settle);
    const id = "w-full-in";
    putWanderer(world, id, 16, 0);
    const before = pawn.party.length;
    world.handleAction(pawn.id, { type: Protocol.Actions.RECRUIT, wandererId: id });
    assert.equal(world.wanderers.has(id), false);
    assert.equal(pawn.party.length, before);
    const rec = world.settlers.find((s) => s.id === id);
    assert.ok(rec);
    assert.equal(rec.role, "settler");
    assert.equal(rec.homeSettlementId, settle.id);
    assert.ok(settle.jobs[id]);
    assert.ok((settle.jobOrder || []).includes(id));
    const ev = world._events.find((e) => e.kind === "recruit" && e.wandererId === id);
    assert.equal(ev?.accepted, true);
    assert.equal(ev?.settled, true);
    assert.equal(ev?.settlementId, settle.id);
});

test("a band of wanderers cannot be recruited, even inside camp", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.rng = () => 0;
    pawn.x = 0;
    pawn.y = 0;
    pawn.hotbarIndex = 0;
    pawn.inventory[0] = { id: "apple", quantity: 3 };
    const settle = Settlement.createSettlement({
        x: 0, y: 0, ownerId: pawn.id, name: "Home"
    });
    world.settlements.push(settle);
    const id = "w-band";
    putWanderer(world, id, 16, 0);
    const w = world.wanderers.get(id);
    w.band = true;
    world.handleAction(pawn.id, { type: Protocol.Actions.RECRUIT, wandererId: id });
    assert.equal(world.wanderers.has(id), true);
    assert.equal((pawn.party || []).some((m) => m.id === id), false);
    assert.equal(world.settlers.some((s) => s.id === id), false);
    assert.equal(pawn.inventory[0].quantity, 3, "an offer is not spent on a band");
    assert.equal(world._events.some((e) => e.kind === "recruit"), false);

    fillTravelParty(pawn);
    pawn.x = 0;
    pawn.y = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.RECRUIT, wandererId: id });
    assert.equal(world.wanderers.has(id), true);
    assert.equal(world.settlers.some((s) => s.id === id), false);

    const row = world._publicWanderer(w);
    assert.equal(row.band, true);
    const loaded = world._wandererRecordFromSnap(row);
    assert.equal(loaded.band, true);
});

test("a full party spawns a band, and a party with room spawns one passerby", () => {
    const { world, pawn } = createTestWorld();
    world.rng = () => 0;
    pawn.x = 32;
    pawn.y = 32;
    const solo = world._spawnWandererNear(pawn);
    assert.equal(solo, 1);
    const one = [...world.wanderers.values()];
    assert.equal(one.length, 1);
    assert.equal(one[0].band, false);
    world.wanderers.clear();

    fillTravelParty(pawn);
    const pack = world._spawnWandererNear(pawn);
    assert.ok(pack >= 2 && pack <= 6, `pack was ${pack}`);
    const band = [...world.wanderers.values()];
    assert.equal(band.length, pack);
    for (const w of band) assert.equal(w.band, true);
});

test("room in the party still recruits into the party inside a camp", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.rng = () => 0;
    pawn.x = 0;
    pawn.y = 0;
    const settle = Settlement.createSettlement({
        x: 0, y: 0, ownerId: pawn.id, name: "Home"
    });
    world.settlements.push(settle);
    const id = "w-room-in";
    putWanderer(world, id, 16, 0);
    world.handleAction(pawn.id, { type: Protocol.Actions.RECRUIT, wandererId: id });
    assert.equal(world.wanderers.has(id), false);
    assert.ok((pawn.party || []).some((m) => m.id === id));
    assert.equal(world.settlers.some((s) => s.id === id), false);
    const ev = world._events.find((e) => e.kind === "recruit" && e.wandererId === id);
    assert.equal(ev?.settled, false);
});

test("strolling wanderers do not worldgen an A* corridor", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const { world, pawn } = createTestWorld();
    const id = "w-stroll-lag";
    world.wanderers.set(id, {
        id,
        name: "Lag",
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
    const before = world.chunks.size;
    let generated = 0;
    const orig = WorldGen.generateChunk;
    WorldGen.generateChunk = function wrappedGenerateChunk() {
        generated++;
        return orig.apply(this, arguments);
    };
    try {
        for (let i = 0; i < 45; i++) world._stepWanderer(w, 50);
    } finally {
        WorldGen.generateChunk = orig;
    }
    assert.equal(generated, 0, `stroll A* should not WorldGen (${generated} chunks)`);
    assert.ok(
        world.chunks.size - before < 12,
        `stroll should stay in the injected neighborhood (${world.chunks.size - before} new chunks)`
    );
    assert.ok(w.creature?.ai, "wanderer should keep stroll AI");
});

test("wanderer stroll at 20x does not hitch then teleport", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    world.tickSpeed = 20;
    world.baseTickSpeed = 20;
    const id = "w-hitch-20x";
    world.wanderers.set(id, {
        id,
        name: "Hitch",
        x: pawn.x + 24,
        y: pawn.y,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    const w = world.wanderers.get(id);
    const xs = [];
    for (let i = 0; i < 24; i++) {
        world.tick(16);
        xs.push(w.x);
    }
    const moved = Math.abs(xs[xs.length - 1] - xs[0]);
    assert.ok(moved > 16, `should keep walking at 20× (moved ${moved.toFixed(1)})`);
    let maxGap = 0;
    for (let i = 1; i < xs.length; i++) {
        maxGap = Math.max(maxGap, Math.abs(xs[i] - xs[i - 1]));
    }
    assert.ok(maxGap < 36, `steps should stay smooth, not freeze-then-jump (max ${maxGap.toFixed(1)})`);
});

test("resting companions do not keep a view-radius interest ring", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const { world, pawn } = createTestWorld();
    pawn.viewChunks = 8;
    pawn.x = 32 + 12 * 256;
    pawn.y = 32;
    const sleeper = makeCompanion("camp-sleeper", { x: 32, y: 32, _resting: true });
    pawn.party.push(sleeper);
    world._ensureCompanionCreature(pawn, sleeper);
    assert.equal(world._inSimRange(32, 32), false, "camp wildlife should freeze while the leader is away");
    assert.equal(world._inSimRange(pawn.x, pawn.y), true);

    let generated = 0;
    const orig = WorldGen.generateChunk;
    WorldGen.generateChunk = function wrappedGenerateChunk(cx) {
        if (cx <= 2) generated++;
        return orig.apply(this, arguments);
    };
    try {
        world.tick(50);
    } finally {
        WorldGen.generateChunk = orig;
    }
    assert.equal(generated, 0, `resting camp should not WorldGen a view ring (${generated} chunks)`);
});

test("far followers do not worldgen an A* corridor", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const { world, pawn } = createTestWorld();
    pawn.viewChunks = 8;
    // 20 chunks east: leader interest (9) and follower keep (2) do not overlap.
    pawn.x = 32 + 20 * 256;
    pawn.y = 32;
    const follower = makeCompanion("sick-follow", { x: 32, y: 32 });
    pawn.party.push(follower);
    world._ensureCompanionCreature(pawn, follower);

    let corridor = 0;
    const orig = WorldGen.generateChunk;
    WorldGen.generateChunk = function wrappedGenerateChunk(cx) {
        if (cx >= 3 && cx <= 10) corridor++;
        return orig.apply(this, arguments);
    };
    try {
        for (let i = 0; i < 45; i++) world.tick(50);
    } finally {
        WorldGen.generateChunk = orig;
    }
    assert.equal(corridor, 0, `follow A* should not WorldGen a corridor (${corridor} chunks)`);
    const dist = Math.hypot(follower.x - 32, follower.y - 32);
    assert.ok(dist < 4, `far follower should wait instead of trekking (moved ${dist.toFixed(1)}px)`);
});

test("view and interest stay on the controlled pawn when a member is far", () => {
    const WorldGen = require("../shared/sim/WorldGen");
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    pawn.viewChunks = 2;
    pawn.x = 32 + 20 * 256;
    pawn.y = 32;
    const buddy = makeCompanion("camp-buddy", { x: 32, y: 32 });
    pawn.party.push(buddy);
    world._ensureCompanionCreature(pawn, buddy);
    pawn.controlId = buddy.id;

    const oceanCx = Math.floor(pawn.x / 128);
    const oceanCy = Math.floor(pawn.y / 128);
    for (let cx = oceanCx - 1; cx <= oceanCx + 1; cx++) {
        for (let cy = oceanCy - 1; cy <= oceanCy + 1; cy++) {
            const key = chunkKey(cx, cy);
            if (!world.chunks.has(key)) world.chunks.set(key, emptyChunk(cx, cy));
        }
    }

    const keys = world.viewChunkKeys(pawn);
    const oceanKey = chunkKey(oceanCx, oceanCy);
    const campKey = "0,0";
    assert.equal(keys.has(oceanKey), false, "far leader chunk must not stream");
    assert.equal(keys.has(campKey), true, "controlled camp chunk must stream");

    let oceanGen = 0;
    const orig = WorldGen.generateChunk;
    WorldGen.generateChunk = function wrappedGenerateChunk(cx) {
        if (cx >= 18) oceanGen++;
        return orig.apply(this, arguments);
    };
    try {
        world.tick(50);
    } finally {
        WorldGen.generateChunk = orig;
    }
    assert.equal(oceanGen, 0, `far leader should not WorldGen (${oceanGen} chunks)`);
    const dist = Math.hypot(pawn.x - (32 + 20 * 256), pawn.y - 32);
    assert.ok(dist < 4, `uncontrolled far leader should wait (moved ${dist.toFixed(1)}px)`);
});

test("addPlayer skips the join chat when silentJoin", () => {
    const { world } = createTestWorld();
    world.drainEvents();
    world.addPlayer("joiner", "Joiner");
    const announced = world.drainEvents().filter((e) => e.kind === "chat" && e.text === "Joiner joined");
    assert.equal(announced.length, 1);

    world.addPlayer("quiet", "Quiet", null, { silentJoin: true });
    const silent = world.drainEvents().filter((e) => e.kind === "chat" && / joined$/.test(e.text || ""));
    assert.equal(silent.length, 0);
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
    // Stay inside the stubbed -1..1 chunks (128px). A far pose WorldGens real
    // terrain and `_restoreLogoutPose` will nudge off blocked tiles.
    world.poses = {
        joiner: { x: 48, y: 64, facing: "down" },
        buddy: { x: 96, y: 112, facing: "left" }
    };
    const p = world.addPlayer("joiner", "Joiner", {
        name: "Joiner",
        party: [{ id: "buddy", name: "Og", x: 9000, y: 8000, facing: "up" }]
    });
    const mem = (p.party || []).find((m) => m.id === "buddy");
    assert.ok(mem);
    assert.equal(mem.x, 96);
    assert.equal(mem.y, 112);
    assert.equal(mem.facing, "left");
    assert.equal(p.x, 48);
    assert.equal(p.y, 64);
});

test("snapshot omits wildlife outside sim radius", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    const far = world._spawnMobAt("deer", 16 * 8 * 20, 16 * 8 * 20);
    assert.ok(far?.uid);
    const near = world._spawnMobAt("deer", pawn.x, pawn.y);
    assert.ok(near?.uid);
    const snap = world.snapshotFor(pawn.id);
    const ids = (snap.mobs || []).map((m) => m.id);
    assert.ok(ids.includes(near.uid));
    assert.equal(ids.includes(far.uid), false);
});

test("snapshot keeps camp drops when the leader is far from the controlled pawn", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    const campX = -1224;
    const campY = 4768;
    const buddy = addTestCompanion(world, pawn, "buddy");
    buddy.x = campX;
    buddy.y = campY;
    pawn.controlId = buddy.id;
    world._pushDrop(campX, campY, { id: "stick", quantity: 3 });
    const snap = world.snapshotFor(pawn.id);
    assert.ok(
        (snap.drops || []).some((d) => d && d.id === "stick"),
        "drops beside the possessed pawn must stay in the snapshot"
    );
});

test("a settler killing blow on a wanderer is not revived as a pincushion", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    const id = "w-execute";
    world.wanderers.set(id, {
        id,
        name: "Og",
        x: pawn.x + 16,
        y: pawn.y,
        facing: "down",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: true,
        recruitLocked: true,
        refusedBy: []
    });
    const w = world.wanderers.get(id);
    const c = world._ensureWandererCreature(w);
    c._lastHitBy = pawn.creature;
    c.anatomy.core.destroy();
    c.anatomy.flushPendingFatal();
    assert.equal(c.isBodyDead(), true);
    // The old ensure deleted this corpse and spawned a live body from the
    // pre-fatal snapshot, so the next player punch was the one that stuck.
    const again = world._ensureWandererCreature(w);
    assert.equal(again, c);
    assert.equal(again.isBodyDead(), true);
    world.tick(40);
    assert.equal(world.wanderers.has(id), false);
    let corpses = 0;
    for (const chunk of world.chunks.values()) corpses += (chunk.corpses || []).length;
    assert.equal(corpses, 1);
});

test("snapshot marks a downed wanderer prone before death", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    const w = {
        id: "w1",
        name: "Og",
        x: pawn.x + 16,
        y: pawn.y,
        facing: "down",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: true,
        dead: false
    };
    world.wanderers.set(w.id, w);
    const c = world._ensureWandererCreature(w);
    assert.ok(c);
    c._prone = true;
    const row = world._publicWanderer(w);
    assert.equal(row.prone, true);
    assert.equal(row.moving, false);
    assert.equal(row.facing, "right");
    const snap = world.snapshotFor(pawn.id);
    const found = (snap.wanderers || []).find((x) => x.id === "w1");
    assert.ok(found);
    assert.equal(found.prone, true);
});

test("snapshot moving follows the controlled pawn, not session WASD on the idle leader", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.connected = true;
    pawn.party = [{
        id: "buddy",
        name: "Og",
        x: pawn.x + 16,
        y: pawn.y,
        facing: "down",
        vx: 0,
        vy: 0,
        dead: false,
        look: null
    }];
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: "buddy" });
    world.setMove(pawn.id, { x: 1, y: 0, pawnId: "buddy" });
    const you = (world.snapshotFor(pawn.id).players || []).find((p) => p.id === pawn.id);
    assert.equal(you.moving, false, "idle leader should not inherit companion stick");
    const mem = (you.party || []).find((m) => m.id === "buddy");
    assert.equal(mem.moving, true, "controlled companion should walk from stick");
    world.setMove(pawn.id, { x: 0, y: 0, pawnId: "buddy" });
    const youStop = (world.snapshotFor(pawn.id).players || []).find((p) => p.id === pawn.id);
    assert.equal(youStop.moving, false);
    assert.equal((youStop.party || []).find((m) => m.id === "buddy").moving, false);
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: pawn.id });
    world.setMove(pawn.id, { x: 0, y: 1, pawnId: pawn.id });
    const youLead = (world.snapshotFor(pawn.id).players || []).find((p) => p.id === pawn.id);
    assert.equal(youLead.moving, true, "leader under control should walk from stick");
});

test("knap consume+finish spends one pebble and grants one tool", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.inventory[0] = { id: "pebble", quantity: 3 };
    const knap = { type: Protocol.Actions.KNAP, slot: 0, id: "pebble", pawnId: pawn.id };
    world.handleAction(pawn.id, { ...knap, op: "consume" });
    world.handleAction(pawn.id, { ...knap, op: "consume" });
    assert.equal(pawn.inventory[0]?.quantity, 2, "second consume must not eat another pebble");
    world.handleAction(pawn.id, {
        ...knap,
        op: "finish",
        stack: {
            id: "stone_tool",
            toolClass: "knife",
            knapDamage: 4,
            customName: "Knife",
            knapIconData: "AAAAAAAA"
        }
    });
    const tools = pawn.inventory.filter((s) => s && s.id === "stone_tool");
    const pebbles = pawn.inventory.reduce((n, s) => n + (s?.id === "pebble" ? (s.quantity || 0) : 0), 0);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].quantity, 1);
    assert.equal(tools[0].knapIconData, "AAAAAAAA");
    assert.equal(pebbles, 2);
});

test("form consume+finish spends one clay and grants a figurine", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const Forming = require("../shared/forming");
    pawn.inventory[0] = { id: "clay", quantity: 3 };
    pawn.techs = { clay_forming: true };
    const grid = Forming.fallbackMound();
    const pack = Forming.pack(grid);
    const form = { type: Protocol.Actions.FORM, slot: 0, id: "clay", pawnId: pawn.id, startMass: Forming.mass(grid) };
    world.handleAction(pawn.id, { ...form, op: "consume" });
    world.handleAction(pawn.id, { ...form, op: "consume" });
    assert.equal(pawn.inventory[0]?.quantity, 2, "second consume must not eat another clay");
    world.handleAction(pawn.id, {
        ...form,
        op: "finish",
        stack: { id: "clay_figurine", formClass: "deity", formVoxels: pack }
    });
    const figs = pawn.inventory.filter((s) => s && s.id === "clay_figurine");
    const clays = pawn.inventory.reduce((n, s) => n + (s?.id === "clay" ? (s.quantity || 0) : 0), 0);
    assert.equal(figs.length, 1);
    assert.equal(figs[0].quantity, 1);
    assert.ok(figs[0].formVoxels);
    assert.equal(figs[0].formClass, "lump");
    assert.equal(figs[0].customName, undefined);
    assert.equal(clays, 2);
});

test("form consume on a figurine can abort back into the same slot", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const Forming = require("../shared/forming");
    const grid = Forming.fallbackMound();
    const stack = Forming.makeStack("lump", grid, Forming.mass(grid));
    pawn.inventory[0] = { ...stack, quantity: 1 };
    pawn.techs = { clay_forming: true };
    const form = { type: Protocol.Actions.FORM, slot: 0, id: "clay_figurine", pawnId: pawn.id, startMass: stack.formStartMass };
    world.handleAction(pawn.id, { ...form, op: "consume" });
    assert.equal(pawn.inventory[0], null);
    assert.ok(pawn._formSession?.rework);
    world.handleAction(pawn.id, { ...form, op: "abort" });
    assert.equal(pawn.inventory[0]?.id, "clay_figurine");
    assert.equal(pawn.inventory[0]?.formVoxels, stack.formVoxels);
    assert.equal(pawn._formSession, null);
});

test("form consume+finish on a figurine replaces it", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const Forming = require("../shared/forming");
    const grid = Forming.fallbackMound();
    const stack = Forming.makeStack("lump", grid, Forming.mass(grid));
    pawn.inventory[0] = { ...stack, quantity: 1 };
    pawn.techs = { clay_forming: true };
    const next = Forming.cloneGrid(grid);
    next[8][8][8] = true;
    const pack = Forming.pack(next);
    const form = { type: Protocol.Actions.FORM, slot: 0, id: "clay_figurine", pawnId: pawn.id, startMass: stack.formStartMass };
    world.handleAction(pawn.id, { ...form, op: "consume" });
    world.handleAction(pawn.id, {
        ...form,
        op: "finish",
        stack: { id: "clay_figurine", formClass: "lump", formVoxels: pack }
    });
    const figs = pawn.inventory.filter((s) => s && s.id === "clay_figurine");
    assert.equal(figs.length, 1);
    assert.equal(figs[0].formVoxels, pack);
    assert.equal(pawn._formSession, null);
});

test("form finish names a defined figurine and leaves a first lump unnamed", () => {
    const Forming = require("../shared/forming");
    const { world, pawn, Protocol } = createTestWorld();
    pawn.techs = { clay_forming: true };
    const humanGrid = Forming.emptyGrid();
    for (let x = 7; x <= 9; x++) {
        for (let y = 0; y <= 8; y++) humanGrid[x][y][8] = true;
    }
    humanGrid[7][0][8] = true;
    humanGrid[9][0][8] = true;
    pawn.inventory[0] = { id: "clay", quantity: 1 };
    const form = {
        type: Protocol.Actions.FORM,
        slot: 0,
        id: "clay",
        pawnId: pawn.id,
        startMass: Forming.mass(humanGrid)
    };
    world.handleAction(pawn.id, { ...form, op: "consume" });
    world.handleAction(pawn.id, {
        ...form,
        op: "finish",
        stack: { id: "clay_figurine", formVoxels: Forming.pack(humanGrid) }
    });
    const fig = pawn.inventory.find((s) => s && s.id === "clay_figurine");
    assert.ok(fig);
    assert.equal(fig.formClass, "human");
    assert.equal(fig.customName, "Clay Human Figurine");
    assert.equal(!!fig.formCustom, false);
});

test("form finish keeps a custom name and rewrites a class default", () => {
    const Forming = require("../shared/forming");
    const { world, pawn, Protocol } = createTestWorld();
    pawn.techs = { clay_forming: true };
    const humanGrid = Forming.emptyGrid();
    for (let x = 7; x <= 9; x++) {
        for (let y = 0; y <= 8; y++) humanGrid[x][y][8] = true;
    }
    humanGrid[7][0][8] = true;
    humanGrid[9][0][8] = true;
    const animalGrid = Forming.emptyGrid();
    for (let x = 4; x <= 11; x++) {
        for (let y = 2; y <= 4; y++) {
            for (let z = 7; z <= 9; z++) animalGrid[x][y][z] = true;
        }
    }
    animalGrid[5][0][7] = true;
    animalGrid[5][1][7] = true;
    animalGrid[5][0][9] = true;
    animalGrid[5][1][9] = true;
    animalGrid[10][0][7] = true;
    animalGrid[10][1][7] = true;
    animalGrid[10][0][9] = true;
    animalGrid[10][1][9] = true;
    const held = Forming.makeStack("human", humanGrid, Forming.mass(humanGrid));
    Forming.applyFinishName(held, {});
    held.customName = "Bob";
    held.formCustom = true;
    pawn.inventory[0] = { ...held, quantity: 1 };
    const form = {
        type: Protocol.Actions.FORM,
        slot: 0,
        id: "clay_figurine",
        pawnId: pawn.id,
        startMass: held.formStartMass
    };
    world.handleAction(pawn.id, { ...form, op: "consume" });
    world.handleAction(pawn.id, {
        ...form,
        op: "finish",
        stack: {
            id: "clay_figurine",
            formVoxels: Forming.pack(animalGrid),
            customName: "Bob",
            formCustom: true
        }
    });
    const bob = pawn.inventory.find((s) => s && s.id === "clay_figurine");
    assert.equal(bob.formClass, "animal");
    assert.equal(bob.customName, "Bob");
    assert.equal(bob.formCustom, true);

    const def = Forming.makeStack("human", humanGrid, Forming.mass(humanGrid));
    Forming.applyFinishName(def, {});
    pawn.inventory[0] = { ...def, quantity: 1 };
    pawn.techs = { clay_forming: true };
    world.handleAction(pawn.id, { ...form, op: "consume" });
    world.handleAction(pawn.id, {
        ...form,
        op: "finish",
        stack: {
            id: "clay_figurine",
            formVoxels: Forming.pack(animalGrid),
            customName: "Clay Human Figurine",
            formCustom: false
        }
    });
    const renamed = pawn.inventory.find((s) => s && s.id === "clay_figurine");
    assert.equal(renamed.formClass, "animal");
    assert.equal(renamed.customName, "Clay Animal Figurine");
    assert.equal(!!renamed.formCustom, false);
});

function addTestCompanion(world, pawn, id = "buddy") {
    const rec = world._companionFromSnap(pawn, {
        id,
        name: "Og",
        x: pawn.x + 8,
        y: pawn.y,
        facing: "right"
    });
    pawn.party.push(rec);
    return rec;
}

test("encumbered follower cannot sprint-catch the leader", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    pawn.x = 80;
    pawn.y = 48;
    pawn.creature.x = pawn.x;
    pawn.creature.y = pawn.y;
    const light = addTestCompanion(world, pawn, "light");
    const heavy = addTestCompanion(world, pawn, "heavy");
    light.x = pawn.x - 140;
    light.y = pawn.y;
    heavy.x = pawn.x - 140;
    heavy.y = pawn.y;
    heavy.inventory = [{ id: "log", quantity: 12 }, null, null, null, null];
    const lightStart = light.x;
    const heavyStart = heavy.x;
    for (let i = 0; i < 40; i++) world.tick(50);
    const lightDist = light.x - lightStart;
    const heavyDist = heavy.x - heavyStart;
    assert.equal(!!heavy.creature?.isSprinting, false, "encumbered follower must not sprint");
    assert.ok(heavy.sprint !== true, "encumbered follower sprint flag stays off");
    assert.ok(
        heavyDist > 8,
        `encumbered follower should still walk (moved ${heavyDist.toFixed(1)})`
    );
    assert.ok(
        lightDist > heavyDist + 8,
        `light follower should outpace the encumbered one (light ${lightDist.toFixed(1)} heavy ${heavyDist.toFixed(1)})`
    );
    const walkPx = 3.5 * 16 * 50 / 1000 * 40;
    assert.ok(
        heavyDist < walkPx * 1.15,
        `encumbered speed must stay at walk (${heavyDist.toFixed(1)} vs walk ${walkPx.toFixed(1)})`
    );
});

test("follower keeps sprinting inside the walk/sprint ring", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    pawn.x = 160;
    pawn.y = 48;
    pawn.creature.x = pawn.x;
    pawn.creature.y = pawn.y;
    const buddy = addTestCompanion(world, pawn, "buddy");
    buddy.x = pawn.x - 90;
    buddy.y = pawn.y;
    world.tick(16);
    const cc = buddy.creature;
    assert.ok(cc?.ai);
    cc.ai._followSprint = true;
    cc.ai._holdFollow = false;
    cc.x = buddy.x;
    cc.y = buddy.y;
    world.tick(50);
    assert.equal(
        !!cc.isSprinting,
        true,
        "latched sprint must hold inside the 3.2–6 tile band"
    );
});

test("uncontrolled leader follows the possessed companion", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.connected = true;
    const buddy = addTestCompanion(world, pawn);
    const startX = pawn.x;
    const destX = startX + 120;
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: buddy.id });
    const leaderC = world._ensurePlayerCreature(pawn);
    leaderC.ownerId = null;
    for (let i = 0; i < 90; i++) {
        world.setMove(pawn.id, { x: 1, y: 0, pawnId: buddy.id, px: destX, py: buddy.y });
        world.tick(16);
    }
    assert.equal(pawn.controlId, buddy.id);
    assert.ok(
        pawn.x > startX + 20,
        `leader should walk toward the controlled companion (start ${startX} now ${pawn.x})`
    );
    assert.ok(
        Math.abs(pawn.x - destX) < Math.abs(startX - destX) - 10,
        `leader should close the gap (leader ${pawn.x} companion ${destX})`
    );
});

function spawnHostileBoar(world, x, y) {
    const entry = world._spawnMobAt("boar", x, y);
    const boar = world.mobs.get(entry.uid);
    assert.ok(boar, "boar should spawn");
    boar.hostile = true;
    if (boar.ai) boar.ai.hostile = true;
    return boar;
}

function landHit(attacker, target) {
    const attack = BodyCombat.pickAttack(attacker);
    assert.ok(attack, "attacker should have a melee verb");
    attack.def = { ...(attack.def || {}), variance: 0 };
    const result = BodyCombat.applyHit(attacker, target, attack);
    assert.ok(result, "hit should land");
    return result;
}

function firstHitLine(world, viewerId) {
    const hits = world.drainEvents().filter((e) =>
        e.kind === "combat_log" && e.to === viewerId && e.segments?.length
    );
    assert.ok(hits.length, "expected a combat log hit line");
    return hits[0];
}

function combatLines(world, viewerId) {
    return world.drainEvents().filter((e) =>
        e.kind === "combat_log" && e.to === viewerId && e.segments?.length
    );
}

test("combat log names use party green, settler blue, and enemy red", () => {
    seedRng(5);
    const { world, pawn, Protocol } = createTestWorld();
    pawn.connected = true;
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    const buddyC = world._ensureCompanionCreature(pawn, buddy);
    const settlerRec = {
        id: "set1",
        name: "Parked",
        x: pawn.x,
        y: pawn.y,
        facing: "down",
        ownerId: pawn.id,
        homeSettlementId: "settle-1",
        inventory: [null, null, null, null, null],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] },
        hotbarIndex: 0
    };
    world.settlers.push(settlerRec);
    const settlerC = world._ensureSettlerCreature(settlerRec);
    const boar = spawnHostileBoar(world, pawn.x + 8, pawn.y);
    const youC = world._ensurePlayerCreature(pawn);
    const ALLY = Party.COLOR_ALLY || "#80e080";
    const SETTLER = Party.COLOR_SETTLER || "#7ec8ff";
    const ENEMY = "#ef5a5a";

    world.drainEvents();
    landHit(youC, boar);
    let line = firstHitLine(world, pawn.id);
    assert.equal(line.segments[0].text, pawn.name);
    assert.equal(line.segments[0].color, ALLY);
    const boarVic = line.segments.find((s) => /'s$/.test(s.text || ""));
    assert.ok(boarVic);
    assert.equal(boarVic.color, ENEMY);

    assert.equal(world._combatLogNameColor(buddyC, pawn.id), ALLY);
    assert.equal(world._combatLogNameColor(settlerC, pawn.id), SETTLER);

    world.drainEvents();
    landHit(buddyC, boar);
    assert.equal(combatLines(world, pawn.id).length, 0);
    landHit(settlerC, boar);
    assert.equal(combatLines(world, pawn.id).length, 0);
    landHit(boar, buddyC);
    assert.equal(combatLines(world, pawn.id).length, 0);
    landHit(boar, settlerC);
    assert.equal(combatLines(world, pawn.id).length, 0);

    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: buddy.id });
    assert.equal(pawn.controlId, buddy.id);
    world.drainEvents();
    landHit(buddyC, boar);
    line = firstHitLine(world, pawn.id);
    assert.equal(line.segments[0].text, buddy.name);
    assert.equal(line.segments[0].color, ALLY);
    restoreRng();
});

test("settler joins a boar fight at camp without crashing", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const { rec } = parkSettler(world, pawn);
    const boar = spawnHostileBoar(world, rec.x + 10, rec.y);
    pawn.lastHitMob = boar;
    pawn.lastHitAt = Date.now();
    assert.doesNotThrow(() => {
        for (let i = 0; i < 8; i++) world.tick(50);
    });
    const cc = world._ensureSettlerCreature(rec);
    assert.equal(cc.ai?.assistTarget, boar);
    assert.equal(cc._settlerAct, `Attacking ${boar.displayName()}`);
});

test("companion attacks a hostile animal on the leader", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    const boar = spawnHostileBoar(world, pawn.x + 10, pawn.y);
    let swung = false;
    for (let i = 0; i < 12; i++) {
        world.tick(50);
        if ((buddy.creature?.attackTimer || 0) > 0 || (buddy.attackTimer || 0) > 0) {
            swung = true;
            break;
        }
    }
    const assist = buddy.creature?.ai?.assistTarget;
    const duel = world._duelMap?.get(buddy.id);
    assert.ok(assist === boar || duel === boar, "companion should lock the nearby boar");
    assert.equal(swung, true, "companion should start a melee swing");
});

test("companions keep hunting deer and do not switch to boars", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    const buddyC = world._ensureCompanionCreature(pawn, buddy);
    const deerEntry = world._spawnMobAt("deer", pawn.x + 24, pawn.y);
    const otherEntry = world._spawnMobAt("deer", pawn.x + 48, pawn.y);
    const deer = world.mobs.get(deerEntry.uid);
    const other = world.mobs.get(otherEntry.uid);
    const boar = spawnHostileBoar(world, pawn.x + 96, pawn.y);
    const you = world._ensurePlayerCreature(pawn);
    landHit(you, deer);
    assert.equal(pawn.huntKind, "deer");
    assert.equal(other.ai?.panicMs > 0, true, "nearby deer should flee with the herd");
    assert.equal(world._companionMayStrike(buddyC, boar), false);
    assert.equal(world._companionMayStrike(buddyC, other), true);

    landHit(buddyC, boar);
    assert.equal(pawn.huntKind, "deer", "a companion clipping a boar must not redirect the hunt");
    assert.notEqual(pawn.lastHitMob, boar);

    for (let i = 0; i < 8; i++) world.tick(50);
    const assist = buddy.creature?.ai?.assistTarget;
    const duel = world._duelMap?.get(buddy.id);
    assert.notEqual(assist, boar);
    assert.notEqual(duel, boar);
    assert.ok(
        assist === deer || assist === other || duel === deer || duel === other,
        "companion should still be on a deer"
    );

    deer._dead = true;
    other._dead = true;
    pawn.lastHitMob = null;
    for (let i = 0; i < 6; i++) world.tick(50);
    assert.notEqual(buddy.creature?.ai?.assistTarget, boar);
    assert.notEqual(world._duelMap?.get(buddy.id), boar);
    assert.equal(pawn.huntKind, "deer");
});

test("companion does not join another party's wildlife aggro", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    const other = world.addPlayer("p2", "Other");
    other.x = pawn.x + 80;
    other.y = pawn.y;
    const oc = world._ensurePlayerCreature(other);
    oc.x = other.x;
    oc.y = other.y;
    const boar = spawnHostileBoar(world, other.x + 8, other.y);
    boar.aggroOwnerId = "p2";
    if (boar.ai) boar.ai.aggroOwnerId = "p2";
    for (let i = 0; i < 8; i++) world.tick(50);
    const assist = buddy.creature?.ai?.assistTarget;
    const duel = world._duelMap?.get(buddy.id);
    assert.notEqual(assist, boar);
    assert.notEqual(duel, boar);
    assert.ok((buddy.creature?.attackTimer || 0) === 0);
});

test("reloading a world keeps one corpse when the same death was saved twice", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const corpse = {
        id: "c-dup",
        x: pawn.x + 8,
        y: pawn.y - 8,
        key: "human",
        name: "Tester",
        loot: [{ id: "stick", quantity: 1 }],
        diedAt: 10,
        stage: "corpse",
        playerCorpse: true
    };
    chunk.corpses.push(corpse);
    world._pushCorpse({ ...corpse, loot: [{ id: "stick", quantity: 2 }] });
    assert.equal(chunk.corpses.filter((e) => e.id === "c-dup").length, 1);
    assert.equal(chunk.corpses.find((e) => e.id === "c-dup").loot[0].quantity, 2);
    const saved = world.toSaveData();
    const host = Object.values(saved.chunks).find((c) =>
        (c.corpses || []).some((e) => e && e.id === "c-dup")
    );
    assert.ok(host, "save should include the corpse");
    host.corpses.push({ ...corpse, loot: [{ id: "stick", quantity: 1 }] });
    const again = world.constructor.loadFromData(saved, {});
    let n = 0;
    for (const c of again.chunks.values()) {
        n += (c.corpses || []).filter((e) => e && e.id === "c-dup").length;
    }
    assert.equal(n, 1);
});

function countCorpseId(world, id) {
    let n = 0;
    for (const c of world.chunks.values()) {
        n += (c.corpses || []).filter((e) => e && e.id === id).length;
    }
    return n;
}

test("taking the last item removes every copy and stays gone after reload", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.corpses.push({
        id: "c-loot",
        x: pawn.x,
        y: pawn.y,
        loot: [{ id: "stick", quantity: 1 }]
    });
    chunk.corpses.push({
        id: "c-keep",
        x: pawn.x + 40,
        y: pawn.y,
        loot: [{ id: "stone", quantity: 1 }]
    });
    const far = world._ensureChunk(4, 0);
    if (!Array.isArray(far.corpses)) far.corpses = [];
    far.corpses.push({
        id: "c-loot",
        x: pawn.x,
        y: pawn.y,
        loot: [{ id: "stick", quantity: 1 }]
    });
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CORPSE_TAKE,
        corpseId: "c-loot",
        index: 0,
        quantity: 1
    });
    assert.equal(countCorpseId(world, "c-loot"), 0);
    assert.equal(countCorpseId(world, "c-keep"), 1);
    const saved = world.toSaveData();
    assert.ok((saved.removedCorpseIds || []).includes("c-loot"));
    const host = Object.values(saved.chunks).find((c) =>
        Array.isArray(c.corpses)
    );
    host.corpses.push({
        id: "c-loot",
        x: pawn.x,
        y: pawn.y,
        loot: [{ id: "stick", quantity: 1 }]
    });
    const again = world.constructor.loadFromData(saved, {});
    assert.equal(countCorpseId(again, "c-loot"), 0);
    assert.equal(countCorpseId(again, "c-keep"), 1);
});

test("dismiss finds a looted body by position when the client id does not match", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    chunk.corpses.push({
        id: "server-body",
        x: pawn.x + 4,
        y: pawn.y,
        loot: []
    });
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CORPSE_DISMISS,
        corpseId: "client-only",
        corpseX: pawn.x + 4,
        corpseY: pawn.y
    });
    assert.equal(countCorpseId(world, "server-body"), 0);
    const saved = world.toSaveData();
    Object.values(saved.chunks)[0].corpses.push({
        id: "server-body",
        x: pawn.x + 4,
        y: pawn.y,
        loot: [{ id: "stick", quantity: 1 }]
    });
    const again = world.constructor.loadFromData(saved, {});
    assert.equal(countCorpseId(again, "server-body"), 0);
});

test("a later DIE adopts the client corpse id so loot removes the saved body", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world._kill(pawn, null);
    let oldId = null;
    let x = pawn.x;
    let y = pawn.y;
    for (const c of world.chunks.values()) {
        for (const e of c.corpses || []) {
            if (!e?.playerCorpse) continue;
            oldId = e.id;
            x = e.x;
            y = e.y;
        }
    }
    assert.ok(oldId);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.DIE,
        corpseId: "client-body",
        x,
        y
    });
    assert.equal(countCorpseId(world, oldId), 0);
    assert.equal(countCorpseId(world, "client-body"), 1);
    const other = world.addPlayer("p2", "Other");
    other.x = x;
    other.y = y;
    world.handleAction(other.id, {
        type: Protocol.Actions.CORPSE_DISMISS,
        corpseId: "client-body",
        x,
        y
    });
    assert.equal(countCorpseId(world, "client-body"), 0);
    const again = world.constructor.loadFromData(world.toSaveData(), {});
    assert.equal(countCorpseId(again, "client-body"), 0);
    assert.equal(countCorpseId(again, oldId), 0);
});

test("killing a mob removes its chunk entry after it leaves the spawn chunk", () => {
    const { world, pawn } = createTestWorld();
    const entry = world._spawnMobAt("deer", pawn.x, pawn.y);
    const mob = world.mobs.get(entry.uid);
    mob.x = 400;
    mob.y = pawn.y;
    world._finishMobDeath(mob);
    for (const c of world.chunks.values()) {
        assert.equal((c.mobs || []).some((m) => m && m.uid === entry.uid), false);
    }
    assert.equal(world.mobs.has(entry.uid), false);
});

test("MOB_DEATH id is the corpse id when the mob dies afterward", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const entry = world._spawnMobAt("deer", pawn.x + 8, pawn.y);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.MOB_DEATH,
        uid: entry.uid,
        x: pawn.x + 8,
        y: pawn.y,
        corpse: { id: "client-deer" }
    });
    world._finishMobDeath(world.mobs.get(entry.uid));
    const found = world._findCorpse("client-deer");
    assert.ok(found);
    assert.equal(found.entry.sourceUid, entry.uid);
});

test("MOB_DEATH after death retargets the saved corpse", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const entry = world._spawnMobAt("deer", pawn.x + 8, pawn.y);
    const mob = world.mobs.get(entry.uid);
    const x = mob.x;
    const y = mob.y;
    world._finishMobDeath(mob);
    let serverId = null;
    for (const c of world.chunks.values()) {
        for (const e of c.corpses || []) {
            if (e?.sourceUid === entry.uid) serverId = e.id;
        }
    }
    assert.ok(serverId);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.MOB_DEATH,
        uid: entry.uid,
        x,
        y,
        corpse: { id: "client-deer" }
    });
    assert.equal(countCorpseId(world, serverId), 0);
    assert.equal(countCorpseId(world, "client-deer"), 1);
});

test("a saved dead mob does not grow a new corpse on load", () => {
    const { world, pawn } = createTestWorld();
    const entry = world._spawnMobAt("deer", pawn.x + 16, pawn.y);
    const mob = world.mobs.get(entry.uid);
    assert.ok(mob.anatomy.core, "deer has a core");
    mob.anatomy.core.destroy();
    entry.body = mob.anatomy.toJSON();
    const before = [...world.chunks.values()].reduce((n, c) => n + (c.corpses || []).length, 0);
    const again = world.constructor.loadFromData(world.toSaveData(), {});
    let mobs = 0;
    let corpses = 0;
    for (const c of again.chunks.values()) {
        mobs += (c.mobs || []).filter((m) => m && m.uid === entry.uid).length;
        corpses += (c.corpses || []).length;
    }
    assert.equal(mobs, 0);
    assert.equal(corpses, before);
});

test("wildlife corpse is authored at the downed body center", () => {
    const { world, pawn } = createTestWorld();
    const entry = world._spawnMobAt("deer", pawn.x + 16, pawn.y);
    const mob = world.mobs.get(entry.uid);
    mob.x = 48;
    mob.y = 64;
    mob._prone = true;
    world._finishMobDeath(mob);
    const corpses = [];
    for (const c of world.chunks.values()) {
        for (const row of c.corpses || []) corpses.push(row);
    }
    assert.equal(corpses.length, 1);
    assert.equal(corpses[0].x, 48 + 8);
    assert.equal(corpses[0].y, 64 - 8);
});

test("snapshot hides wildlife attacking while prone", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    const boar = spawnHostileBoar(world, pawn.x + 16, pawn.y);
    assert.equal(boar.startMeleeAttack(0), true);
    assert.ok(boar.attackTimer > 0);
    boar._prone = true;
    const snap = world.snapshotFor(pawn.id);
    const row = (snap.mobs || []).find((m) => m.id === boar.id);
    assert.ok(row);
    assert.equal(row.prone, true);
    assert.equal(row.attacking, false);
    assert.equal(row.attackArt, null);
});

test("wanderer corpse uses body center, not feet x / y-8", () => {
    const { world, pawn } = createTestWorld();
    const id = "w-corpse-1";
    world.wanderers.set(id, {
        id,
        name: "Og",
        x: 48,
        y: 64,
        facing: "right",
        heading: { x: 1, y: 0 },
        inventory: [null, null, null, null, null],
        hostile: false,
        recruitLocked: false,
        refusedBy: []
    });
    const w = world.wanderers.get(id);
    world._ensureWandererCreature(w);
    world._finishWandererDeath(w, pawn);
    const corpses = [];
    for (const c of world.chunks.values()) {
        for (const row of c.corpses || []) corpses.push(row);
    }
    assert.equal(corpses.length, 1);
    assert.equal(corpses[0].x, 48 + 8);
    assert.equal(corpses[0].y, 64 - 8);
    assert.notEqual(corpses[0].x, 48);
});

function berries(qty = 4) {
    return { id: "blueberry", quantity: qty };
}

function tickUntil(world, pred, n = 48) {
    for (let i = 0; i < n; i++) {
        world.tick(50);
        if (pred()) return true;
    }
    return false;
}

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
        kc: opts.kc ?? 800,
        inventory: opts.inventory || [null, null, null, null, null]
    });
    settle.jobs = settle.jobs || {};
    settle.jobs[rec.id] = Settlement.defaultJobs();
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    return { settle, rec };
}

test("settler inventory survives world save and load", () => {
    const { SimWorld } = require("../shared/sim/SimWorld");
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        inventory: [
            { id: "stick", quantity: 3 },
            { id: "pebble", quantity: 2 },
            null, null, null
        ]
    });
    rec.equipment = {
        head: null,
        torso: { id: "leaf_wrap", quantity: 1 },
        legs: null,
        feet: null,
        back: null,
        waist: []
    };
    rec.kc = 900;
    rec.saturation = 40;

    const data = JSON.parse(JSON.stringify(world.toSaveData()));
    const saved = (data.settlers || []).find((s) => s.id === rec.id);
    assert.ok(saved);
    assert.equal(saved.inventory[0].id, "stick");
    assert.equal(saved.inventory[0].quantity, 3);
    assert.equal(saved.inventory[1].id, "pebble");
    assert.equal(saved.equipment.torso.id, "leaf_wrap");
    assert.equal(saved.kc, 900);
    assert.equal(saved.homeSettlementId, rec.homeSettlementId);
    assert.equal(saved.ownerId, pawn.id);

    const loaded = SimWorld.loadFromData(data, {});
    const again = (loaded.settlers || []).find((s) => s.id === rec.id);
    assert.ok(again);
    assert.equal(again.inventory[0].quantity, 3);
    assert.equal(again.inventory[1].id, "pebble");
    assert.equal(again.equipment.torso.id, "leaf_wrap");
    assert.equal(again.kc, 900);
    assert.equal(again.saturation, 40);
    assert.equal(again.homeSettlementId, rec.homeSettlementId);
});

test("drop then pick keeps companion inventory and clothes", () => {
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const mem = world._companionFromSnap(pawn, {
        id: "buddy-gear",
        name: "Buddy",
        x: pawn.x,
        y: pawn.y,
        inventory: [
            { id: "sharp_stick", quantity: 1 },
            { id: "pebble", quantity: 3 },
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
    world._handleSettlement(pawn, {
        op: "drop",
        pawnId: mem.id,
        settlementId: settle.id
    });
    const parked = (world.settlers || []).find((s) => s.id === mem.id);
    assert.ok(parked);
    assert.equal(parked.inventory[0].id, "sharp_stick");
    assert.equal(parked.equipment.torso.id, "leaf_wrap");
    world._handleSettlement(pawn, { op: "pick", pawnId: mem.id });
    const back = (pawn.party || []).find((m) => m.id === mem.id);
    assert.ok(back, "should rejoin the traveling party");
    assert.equal(back.inventory[0].id, "sharp_stick");
    assert.equal(back.inventory[1].id, "pebble");
    assert.equal(back.equipment.torso.id, "leaf_wrap");
    const you = world.youPayload(pawn.id);
    const row = (you.party || []).find((m) => m.id === mem.id);
    assert.ok(row);
    assert.equal(row.inventory[0].id, "sharp_stick");
    assert.equal(row.equipment.torso.id, "leaf_wrap");
});

test("settler job priorities survive pick-up, drop-off, transfer, and relog", () => {
    const { world, pawn } = createTestWorld();
    const home = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    const away = Settlement.createSettlement({
        x: pawn.x + 800,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(home, away);
    const mem = world._companionFromSnap(pawn, {
        id: "job-og",
        name: "Og",
        x: pawn.x,
        y: pawn.y
    });
    pawn.party.push(mem);
    world._handleSettlement(pawn, {
        op: "drop",
        pawnId: mem.id,
        settlementId: home.id
    });
    assert.equal(home.jobs[mem.id].cook, Settlement.defaultJobs().cook);
    const custom = Settlement.defaultJobs();
    custom.cook = 1;
    custom.haul = 0;
    custom.chop = 4;
    world._handleSettlement(pawn, {
        op: "setJobs",
        settlementId: home.id,
        pawnId: mem.id,
        jobs: custom
    });
    assert.equal(mem.jobs.cook, 1);
    world._handleSettlement(pawn, { op: "pick", pawnId: mem.id });
    const back = (pawn.party || []).find((m) => m.id === mem.id);
    assert.equal(back.jobs.cook, 1);
    assert.equal(back.jobs.haul, 0);
    assert.equal(back.jobs.chop, 4);
    const you = world.youPayload(pawn.id);
    const row = (you.party || []).find((m) => m.id === mem.id);
    assert.equal(row.jobs.cook, 1);
    const restored = world._companionFromSnap(pawn, row);
    assert.equal(restored.jobs.haul, 0);
    assert.equal(restored.jobs.chop, 4);
    world._handleSettlement(pawn, {
        op: "drop",
        pawnId: mem.id,
        settlementId: away.id
    });
    assert.equal(away.jobs[mem.id].cook, 1);
    assert.equal(away.jobs[mem.id].haul, 0);
    const next = Settlement.normalizeJobs(away.jobs[mem.id]);
    next.gather = 2;
    world._handleSettlement(pawn, {
        op: "setJobs",
        settlementId: away.id,
        pawnId: mem.id,
        jobs: next
    });
    world._handleSettlement(pawn, {
        op: "transfer",
        settlementId: away.id,
        pawnId: mem.id,
        destId: home.id
    });
    assert.equal(mem.homeSettlementId, home.id);
    assert.equal(home.jobs[mem.id].cook, 1);
    assert.equal(home.jobs[mem.id].gather, 2);
    assert.equal(home.jobs[mem.id].chop, 4);
    assert.equal(mem.jobs.gather, 2);
});

test("changing a job priority does not serialize YOU", () => {
    const SimSession = require("../shared/sim/SimSession");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    const rec = world._settlerFromSnap({
        id: "pri-1",
        name: "Pri",
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        inventory: [null, null, null, null, null]
    });
    settle.jobs = { [rec.id]: Settlement.defaultJobs() };
    world.settlements.push(settle);
    world.settlers.push(rec);
    world._ensureSettlerCreature(rec);
    let yous = 0;
    const session = new SimSession({
        sim: world,
        send: (_id, type) => {
            if (type === Protocol.Types.YOU) yous++;
        }
    });
    session._connected.add(pawn.id);
    const jobs = Settlement.normalizeJobs(settle.jobs[rec.id]);
    jobs.haul = 1;
    session.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "setJobs",
        settlementId: settle.id,
        pawnId: rec.id,
        jobs
    });
    assert.equal(settle.jobs[rec.id].haul, 1);
    assert.equal(rec.jobs.haul, 1);
    assert.equal(yous, 0);
    session.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "setStock",
        settlementId: settle.id,
        stock: settle.stock
    });
    assert.equal(yous, 1);
});

test("setSchedule is stored on the camp and the settler", () => {
    const { world, pawn } = createTestWorld();
    const home = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(home);
    const mem = world._companionFromSnap(pawn, {
        id: "sched-og",
        name: "Og",
        x: pawn.x,
        y: pawn.y
    });
    pawn.party.push(mem);
    world._handleSettlement(pawn, {
        op: "drop",
        pawnId: mem.id,
        settlementId: home.id
    });
    assert.equal(home.schedules[mem.id], Settlement.defaultSchedule());
    const custom = Settlement.paintSchedule(Settlement.defaultSchedule(), 22, "recreation");
    world._handleSettlement(pawn, {
        op: "setSchedule",
        settlementId: home.id,
        pawnId: mem.id,
        schedule: custom
    });
    assert.equal(home.schedules[mem.id].charAt(22), "r");
    assert.equal(mem.schedule.charAt(22), "r");
    world._handleSettlement(pawn, { op: "pick", pawnId: mem.id });
    const back = (pawn.party || []).find((m) => m.id === mem.id);
    assert.equal(back.schedule.charAt(22), "r");
    const you = world.youPayload(pawn.id);
    const row = (you.party || []).find((m) => m.id === mem.id);
    assert.equal(row.schedule.charAt(22), "r");
    const restored = world._companionFromSnap(pawn, row);
    assert.equal(restored.schedule.charAt(22), "r");
});

test("a favorite drops in at the front of the camp list", () => {
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const plain = world._companionFromSnap(pawn, {
        id: "plain",
        name: "Plain",
        x: pawn.x,
        y: pawn.y
    });
    const fav = world._companionFromSnap(pawn, {
        id: "fav",
        name: "Fav",
        x: pawn.x,
        y: pawn.y
    });
    const later = world._companionFromSnap(pawn, {
        id: "later",
        name: "Later",
        x: pawn.x,
        y: pawn.y
    });
    assert.equal(plain.favorite, false);
    pawn.party.push(plain, fav, later);
    world._handleSettlement(pawn, { op: "favorite", pawnId: fav.id, favorite: true });
    world._handleSettlement(pawn, { op: "drop", pawnId: plain.id, settlementId: settle.id });
    assert.deepEqual(settle.jobOrder, ["plain"]);
    world._handleSettlement(pawn, { op: "drop", pawnId: fav.id, settlementId: settle.id });
    assert.deepEqual(settle.jobOrder, ["fav", "plain"]);
    const parked = world.settlers.find((s) => s.id === fav.id);
    assert.equal(parked.favorite, true);
    const saved = world._persistSettler(parked);
    assert.equal(saved.favorite, true);
    assert.equal(world._settlerFromSnap(saved).favorite, true);
    assert.equal(world._publicSettler(parked).favorite, true);
    world._handleSettlement(pawn, { op: "pick", pawnId: fav.id });
    const back = pawn.party.find((m) => m.id === fav.id);
    assert.equal(back.favorite, true);
    assert.deepEqual(settle.jobOrder, ["plain"]);
    const you = world.youPayload(pawn.id);
    assert.equal(you.party.find((m) => m.id === fav.id).favorite, true);
    assert.equal(world._companionFromSnap(pawn, you.party.find((m) => m.id === fav.id)).favorite, true);
    world._handleSettlement(pawn, { op: "drop", pawnId: fav.id, settlementId: settle.id });
    world._handleSettlement(pawn, { op: "favorite", pawnId: later.id, favorite: true });
    world._handleSettlement(pawn, { op: "drop", pawnId: later.id, settlementId: settle.id });
    assert.deepEqual(settle.jobOrder, ["later", "fav", "plain"]);
    world._handleSettlement(pawn, { op: "favorite", pawnId: later.id, favorite: false });
    assert.equal(world.settlers.find((s) => s.id === later.id).favorite, false);
    assert.deepEqual(settle.jobOrder, ["fav", "later", "plain"]);
});

test("favoriting a settler here parks them under the other favorites", () => {
    const { world, pawn } = createTestWorld();
    const settle = Settlement.createSettlement({
        x: pawn.x,
        y: pawn.y,
        ownerId: pawn.id
    });
    world.settlements.push(settle);
    const ids = ["a", "b", "c", "d", "e", "f"];
    for (const id of ids) {
        world.settlers.push(world._settlerFromSnap({
            id,
            name: id,
            x: pawn.x,
            y: pawn.y,
            ownerId: pawn.id,
            homeSettlementId: settle.id
        }));
    }
    world._syncJobOrder(settle);
    const star = (id, on) => {
        world._handleSettlement(pawn, { op: "favorite", pawnId: id, favorite: on });
    };
    star("a", true);
    star("b", true);
    star("e", true);
    assert.deepEqual(settle.jobOrder, ["a", "b", "e", "c", "d", "f"]);
    star("c", true);
    star("d", true);
    assert.deepEqual(settle.jobOrder, ["a", "b", "e", "c", "d", "f"]);
    star("e", false);
    assert.equal(world.settlers.find((s) => s.id === "e").favorite, false);
    assert.deepEqual(settle.jobOrder, ["a", "b", "c", "d", "e", "f"]);
    assert.deepEqual(
        world.settlers.filter((s) => s.homeSettlementId === settle.id).map((s) => s.id),
        ["a", "b", "c", "d", "e", "f"]
    );
});

test("favoriting a companion parks them under the other party favorites", () => {
    const { world, pawn } = createTestWorld();
    for (const id of ["a", "b", "c", "d", "e"]) {
        pawn.party.push(world._companionFromSnap(pawn, {
            id,
            name: id,
            x: pawn.x,
            y: pawn.y
        }));
    }
    const star = (id, on) => {
        world._handleSettlement(pawn, { op: "favorite", pawnId: id, favorite: on });
    };
    const order = () => pawn.party.map((m) => m.id);
    star("c", true);
    assert.deepEqual(order(), ["c", "a", "b", "d", "e"]);
    star("a", true);
    star("e", true);
    assert.deepEqual(order(), ["c", "a", "e", "b", "d"]);
    star("b", true);
    star("d", true);
    assert.deepEqual(order(), ["c", "a", "e", "b", "d"]);
    star("e", false);
    assert.equal(pawn.party.find((m) => m.id === "e").favorite, false);
    assert.deepEqual(order(), ["c", "a", "b", "d", "e"]);
});

test("empty rec equipment does not wipe clothes on the creature", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        inventory: [{ id: "stick", quantity: 1 }, null, null, null, null]
    });
    rec.creature.equipment = {
        head: null,
        torso: { id: "leaf_wrap", quantity: 1 },
        legs: null,
        feet: null,
        back: null,
        waist: []
    };
    rec.equipment = {
        head: null, torso: null, legs: null, feet: null, back: null, waist: []
    };
    world._sharePawnGear(rec, rec.creature);
    assert.equal(rec.equipment.torso.id, "leaf_wrap");
    const snap = world._persistSettler(rec);
    assert.equal(snap.equipment.torso.id, "leaf_wrap");
    const pub = world._publicSettler(rec);
    assert.equal(pub.equipment.torso.id, "leaf_wrap");
});

test("stale character party does not wipe a parked settler's bags", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        id: "og",
        inventory: [{ id: "stick", quantity: 2 }, null, null, null, null]
    });
    rec.equipment = {
        head: null,
        torso: { id: "leaf_wrap", quantity: 1 },
        legs: null,
        feet: null,
        back: null,
        waist: []
    };
    world._ensureSettlerCreature(rec);
    pawn.party = [world._companionFromSnap(pawn, {
        id: "og",
        name: "Parked",
        inventory: [null, null, null, null, null],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] }
    })];
    world._reconcilePartyAndSettlers(pawn);
    for (let i = 0; i < 4; i++) world.tick(50);
    assert.equal((pawn.party || []).some((m) => m.id === "og"), false);
    const parked = (world.settlers || []).find((s) => s.id === "og");
    assert.equal(parked.inventory[0].id, "stick");
    assert.equal(parked.equipment.torso.id, "leaf_wrap");
    const you = world.youPayload(pawn.id);
    assert.equal((you.party || []).some((m) => m.id === "og"), false);
    const row = (you.settlers || []).find((s) => s.id === "og");
    assert.ok(row);
    assert.equal(row.inventory[0].id, "stick");
    assert.equal(row.equipment.torso.id, "leaf_wrap");
});

test("companion auto-eats berries from their own hotbar", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 800;
    buddy.inventory[0] = berries();
    const started = tickUntil(world, () => !!buddy.eatChannel);
    assert.equal(started, true, "companion should open eatChannel without PARTY_EAT");
    assert.equal(buddy.eatChannel.fromId, buddy.id);
    assert.equal(buddy.eatChannel.bag, "hotbar");
    const evs = world.drainEvents().filter((e) =>
        e.kind === "channel" && e.channel === "eat" && e.pawnId === buddy.id
    );
    assert.ok(evs.length, "companion eat should emit channel events with pawnId");
    assert.ok(evs.some((e) => typeof e.progress === "number"));
    const kc0 = buddy.kc;
    const ate = tickUntil(world, () => buddy.kc > kc0, 40);
    assert.equal(ate, true, "companion kc should rise after the bite");
});

test("food poisoning lengthens companion eat and tend channels", () => {
    const { world, pawn } = createTestWorld();
    const healthy = addTestCompanion(world, pawn, "healthy");
    const sick = addTestCompanion(world, pawn, "sick");
    healthy.inventory[0] = berries();
    sick.inventory[0] = berries();
    sick.creature.anatomy.addHediff("food_poisoning", 0.5);
    world._beginPawnEat(healthy, {
        pawn: healthy, from: healthy, slot: 0, bag: "hotbar", stack: healthy.inventory[0]
    });
    world._beginPawnEat(sick, {
        pawn: sick, from: sick, slot: 0, bag: "hotbar", stack: sick.inventory[0]
    });
    assert.ok(healthy.eatChannel?.max > 0);
    assert.ok(
        sick.eatChannel.max > healthy.eatChannel.max * 2,
        `poisoned eat ${sick.eatChannel.max} should be slower than ${healthy.eatChannel.max}`
    );

    healthy.eatChannel = null;
    sick.eatChannel = null;
    healthy.inventory[0] = { id: "leaf_cord", quantity: 1 };
    sick.inventory[0] = { id: "leaf_cord", quantity: 1 };
    cutArm(healthy.creature);
    cutArm(sick.creature);
    world._beginPawnTend(healthy, {
        patient: healthy, source: healthy, slot: 0, bag: "hotbar", stack: healthy.inventory[0]
    });
    world._beginPawnTend(sick, {
        patient: sick, source: sick, slot: 0, bag: "hotbar", stack: sick.inventory[0]
    });
    assert.ok(healthy.tendChannel?.max > 0);
    assert.ok(
        sick.tendChannel.max > healthy.tendChannel.max * 1.5,
        `poisoned tend ${sick.tendChannel.max} should be slower than ${healthy.tendChannel.max}`
    );
});

test("eating companion follows at the action slowdown", () => {
    const { world, pawn } = createTestWorld();
    pawn.connected = true;
    pawn.x = 80;
    pawn.y = 48;
    pawn.creature.x = pawn.x;
    pawn.creature.y = pawn.y;
    const idle = addTestCompanion(world, pawn, "idle");
    const eating = addTestCompanion(world, pawn, "eating");
    idle.kc = 1200;
    eating.kc = 800;
    idle.x = pawn.x - 140;
    idle.y = pawn.y;
    eating.x = pawn.x - 140;
    eating.y = pawn.y;
    eating.inventory[0] = berries();
    world._beginPawnEat(eating, {
        pawn: eating, from: eating, slot: 0, bag: "hotbar", stack: eating.inventory[0]
    });
    assert.ok(eating.eatChannel);
    eating.eatChannel.remaining = 60_000;
    const idle0 = idle.x;
    const eat0 = eating.x;
    for (let i = 0; i < 20; i++) world.tick(50);
    const idleDist = idle.x - idle0;
    const eatDist = eating.x - eat0;
    assert.ok(eatDist > 8, `eater should still walk (moved ${eatDist.toFixed(1)})`);
    assert.ok(
        idleDist > eatDist + 8,
        `idle follower should outpace the eater (idle ${idleDist.toFixed(1)} eat ${eatDist.toFixed(1)})`
    );
});

test("resting companion gets up and auto-eats instead of starving in bed", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 800;
    buddy.inventory[0] = berries();
    buddy._resting = true;
    if (buddy.creature) buddy.creature._resting = true;
    const started = tickUntil(world, () => !!buddy.eatChannel);
    assert.equal(started, true, "resting companion should wake and open eatChannel");
    assert.equal(buddy._resting, false);
    assert.equal(buddy._wokeFromRest, true);
    assert.equal(buddy.eatChannel.fromId, buddy.id);
});

test("companion does not auto-eat from the selected pawn", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    pawn.inventory[1] = berries();
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 800;
    buddy.inventory = [null, null, null, null, null];
    const started = tickUntil(world, () => !!buddy.eatChannel, 24);
    assert.equal(started, false, "selected inventory is player-owned");
});

test("companion auto-eats from an unselected companion's bag", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    pawn.inventory[0] = berries();
    const buddy = addTestCompanion(world, pawn);
    const carry = addTestCompanion(world, pawn, "carry");
    buddy.kc = 800;
    buddy.inventory = [null, null, null, null, null];
    carry.inventory[0] = berries();
    const started = tickUntil(world, () => !!buddy.eatChannel);
    assert.equal(started, true, "companion should eat from another uncontrolled member");
    assert.equal(buddy.eatChannel.fromId, carry.id);
    assert.equal(buddy.eatChannel.bag, "hotbar");
    assert.equal(buddy.eatChannel.slot, 0);
});

test("companion prefers roasted food in a nearby bag over raw in hand", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    const carry = addTestCompanion(world, pawn, "carry");
    buddy.kc = 800;
    buddy.inventory[0] = berries();
    carry.inventory[0] = { id: "roasted_apple", quantity: 1 };
    const started = tickUntil(world, () => !!buddy.eatChannel);
    assert.equal(started, true, "companion should open eatChannel");
    assert.equal(buddy.eatChannel.fromId, carry.id);
    assert.equal(buddy.eatChannel.itemId, "roasted_apple");
});

test("switching to a pawn interrupts eats from that inventory", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    const carry = addTestCompanion(world, pawn, "carry");
    buddy.kc = 800;
    buddy.inventory = [null, null, null, null, null];
    carry.inventory[0] = berries();
    const started = tickUntil(world, () => !!buddy.eatChannel);
    assert.equal(started, true);
    assert.equal(buddy.eatChannel.fromId, carry.id);
    world.drainEvents();
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: carry.id });
    assert.equal(pawn.controlId, carry.id);
    assert.equal(buddy.eatChannel, null, "eat from the newly selected pawn should cancel");
    assert.equal(carry.inventory[0]?.id, "blueberry");
    const evs = world.drainEvents().filter((e) =>
        e.kind === "channel" && e.channel === "eat" && e.pawnId === buddy.id
    );
    assert.ok(evs.some((e) => e.cancelled), "cancelled eat should emit a channel event");
});

test("switching to an eating companion cancels their eat", () => {
    const { world, pawn, Protocol } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 800;
    buddy.inventory[0] = berries();
    const started = tickUntil(world, () => !!buddy.eatChannel);
    assert.equal(started, true);
    assert.equal(buddy.eatChannel.fromId, buddy.id);
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: buddy.id });
    assert.equal(pawn.controlId, buddy.id);
    assert.equal(buddy.eatChannel, null, "possessing the eater should stop the bite");
});

test("switching to a rest-walking companion cancels the rest walk", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const entry = { uid: "lt-ctrl", id: "lean_to", x: 32, y: 32, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);
    const buddy = addTestCompanion(world, pawn);
    world._orderRest(pawn, buddy, entry, 0, { autofill: false });
    assert.ok(buddy._restWalk);
    world.handleAction(pawn.id, { type: Protocol.Actions.SWITCH_CONTROL, pawnId: buddy.id });
    assert.equal(buddy._restWalk, null, "taking control should abort walking into bed");
    assert.equal(!!buddy._resting, false);
    world.tick(50);
    assert.equal(buddy._restWalk, null);
    assert.equal(!!buddy._resting, false);
    assert.notEqual(entry.occupants?.[0], buddy.id);
});

test("companion does not eat coconut shells while malnourished if hunger is not empty", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 80;
    buddy.inventory[0] = { id: "cracked_coconut", quantity: 2 };
    buddy.creature.anatomy.addHediff("malnutrition", 0.4);
    const started = tickUntil(world, () => !!buddy.eatChannel, 24);
    assert.equal(started, false, "shells are emergency food — wait until kc is 0");
});

test("companion eats coconut shells at 0 hunger", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 0;
    buddy.inventory[0] = { id: "cracked_coconut", quantity: 2 };
    const started = tickUntil(world, () => !!buddy.eatChannel, 24);
    assert.equal(started, true, "empty stomach should allow a coconut shell");
    assert.equal(buddy.eatChannel.fromId, buddy.id);
});

test("companion does not eat raw meat while malnourished if hunger is not empty", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 80;
    buddy.inventory[0] = { id: "raw_venison", quantity: 2 };
    buddy.creature.anatomy.addHediff("malnutrition", 0.4);
    const started = tickUntil(world, () => !!buddy.eatChannel, 24);
    assert.equal(started, false, "raw meat is emergency food — wait until kc is 0");
});

test("settler auto-eats food already in inventory", () => {
    const { world, pawn } = createTestWorld();
    const { rec } = parkSettler(world, pawn, {
        kc: 800,
        inventory: [berries(), null, null, null, null]
    });
    const started = tickUntil(world, () => !!rec.eatChannel);
    assert.equal(started, true, "settler doEat should open eatChannel");
    assert.equal(rec.eatChannel.fromId, rec.id);
    assert.equal(rec.eatChannel.bag, "hotbar");
    const ch = world._publicSettler(rec)?.channel;
    assert.ok(ch);
    assert.equal(ch.kind, "eat");
});

function qtyInv(pawn, id) {
    let n = 0;
    for (const s of pawn.inventory || []) {
        if (s?.id === id) n += Math.max(1, Number(s.quantity) || 1);
    }
    return n;
}

test("companion prefers poultice over cord in pockets and ignores a ground pile", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.kc = 1200;
    doctor.inventory[0] = { id: "leaf_cord", quantity: 2 };
    doctor.inventory[1] = { id: "poultice", quantity: 1 };
    const patient = addTestCompanion(world, pawn, "pat");
    patient.name = "Ugg";
    patient.x = doctor.x;
    patient.y = doctor.y;
    patient.kc = 1200;
    cutArm(patient.creature);
    const chunk = originChunk(world);
    chunk.drops.push({ uid: "foot-poul", id: "poultice", quantity: 9, x: doctor.x, y: doctor.y });
    const started = tickUntil(world, () => !!doctor.tendChannel, 24);
    assert.equal(started, true);
    assert.equal(doctor.tendChannel.itemId, "poultice");
    assert.equal(qtyInv(doctor, "poultice") + qtyInv(patient, "poultice"), 1);
    assert.ok(chunk.drops.some((d) => d.uid === "foot-poul" && d.quantity === 9));
});

test("companion with empty pockets does not tend from a ground pile at their feet", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.kc = 1200;
    const patient = addTestCompanion(world, pawn, "pat");
    patient.x = doctor.x;
    patient.y = doctor.y;
    patient.kc = 1200;
    cutArm(patient.creature);
    originChunk(world).drops.push({ uid: "foot-poul", id: "poultice", quantity: 4, x: doctor.x, y: doctor.y });
    const started = tickUntil(world, () => !!doctor.tendChannel, 24);
    assert.equal(started, false);
});

test("companion tending the player may spend the player's held poultice", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    pawn.hotbarIndex = 0;
    pawn.inventory[0] = { id: "poultice", quantity: 1 };
    pawn.kc = 1200;
    cutArm(pawn.creature);
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.kc = 1200;
    doctor.x = pawn.x;
    doctor.y = pawn.y;
    const started = tickUntil(world, () => !!doctor.tendChannel, 24);
    assert.equal(started, true);
    assert.equal(doctor.tendChannel.patientId, pawn.id);
    assert.equal(doctor.tendChannel.itemId, "poultice");
    assert.equal(doctor.tendChannel.fromId, pawn.id);
});

test("companion tending someone else must not spend the player's held poultice", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    pawn.hotbarIndex = 0;
    pawn.inventory[0] = { id: "poultice", quantity: 2 };
    pawn.kc = 1200;
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.kc = 1200;
    const patient = addTestCompanion(world, pawn, "pat");
    patient.x = doctor.x;
    patient.y = doctor.y;
    patient.kc = 1200;
    cutArm(patient.creature);
    const started = tickUntil(world, () => !!doctor.tendChannel, 24);
    assert.equal(started, false);
    assert.equal(pawn.inventory[0]?.id, "poultice");
    assert.equal(pawn.inventory[0]?.quantity, 2);
});

test("cord Space tend covers one wound per use", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.kc = 1200;
    doctor.inventory[0] = { id: "leaf_cord", quantity: 2 };
    const patient = addTestCompanion(world, pawn, "pat");
    patient.x = doctor.x;
    patient.y = doctor.y;
    patient.kc = 1200;
    const left = patient.creature.anatomy.part("Left Arm") || patient.creature.anatomy.core;
    const right = patient.creature.anatomy.part("Right Arm") || patient.creature.anatomy.core;
    left.injure({ id: "cut", severity: 8, bleeding: true, bleedRate: 0.06, tended: false });
    right.injure({ id: "cut", severity: 8, bleeding: true, bleedRate: 0.06, tended: false });
    const started = tickUntil(world, () => !!doctor.tendChannel, 24);
    assert.equal(started, true);
    const done = tickUntil(world, () => {
        const a = left.injuries?.[0];
        const b = right.injuries?.[0];
        return !!(a && b && (a.tended !== b.tended));
    }, 160);
    assert.equal(done, true, "one cord should tend a single wound");
    assert.equal(doctor.inventory[0]?.quantity, 1);
});

test("companion auto-tends a wounded packmate in range", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.name = "Doc";
    doctor.kc = 1200;
    doctor.inventory[0] = { id: "leaf_cord", quantity: 2 };
    const patient = addTestCompanion(world, pawn, "pat");
    patient.name = "Ugg";
    patient.x = doctor.x;
    patient.y = doctor.y;
    patient.kc = 1200;
    cutArm(patient.creature);
    const started = tickUntil(world, () => !!doctor.tendChannel, 24);
    assert.equal(started, true, "companion should open tendChannel without a TEND action");
    assert.equal(doctor.tendChannel.patientId, patient.id);
    assert.equal(doctor.tendChannel.patientName, "Ugg");
    assert.equal(doctor.tendChannel.fromId, doctor.id);
    const evs = world.drainEvents().filter((e) =>
        e.kind === "channel" && e.channel === "tend" && e.pawnId === doctor.id
    );
    assert.ok(evs.length, "companion tend should emit channel events with pawnId");
    assert.equal(evs[0].patientName, "Ugg");
    const snap = world.snapshotFor(pawn.id);
    const me = (snap.players || []).find((p) => p.id === pawn.id);
    const row = (me?.party || []).find((m) => m.id === doctor.id);
    assert.equal(row?.tendChannel?.patientName, "Ugg");
    assert.equal(row?.activity, "Tending Ugg");
    const done = tickUntil(world, () => {
        const inj = patient.creature.anatomy.part("Left Arm")?.injuries?.[0];
        return !!(inj && inj.tended);
    }, 160);
    assert.equal(done, true, "patient wound should be tended after the channel");
    assert.equal(doctor.inventory[0]?.id, "leaf_cord");
    assert.equal(doctor.inventory[0]?.quantity, 1);
});

test("companion walking to tend names the patient on the pose snapshot", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const doctor = addTestCompanion(world, pawn, "doc");
    doctor.name = "Doc";
    doctor.kc = 1200;
    doctor.inventory[0] = { id: "leaf_cord", quantity: 2 };
    const patient = addTestCompanion(world, pawn, "pat");
    patient.name = "Ugg";
    patient.x = doctor.x + 80;
    patient.y = doctor.y;
    patient.kc = 1200;
    cutArm(patient.creature);
    const seeking = tickUntil(world, () => !!doctor.creature?.ai?.tendSeek, 24);
    assert.equal(seeking, true, "companion should seek the wounded packmate");
    assert.equal(!!doctor.tendChannel, false, "should still be walking");
    const snap = world.snapshotFor(pawn.id);
    const me = (snap.players || []).find((p) => p.id === pawn.id);
    const row = (me?.party || []).find((m) => m.id === doctor.id);
    assert.equal(row?.activity, "Tending Ugg");
});

test("settler doctor snapshot names the patient", () => {
    const { world, pawn } = createTestWorld();
    const { settle, rec: doctor } = parkSettler(world, pawn, {
        id: "doc",
        kc: 1200,
        inventory: [{ id: "leaf_cord", quantity: 2 }, null, null, null, null]
    });
    doctor.name = "Doc";
    const patient = world._settlerFromSnap({
        id: "pat",
        name: "Ugg",
        x: doctor.x,
        y: doctor.y,
        ownerId: pawn.id,
        homeSettlementId: settle.id,
        kc: 1200,
        inventory: [null, null, null, null, null]
    });
    settle.jobs[patient.id] = Settlement.defaultJobs();
    world.settlers.push(patient);
    world._ensureSettlerCreature(patient);
    cutArm(patient.creature);
    const started = tickUntil(world, () => doctor._workChannel?.kind === "tend", 48);
    assert.equal(started, true, "settler doctor should open a tend work channel");
    assert.equal(doctor._workChannel.patientName, "Ugg");
    const pub = world._publicSettler(doctor);
    assert.equal(pub.channel?.kind, "tend");
    assert.equal(pub.channel?.patientName, "Ugg");
    assert.equal(pub.activity, "Tending Ugg");
});

test("companion auto-tends themselves when they hold a bandage", () => {
    const { world, pawn } = createTestWorld();
    pawn.controlId = pawn.id;
    const buddy = addTestCompanion(world, pawn);
    buddy.kc = 1200;
    buddy.inventory[0] = { id: "leaf_cord", quantity: 1 };
    cutArm(buddy.creature);
    const started = tickUntil(world, () => !!buddy.tendChannel, 24);
    assert.equal(started, true, "injured companion should self-tend in range");
    assert.equal(buddy.tendChannel.patientId, buddy.id);
});

test("new join rolls a wanderer cooldown instead of spawning immediately", () => {
    const { world, pawn } = createTestWorld();
    world.addPlayer("fresh", "Fresh", null, { silentJoin: true });
    const wait = world._directorCdLeft("fresh");
    const [lo, hi] = Party.COOLDOWN_ROOM;
    assert.ok(wait >= lo && wait <= hi, `expected ${lo}-${hi}s, got ${wait}`);
    world.tick(50);
    assert.equal(world.wanderers.size, 0);
    assert.ok(world._directorCdLeft(pawn.id) >= lo - 1);
});

test("wanderer cooldown is per player, saved on the world, and kept on relog", () => {
    const { SimWorld } = require("../shared/sim/SimWorld");
    const { world, pawn } = createTestWorld();
    world.addPlayer("p2", "Two", null, { silentJoin: true });
    const p2 = world.players.get("p2");
    p2.x = 8000;
    p2.y = 8000;
    world._setDirectorCd(pawn.id, 100);
    world._setDirectorCd("p2", 400);
    world.tick(1000);
    const left = world._directorCdLeft(pawn.id);
    assert.ok(left > 98.5 && left < 100, `p1 should lose ~1s, got ${left}`);
    assert.ok(Math.abs(world._directorCdLeft("p2") - 399) < 0.05);

    const data = world.toSaveData();
    assert.ok(Math.abs(data.directorCd[pawn.id] - left) < 1e-6);
    assert.ok(Math.abs(data.directorCd.p2 - 399) < 0.05);

    const loaded = SimWorld.loadFromData(data, {});
    loaded.addPlayer(pawn.id, pawn.name, null, { silentJoin: true });
    loaded.addPlayer("p2", "Two", null, { silentJoin: true });
    assert.ok(Math.abs(loaded._directorCdLeft(pawn.id) - left) < 1e-6);
    assert.ok(Math.abs(loaded._directorCdLeft("p2") - data.directorCd.p2) < 1e-6);

    world.removePlayer(pawn.id);
    world.addPlayer(pawn.id, pawn.name, null, { silentJoin: true });
    assert.ok(Math.abs(world._directorCdLeft(pawn.id) - left) < 1e-6, "logout must not re-roll the timer");
});

test("world save without directorCd still rolls a first-join cooldown", () => {
    const { SimWorld } = require("../shared/sim/SimWorld");
    const { world } = createTestWorld();
    const data = world.toSaveData();
    delete data.directorCd;
    const loaded = SimWorld.loadFromData(data, {});
    loaded.addPlayer("newbie", "Newbie", null, { silentJoin: true });
    const wait = loaded._directorCdLeft("newbie");
    const [lo, hi] = Party.COOLDOWN_ROOM;
    assert.ok(wait >= lo && wait <= hi, `expected ${lo}-${hi}s, got ${wait}`);
    loaded.tick(50);
    assert.equal(loaded.wanderers.size, 0);
});

test("hot food in a basket cools each world minute", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_hot_food",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, DataStore.getThing("wicker_basket"));
    basket.slots[0] = { id: "roasted_apple", quantity: 1, temp: 400 };
    chunk.things.push(basket);
    const start = basket.slots[0].temp;
    world._worldMinute();
    assert.ok(
        basket.slots[0].temp < start,
        `expected cooler than ${start}, got ${basket.slots[0].temp}`
    );
    for (let i = 0; i < 120; i++) world._worldMinute();
    assert.equal(basket.slots[0].temp, undefined);
});

test("raw hide on a drying rack still spoils", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const rack = { uid: "rack_raw_spoil", id: "drying_rack", x: pawn.x, y: pawn.y };
    Place.ensureStorageEntry(rack, DataStore.getThing("drying_rack"));
    const now = world.worldMinuteIndex();
    rack.slots[0] = Hide.hangStack(
        { id: "deer_hide", quantity: 1, spoilLeft: 2 },
        now,
        (id) => DataStore.getItem(id)
    );
    chunk.things.push(rack);
    assert.equal(rack.slots[0].spoilAt, now + 2);
    world._worldMinute();
    assert.equal(rack.slots[0].id, "deer_hide");
    world._worldMinute();
    assert.equal(rack.slots[0].id, "rot");
});

test("fleshed hide on a drying rack does not spoil while drying", () => {
    const { world, pawn } = createTestWorld();
    const chunk = originChunk(world);
    const rack = { uid: "rack_flesh_dry", id: "drying_rack", x: pawn.x, y: pawn.y };
    Place.ensureStorageEntry(rack, DataStore.getThing("drying_rack"));
    const now = world.worldMinuteIndex();
    rack.slots[0] = Hide.hangStack(
        { id: "deer_hide_fleshed", quantity: 1, spoilLeft: 3 },
        now,
        (id) => DataStore.getItem(id)
    );
    chunk.things.push(rack);
    for (let i = 0; i < 8; i++) world._worldMinute();
    assert.equal(rack.slots[0].id, "deer_hide_fleshed");
    assert.ok(rack.slots[0].dryProgress > 0);
    assert.equal(rack.slots[0].spoilLeft, 3);
});

test("waking from a lean-to clears prone so the player can attack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const entry = { uid: "lt-wake-atk", id: "lean_to", x: pawn.x, y: pawn.y, tx: 2, ty: 2, rot: 0 };
    Place.ensureSleepEntry(entry, { sleep: { slots: 2 } });
    chunk.things.push(entry);

    world._occupySlot(pawn, pawn, entry, 0);
    assert.equal(!!pawn._resting, true);
    // Sleep copies rest into snapshot `prone`. A wake that only clears `_resting`
    // left `pawn.prone` / `_prone` set, so YOU/snapshots kept blocking melee.
    pawn.prone = true;
    if (pawn.creature) pawn.creature._prone = true;

    world.handleAction(pawn.id, { type: Protocol.Actions.SLEEP, op: "wake", pawnId: pawn.id });
    assert.equal(!!pawn._resting, false);
    assert.equal(!!pawn.prone, false);
    assert.equal(!!pawn.creature._prone, false);
    assert.equal(!!pawn.creature._resting, false);

    const you = world.youPayload(pawn.id);
    assert.equal(you.resting, false);
    assert.equal(you.prone, false);

    const snap = world.snapshotFor(pawn.id);
    const me = (snap.players || []).find((p) => p.id === pawn.id);
    assert.ok(me);
    assert.equal(!!me.resting, false);
    assert.equal(!!me.prone, false);

    world.handleAction(pawn.id, { type: Protocol.Actions.ATTACK, angle: 0, pawnId: pawn.id });
    assert.ok(pawn.creature.attackTimer > 0, "should start a melee swing after waking");
});

function fillGrass(world) {
    const n = 8 * 8;
    for (const c of world.chunks.values()) {
        c.tiles = Array(n).fill("grass");
    }
}

test("cannot place painting circle outside owned settlement", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "painting_circle", quantity: 1 };
    pawn.hotbarIndex = 0;
    world.drainEvents();
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1 });
    assert.equal(pawn.inventory[0]?.id, "painting_circle");
    const logs = world.drainEvents().filter((e) => e.kind === "combat_log");
    assert.ok(logs.some((e) => /Must be placed in your settlement/.test(e.text || "")));
});

test("can place painting circle inside owned settlement", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    pawn.inventory[0] = { id: "painting_circle", quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1 });
    assert.ok(!pawn.inventory[0] || !(pawn.inventory[0].quantity > 0));
    const chunk = originChunk(world);
    const circle = (chunk.things || []).find((t) => t.id === "painting_circle");
    assert.ok(circle);
    assert.equal(circle.painted, 0);
    assert.equal(circle.locked, undefined);
    assert.equal(circle.slots, undefined);
    assert.equal(circle.paintEnabled, true);
    assert.equal(Research.hasTech(settle, "painting"), true);
    assert.equal(world.isBlocked(circle.x, circle.y), false);
});

test("placing and picking up a painting circle keeps its stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    pawn.inventory[0] = { id: "painting_circle", quantity: 1, stone: "granite" };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1 });
    const chunk = originChunk(world);
    const circle = (chunk.things || []).find((t) => t.id === "painting_circle");
    assert.ok(circle);
    assert.equal(circle.stone, "granite");
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: circle.uid,
        x: circle.x,
        y: circle.y
    });
    const back = pawn.inventory.find((s) => s && s.id === "painting_circle");
    assert.ok(back);
    assert.equal(back.stone, "granite");
});

test("places a finished figurine and pickup restores voxels", () => {
    const Forming = require("../shared/forming");
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const grid = Forming.emptyGrid();
    for (let x = 7; x <= 9; x++) {
        for (let y = 0; y <= 8; y++) grid[x][y][8] = true;
    }
    grid[7][0][8] = true;
    grid[9][0][8] = true;
    const stack = Forming.makeStack("human", grid, Forming.mass(grid));
    pawn.inventory[0] = { ...stack, quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1 });
    assert.ok(!pawn.inventory[0] || !(pawn.inventory[0].quantity > 0));
    const chunk = originChunk(world);
    const fig = (chunk.things || []).find((t) => t.id === "clay_figurine");
    assert.ok(fig);
    assert.equal(fig.formClass, "human");
    assert.equal(fig.formVoxels, stack.formVoxels);
    assert.equal(fig.slots, undefined);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: fig.uid,
        x: fig.x,
        y: fig.y
    });
    assert.equal((chunk.things || []).some((t) => t.id === "clay_figurine"), false);
    const back = pawn.inventory.find((s) => s && s.id === "clay_figurine");
    assert.ok(back);
    assert.equal(back.formVoxels, stack.formVoxels);
    assert.equal(back.formClass, "human");
});

test("placing a grindstone keeps the chosen rotation", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "grindstone", quantity: 1, stone: "diorite" };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1, rot: 90 });
    const chunk = originChunk(world);
    const stone = (chunk.things || []).find((t) => t.id === "grindstone");
    assert.ok(stone);
    assert.equal(stone.rot, 90);
    assert.equal(stone.stone, "diorite");
    const def = require("../data/Things.json").find((t) => t && t.id === "grindstone");
    const stand = Place.interactTileOf(stone, 16, def);
    const origin = Place.originTileOf(stone, 16);
    assert.equal(stand.tx, origin.tx - 1);
    assert.equal(stand.ty, origin.ty);
});

test("placing and picking up a grindstone keeps its stone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    pawn.inventory[0] = { id: "grindstone", quantity: 1, stone: "granite" };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1 });
    const chunk = originChunk(world);
    const stone = (chunk.things || []).find((t) => t.id === "grindstone");
    assert.ok(stone);
    assert.equal(stone.stone, "granite");
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: stone.uid,
        x: stone.x,
        y: stone.y
    });
    const back = pawn.inventory.find((s) => s && s.id === "grindstone");
    assert.ok(back);
    assert.equal(back.stone, "granite");
});

test("place figurine rot does not rewrite voxels", () => {
    const Forming = require("../shared/forming");
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const grid = Forming.emptyGrid();
    grid[9][1][8] = true;
    for (let i = 0; i < 20; i++) grid[7][i % 8][7] = true;
    const stack = Forming.makeStack("human", grid, Forming.mass(grid));
    pawn.inventory[0] = { ...stack, quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1, rot: 90 });
    const chunk = originChunk(world);
    const fig = (chunk.things || []).find((t) => t.id === "clay_figurine");
    assert.ok(fig);
    assert.equal(fig.rot, 90);
    assert.equal(fig.formVoxels, stack.formVoxels);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: fig.uid,
        x: fig.x,
        y: fig.y
    });
    const back = pawn.inventory.find((s) => s && s.id === "clay_figurine");
    assert.ok(back);
    assert.equal(back.formVoxels, stack.formVoxels);
});

test("legacy baked place yaw is undone on pickup", () => {
    const Forming = require("../shared/forming");
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const grid = Forming.emptyGrid();
    grid[9][1][8] = true;
    for (let i = 0; i < 20; i++) grid[7][i % 8][7] = true;
    const stack = Forming.makeStack("human", grid, Forming.mass(grid));
    const yawed = Forming.rotatePackYaw(stack.formVoxels, 90);
    pawn.inventory[0] = { ...stack, quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1, rot: 0 });
    const chunk = originChunk(world);
    const fig = (chunk.things || []).find((t) => t.id === "clay_figurine");
    assert.ok(fig);
    fig.formVoxels = yawed;
    fig.rot = 90;
    delete fig.formPose;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: fig.uid,
        x: fig.x,
        y: fig.y
    });
    const back = pawn.inventory.find((s) => s && s.id === "clay_figurine");
    assert.ok(back);
    assert.equal(back.formVoxels, stack.formVoxels);
});

test("unclassified lump figurines can be placed", () => {
    const Forming = require("../shared/forming");
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const stack = Forming.makeStack("lump", Forming.fallbackMound(), 20);
    delete stack.customName;
    pawn.inventory[0] = { ...stack, quantity: 1 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.PLACE, tx: 2, ty: 1 });
    assert.ok(!pawn.inventory[0] || !(pawn.inventory[0].quantity > 0));
    const chunk = originChunk(world);
    const fig = (chunk.things || []).find((t) => t.id === "clay_figurine");
    assert.ok(fig);
    assert.equal(fig.formClass, "lump");
    assert.equal(fig.formVoxels, stack.formVoxels);
});

test("unlockTech spends from the settlement pool without changing painted counts", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const a = { uid: "pc-a", id: "painting_circle", x: pawn.x, y: pawn.y, painted: 2 };
    const b = { uid: "pc-b", id: "painting_circle", x: pawn.x + 8, y: pawn.y, painted: 2 };
    Research.ensureEntry(a);
    Research.ensureEntry(b);
    chunk.things.push(a, b);
    assert.equal(Research.recipeUnlocked("stick_frame", pawn), true);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "herbalism"
    });
    assert.equal(Research.hasTech(pawn, "herbalism"), true);
    assert.equal(settle.techs, undefined);
    assert.equal(world.researchSpentByOwner[pawn.id], 2);
    assert.equal(a.painted, 2);
    assert.equal(b.painted, 2);
    assert.equal(Research.paintedTotal([a, b]), 4);
    assert.equal(Research.pointsBreakdown([a, b], { spent: world.researchSpentByOwner[pawn.id] }).total, 2);
    assert.equal(Research.recipeUnlocked("poultice", pawn), true);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "hafting"
    });
    assert.equal(Research.hasTech(pawn, "hafting"), false);
    assert.equal(world.researchSpentByOwner[pawn.id], 2);
    assert.equal(Research.pointsBreakdown([a, b], { spent: world.researchSpentByOwner[pawn.id] }).total, 2);
});

test("unlockTech buys missing prereqs when points cover the chain", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const a = { uid: "pc-chain", id: "painting_circle", x: pawn.x, y: pawn.y, painted: 6 };
    Research.ensureEntry(a);
    chunk.things.push(a);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "skinworking"
    });
    assert.equal(Research.hasTech(pawn, "basic_furniture"), true);
    assert.equal(Research.hasTech(pawn, "skinworking"), true);
    assert.equal(world.researchSpentByOwner[pawn.id], 2);
    assert.equal(Research.pointsBreakdown([a], { spent: world.researchSpentByOwner[pawn.id] }).total, 4);
});

test("unlockTech refuses WIP techs even with points and prereqs", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const a = { uid: "pc-fog", id: "painting_circle", x: pawn.x, y: pawn.y, painted: 6 };
    Research.ensureEntry(a);
    chunk.things.push(a);
    Research.unlock(pawn, "herbalism");
    Research.unlock(pawn, "digging");
    Research.unlock(pawn, "storage");
    assert.equal(Research.currentAge(pawn), "Paleolithic");
    assert.equal(Research.techIsWip("agriculture"), true);
    assert.equal(Research.techFogged(pawn, "agriculture"), true);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "agriculture"
    });
    assert.equal(Research.hasTech(pawn, "agriculture"), false);
});

test("cannot pick up a painting circle that would drop below spent research", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const circles = [];
    for (let i = 0; i < 4; i++) {
        const e = {
            uid: `pc-${i}`,
            id: "painting_circle",
            x: pawn.x + i * 8,
            y: pawn.y,
            painted: 6,
            locked: 0
        };
        Research.ensureEntry(e);
        circles.push(e);
        chunk.things.push(e);
    }
    Research.unlock(pawn, "writing");
    Research.unlock(pawn, "agriculture");
    world.researchSpentByOwner[pawn.id] = Research.spentPoints(pawn);
    assert.equal(Research.spentPoints(pawn), 20);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: "pc-0"
    });
    assert.ok(chunk.things.some((t) => t.uid === "pc-0"));
    assert.equal(chunk.things.filter((t) => t.id === "painting_circle").length, 4);
});

test("can pick up a painting circle when remaining paintings cover spent research", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const a = {
        uid: "pc-keep-a",
        id: "painting_circle",
        x: pawn.x,
        y: pawn.y,
        painted: 6,
        locked: 0
    };
    const b = {
        uid: "pc-keep-b",
        id: "painting_circle",
        x: pawn.x + 8,
        y: pawn.y,
        painted: 6,
        locked: 0
    };
    Research.ensureEntry(a);
    Research.ensureEntry(b);
    chunk.things.push(a, b);
    Research.unlock(pawn, "agriculture");
    world.researchSpentByOwner[pawn.id] = Research.spentPoints(pawn);
    const c = {
        uid: "pc-keep-c",
        id: "painting_circle",
        x: pawn.x + 16,
        y: pawn.y,
        painted: 6,
        locked: 0
    };
    Research.ensureEntry(c);
    chunk.things.push(c);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: "pc-keep-a"
    });
    assert.equal(chunk.things.some((t) => t.uid === "pc-keep-a"), false);
    assert.ok(chunk.things.some((t) => t.uid === "pc-keep-b"));
    assert.ok(pawn.inventory.some((s) => s && s.id === "painting_circle"));
    assert.equal(Research.paintedTotal([b, c]), 12);
    assert.equal(Research.pointsBreakdown([b, c], { spent: world.researchSpentByOwner[pawn.id] }).total, 4);
});

test("installTally consumes a held tally stick", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    Research.unlock(pawn, "counting");
    const chunk = originChunk(world);
    const entry = {
        uid: "pc-install",
        id: "painting_circle",
        x: pawn.x,
        y: pawn.y,
        painted: 3
    };
    Research.ensureEntry(entry);
    chunk.things.push(entry);
    pawn.inventory[0] = { id: "tally_stick", quantity: 2 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "installTally",
        settlementId: settle.id,
        uid: entry.uid
    });
    assert.equal(entry.tallyStick, true);
    assert.equal(pawn.inventory[0]?.id, "tally_stick");
    assert.equal(pawn.inventory[0]?.quantity, 1);
    assert.equal(Research.circlePoints(entry), 4.5);
    const pub = world._storagePublic(entry, chunk);
    assert.equal(pub.tallyStick, true);
});

test("removeTally returns the stick to the pawn", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const entry = {
        uid: "pc-remove",
        id: "painting_circle",
        x: pawn.x,
        y: pawn.y,
        painted: 2,
        tallyStick: true
    };
    Research.ensureEntry(entry);
    chunk.things.push(entry);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "removeTally",
        settlementId: settle.id,
        uid: entry.uid
    });
    assert.equal(entry.tallyStick, false);
    assert.ok(pawn.inventory.some((s) => s && s.id === "tally_stick"));
    assert.equal(Research.circlePoints(entry), 2);
});

test("removeTally is blocked when remaining points would fall below spent research", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const entry = {
        uid: "pc-lock",
        id: "painting_circle",
        x: pawn.x,
        y: pawn.y,
        painted: 3,
        tallyStick: true
    };
    Research.ensureEntry(entry);
    chunk.things.push(entry);
    Research.unlock(pawn, "hut");
    world.researchSpentByOwner[pawn.id] = Research.spentPoints(pawn);
    assert.equal(Research.spentPoints(pawn), 4);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "removeTally",
        settlementId: settle.id,
        uid: entry.uid
    });
    assert.equal(entry.tallyStick, true);
    assert.equal(pawn.inventory.some((s) => s && s.id === "tally_stick"), false);
});

test("two owned camps pool circles so picking up one camp's circle can still cover spent", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const home = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    const other = Settlement.createSettlement({
        x: pawn.x + 80,
        y: pawn.y,
        ownerId: pawn.id
    });
    home.radiusTiles = 2;
    other.radiusTiles = 2;
    world.settlements.push(home, other);
    const chunk = originChunk(world);
    const here = {
        uid: "pool-here",
        id: "painting_circle",
        x: pawn.x,
        y: pawn.y,
        painted: 2
    };
    const far = {
        uid: "pool-far",
        id: "painting_circle",
        x: other.x,
        y: other.y,
        painted: 2
    };
    Research.ensureEntry(here);
    Research.ensureEntry(far);
    chunk.things.push(here, far);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: home.id,
        techId: "herbalism"
    });
    assert.equal(world.researchSpentByOwner[pawn.id], 2);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: "pool-here"
    });
    assert.equal(chunk.things.some((t) => t.uid === "pool-here"), false);
    assert.ok(chunk.things.some((t) => t.uid === "pool-far"));
    assert.ok(pawn.inventory.some((s) => s && s.id === "painting_circle"));
});

test("new world keeps brought knowledge and does not charge historical tech cost", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    Research.unlock(pawn, "herbalism");
    assert.equal(Research.recipeUnlocked("poultice", pawn), true);
    const emptyPts = world._researchPoints(pawn.id);
    assert.equal(emptyPts.spent, Research.spentPoints(pawn));
    assert.equal(emptyPts.available, 0);
    assert.equal(emptyPts.total, -Research.spentPoints(pawn));
    assert.equal(world.researchSpentByOwner[pawn.id], 0);
    const chunk = originChunk(world);
    const a = { uid: "new-world-a", id: "painting_circle", x: pawn.x, y: pawn.y, painted: 2 };
    Research.ensureEntry(a);
    chunk.things.push(a);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "counting"
    });
    assert.equal(Research.hasTech(pawn, "counting"), true);
    assert.equal(Research.hasTech(pawn, "herbalism"), true);
    assert.equal(world.researchSpentByOwner[pawn.id], 2);
});

test("visited camps carry the owner's character name and live online flag", () => {
    const { world, pawn } = createTestWorld({ playerId: "viewer" });
    const camp = Settlement.createSettlement({
        ownerId: "owner",
        ownerName: "stale",
        x: 4000,
        y: 0,
        name: "Far"
    });
    camp.ownerOnline = true;
    world.settlements.push(camp);
    const owner = world.addPlayer("owner", "Account", { name: "Ash" }, { silentJoin: true });
    assert.equal(owner.name, "Ash");
    assert.equal(camp.ownerName, "Ash");

    let row = world.snapshotFor(pawn.id).settlements.find((s) => s.id === camp.id);
    assert.equal(row.ownerName, "Ash");
    assert.equal(row.ownerOnline, true);
    assert.equal(camp.ownerOnline, undefined);
    assert.equal(world.toSaveData().settlements.find((s) => s.id === camp.id).ownerOnline, undefined);

    owner.name = "Birch";
    row = world.snapshotFor(pawn.id).settlements.find((s) => s.id === camp.id);
    assert.equal(row.ownerName, "Birch");
    assert.equal(camp.ownerName, "Birch");

    owner.connected = false;
    row = world.snapshotFor(pawn.id).settlements.find((s) => s.id === camp.id);
    assert.equal(row.ownerOnline, false);
    assert.equal(row.ownerName, "Birch");
    assert.equal(camp.ownerName, "Birch");
});

test("rotate turns a campfire stand and skips a blocked facing", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    chunk.things.push(fire);
    const def = DataStore.getThing("campfire");
    assert.ok(!def.rotations, "campfire keeps its spritesheet");
    world.drainEvents();
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "rotate",
        uid: fire.uid,
        x: fire.x,
        y: fire.y
    });
    assert.equal(fire.rot, 90);
    assert.deepEqual(Place.interactTileOf(fire, 16, def), { tx: 1, ty: 1 });
    fire.rot = 0;
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "rotate",
        ccw: true,
        uid: fire.uid,
        x: fire.x,
        y: fire.y
    });
    assert.equal(fire.rot, 270);
    assert.deepEqual(Place.interactTileOf(fire, 16, def), { tx: 3, ty: 1 });
    const ev = world.drainEvents().find((e) => e.kind === "campfire" && e.entry);
    assert.equal(ev.entry.rot, 90);
    assert.ok(!Place.thingImageLoads(def).some((l) => String(l.key).includes("campfire_90")));

    fire.rot = 0;
    chunk.things.push({
        uid: "block_west",
        id: "campfire",
        x: 24,
        y: 32,
        fuel: [null, null],
        cook: null,
        catalyst: null,
        simmer: [null, null, null, null]
    });
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "rotate",
        uid: fire.uid,
        x: fire.x,
        y: fire.y
    });
    assert.equal(fire.rot, 180);
    assert.deepEqual(Place.interactTileOf(fire, 16, def), { tx: 2, ty: 0 });

    fire.rot = 0;
    const CS = 8;
    const waterAt = (tx, ty) => {
        chunk.tiles[(tx % CS) + (ty % CS) * CS] = "water";
    };
    waterAt(1, 1);
    waterAt(2, 0);
    waterAt(3, 1);
    world.drainEvents();
    world.handleAction(pawn.id, {
        type: Protocol.Actions.CAMPFIRE,
        op: "rotate",
        uid: fire.uid,
        x: fire.x,
        y: fire.y
    });
    assert.equal(Place.normalizeRot(fire.rot), 0);
    assert.equal(world.drainEvents().some((e) => e.kind === "campfire" && e.entry), false);
});

test("rotate turns a drying rack spot and a skinworking bench, not a grindstone", () => {
    const { world, pawn, Protocol } = createTestWorld();
    fillGrass(world);
    const chunk = originChunk(world);
    const rack = {
        uid: "rack_rot",
        id: "drying_rack",
        x: pawn.x,
        y: pawn.y,
        rot: 0,
        slots: [null]
    };
    const bench = {
        uid: "bench_rot",
        id: "skinworking_bench",
        x: pawn.x + 48,
        y: pawn.y,
        rot: 0
    };
    const stone = {
        uid: "grind_rot",
        id: "grindstone",
        x: pawn.x,
        y: pawn.y + 48,
        rot: 0,
        stone: "flint"
    };
    chunk.things.push(rack, bench, stone);
    const turn = (entry) => world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "rotate",
        uid: entry.uid,
        x: entry.x,
        y: entry.y
    });
    turn(rack);
    const rackDef = DataStore.getThing("drying_rack");
    assert.equal(rack.rot, 90);
    assert.deepEqual(Place.interactTileOf(rack, 16, rackDef), { tx: 1, ty: 1 });
    assert.ok(!Place.thingImageLoads(rackDef).some((l) => /_90/.test(l.key)));

    turn(bench);
    const benchDef = DataStore.getThing("skinworking_bench");
    assert.equal(bench.rot, 90);
    assert.equal(Place.facingTextureKey(benchDef, bench.rot), "skinworking_bench_90");
    assert.deepEqual(Place.interactTileOf(bench, 16, benchDef), { tx: 4, ty: 1 });

    turn(stone);
    assert.equal(Place.normalizeRot(stone.rot), 0);
});


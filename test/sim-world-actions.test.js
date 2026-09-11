const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs, DataStore, restoreRng, seedRng } = require("./helpers/load");
const Place = require("../shared/place");
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

    Research.unlock(settle, "counting");
    world.handleAction(pawn.id, { type: Protocol.Actions.CRAFT, id: "tally_stick" });
    assert.ok(pawn.inventory.some((s) => s?.id === "tally_stick"));
    assert.ok(!pawn.inventory.some((s) => s?.id === "bone"));
    assert.equal(pawn.inventory[0]?.toolClass, "knife");
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
    settle.techs.fire = false;
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const fire = testCampfire(pawn);
    fire.id = "unlit_campfire";
    fire.fuel[0] = { id: "stick", quantity: 8 };
    chunk.things.push(fire);
    pawn.inventory[0] = { id: "sharp_stick", quantity: 1, durability: 50 };
    pawn.hotbarIndex = 0;
    world.handleAction(pawn.id, { type: Protocol.Actions.LIGHT_FIRE, x: pawn.x, y: pawn.y });
    assert.equal(fire.id, "unlit_campfire");
    assert.equal(Research.techUnlocked("fire", settle), false);
    settle.techs.fire = true;
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

test("/kms aliases /kill", () => {
    const { world, pawn, Protocol } = createTestWorld();
    world.handleAction(pawn.id, { type: Protocol.Actions.CHAT, text: "/kms" });
    assert.equal(pawn.dead, true);
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
    assert.ok(dist > 4, `follower should still walk toward the leader (moved ${dist.toFixed(1)}px)`);
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
        stack: { id: "stone_tool", toolClass: "knife", knapDamage: 4, customName: "Knife" }
    });
    const tools = pawn.inventory.filter((s) => s && s.id === "stone_tool");
    const pebbles = pawn.inventory.reduce((n, s) => n + (s?.id === "pebble" ? (s.quantity || 0) : 0), 0);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].quantity, 1);
    assert.equal(pebbles, 2);
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

test("combat log names use party green, settler blue, and enemy red", () => {
    seedRng(5);
    const { world, pawn } = createTestWorld();
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
    assert.equal(line.segments[0].text, "You");
    assert.equal(line.segments[0].color, ALLY);
    const boarVic = line.segments.find((s) => /'s$/.test(s.text || ""));
    assert.ok(boarVic);
    assert.equal(boarVic.color, ENEMY);

    world.drainEvents();
    landHit(buddyC, boar);
    line = firstHitLine(world, pawn.id);
    assert.equal(line.segments[0].text, buddyC.displayName());
    assert.equal(line.segments[0].color, ALLY);

    world.drainEvents();
    landHit(settlerC, boar);
    line = firstHitLine(world, pawn.id);
    assert.equal(line.segments[0].text, settlerC.displayName());
    assert.equal(line.segments[0].color, SETTLER);

    world.drainEvents();
    landHit(boar, buddyC);
    line = firstHitLine(world, pawn.id);
    assert.equal(line.segments[0].color, ENEMY);
    const buddyVic = line.segments.find((s) => s.text === `${buddyC.displayName()}'s`);
    assert.ok(buddyVic);
    assert.equal(buddyVic.color, ALLY);

    world.drainEvents();
    landHit(boar, settlerC);
    line = firstHitLine(world, pawn.id);
    const setVic = line.segments.find((s) => s.text === `${settlerC.displayName()}'s`);
    assert.ok(setVic);
    assert.equal(setVic.color, SETTLER);
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
    assert.equal(cc._settlerAct, "Fighting");
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
    assert.equal(Research.recipeUnlocked("stick_frame", settle), false);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "basic_furniture"
    });
    assert.equal(Research.hasTech(settle, "basic_furniture"), true);
    assert.equal(a.painted, 2);
    assert.equal(b.painted, 2);
    assert.equal(Research.paintedTotal([a, b]), 4);
    assert.equal(Research.availableTotal([a, b], settle), 2);
    assert.equal(Research.recipeUnlocked("stick_frame", settle), true);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "hand_axe"
    });
    assert.equal(Research.hasTech(settle, "hand_axe"), false);
    assert.equal(Research.availableTotal([a, b], settle), 2);
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
        techId: "throwing"
    });
    assert.equal(Research.hasTech(settle, "hafting"), true);
    assert.equal(Research.hasTech(settle, "throwing"), true);
    assert.equal(Research.availableTotal([a], settle), 1);
});

test("unlockTech refuses fogged techs even with points and prereqs", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    const chunk = originChunk(world);
    const a = { uid: "pc-fog", id: "painting_circle", x: pawn.x, y: pawn.y, painted: 6 };
    Research.ensureEntry(a);
    chunk.things.push(a);
    Research.unlock(settle, "herbalism");
    Research.unlock(settle, "digging");
    Research.unlock(settle, "storage");
    assert.equal(Research.currentAge(settle), "Paleolithic");
    assert.equal(Research.techFogged(settle, "agriculture"), true);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "unlockTech",
        settlementId: settle.id,
        techId: "agriculture"
    });
    assert.equal(Research.hasTech(settle, "agriculture"), false);
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
    Research.unlock(settle, "writing");
    Research.unlock(settle, "agriculture");
    assert.equal(Research.spentPoints(settle), 20);
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
    Research.unlock(settle, "agriculture");
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
    assert.equal(Research.availableTotal([b, c], settle), 4);
});

test("installTally consumes a held tally stick", () => {
    const Research = require("../shared/research");
    const { world, pawn, Protocol } = createTestWorld();
    const settle = Settlement.createSettlement({ x: pawn.x, y: pawn.y, ownerId: pawn.id });
    world.settlements.push(settle);
    Research.unlock(settle, "counting");
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
    Research.unlock(settle, "hut");
    assert.equal(Research.spentPoints(settle), 4);
    world.handleAction(pawn.id, {
        type: Protocol.Actions.SETTLEMENT,
        op: "removeTally",
        settlementId: settle.id,
        uid: entry.uid
    });
    assert.equal(entry.tallyStick, true);
    assert.equal(pawn.inventory.some((s) => s && s.id === "tally_stick"), false);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Place = require("../shared/place");
const { createTestWorld, originChunk } = require("./helpers/simWorld");
const { loadDefs } = require("./helpers/load");

loadDefs();

test("natural brown and unknown colors are no dye", () => {
    assert.equal(Place.normalizeBasketDye(null), null);
    assert.equal(Place.normalizeBasketDye("6c552e"), null);
    assert.equal(Place.normalizeBasketDye("#6C552E"), null);
    assert.equal(Place.normalizeBasketDye("natural"), null);
    assert.equal(Place.normalizeBasketDye("ff00ff"), null);
    assert.equal(Place.basketDyeColor(null), "6c552e");
});

test("known dyes pass through and recolor the natural brown", () => {
    assert.equal(Place.normalizeBasketDye("3a6fbf"), "3a6fbf");
    assert.equal(Place.normalizeBasketDye("#C44536"), "c44536");
    const blue = Place.recolorBasketPixel(0x6c, 0x55, 0x2e, 255, "3a6fbf");
    assert.deepEqual(blue, [0x3a, 0x6f, 0xbf, 255]);
    const kept = Place.recolorBasketPixel(0x6c, 0x55, 0x2e, 255, null);
    assert.deepEqual(kept, [0x6c, 0x55, 0x2e, 255]);
    const clear = Place.recolorBasketPixel(0x6c, 0x55, 0x2e, 0, "c44536");
    assert.equal(clear[3], 0);
    assert.equal(Place.basketDyesMatch(
        { id: "wicker_basket", dye: "3a6fbf" },
        { id: "wicker_basket" }
    ), false);
    assert.equal(Place.basketDyesMatch(
        { id: "wicker_basket", dye: "3a6fbf" },
        { id: "wicker_basket", dye: "3A6FBF" }
    ), true);
    assert.equal(Place.basketDyesMatch({ id: "stick" }, { id: "stick", dye: "c44536" }), true);
    assert.equal(Place.basketDyesMatch(
        { id: "storage_pit", dye: "c44536" },
        { id: "storage_pit" }
    ), false);
    assert.equal(Place.basketDyesMatch(
        { id: "storage_pit", dye: "c44536" },
        { id: "wicker_basket", dye: "c44536" }
    ), false);
});

test("dye sticks to a basket through pickup and place, and different dyes do not stack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const basket = {
        uid: "st_dye",
        id: "wicker_basket",
        x: pawn.x,
        y: pawn.y
    };
    Place.ensureStorageEntry(basket, world._thingDef("wicker_basket"));
    chunk.things.push(basket);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "dye",
        uid: basket.uid,
        x: basket.x,
        y: basket.y,
        dye: "not-a-color"
    });
    assert.equal(basket.dye, undefined);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "dye",
        uid: basket.uid,
        x: basket.x,
        y: basket.y,
        dye: "#3A6FBF"
    });
    assert.equal(basket.dye, "3a6fbf");
    const pub = world._storagePublic(basket, chunk);
    assert.equal(pub.dye, "3a6fbf");

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: basket.uid,
        x: basket.x,
        y: basket.y
    });
    assert.equal(chunk.things.includes(basket), false);
    const held = pawn.inventory.find((s) => s && s.id === "wicker_basket");
    assert.equal(held.dye, "3a6fbf");
    assert.equal(held.quantity, 1);

    pawn.inventory[1] = { id: "wicker_basket", quantity: 1 };
    world._give(pawn, "wicker_basket", 1, { dye: "3a6fbf" });
    assert.equal(held.quantity, 2);
    const red = world._give(pawn, "wicker_basket", 1, { dye: "c44536" });
    assert.equal(red, 0);
    const stacks = pawn.inventory.filter((s) => s && s.id === "wicker_basket");
    assert.equal(stacks.length, 3);
    assert.equal(stacks.find((s) => !s.dye)?.quantity, 1);
    assert.equal(stacks.find((s) => s.dye === "3a6fbf")?.quantity, 2);
    assert.equal(stacks.find((s) => s.dye === "c44536")?.quantity, 1);

    for (const c of world.chunks.values()) c.tiles = Array(64).fill("grass");
    pawn.hotbarIndex = pawn.inventory.indexOf(stacks.find((s) => s.dye === "c44536"));
    world.handleAction(pawn.id, {
        type: Protocol.Actions.PLACE,
        tx: 2,
        ty: 1
    });
    const placed = (originChunk(world).things || []).find((t) => t.id === "wicker_basket");
    assert.ok(placed);
    assert.equal(placed.dye, "c44536");
});

test("storage pit dye survives pickup and place, and different dyes do not stack", () => {
    const { world, pawn, Protocol } = createTestWorld();
    const chunk = originChunk(world);
    const pit = {
        uid: "st_pit_dye",
        id: "storage_pit",
        x: pawn.x,
        y: pawn.y,
        digProgress: 0
    };
    Place.ensureStorageEntry(pit, world._thingDef("storage_pit"));
    chunk.things.push(pit);

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "dye",
        uid: pit.uid,
        x: pit.x,
        y: pit.y,
        dye: "3a6fbf"
    });
    assert.equal(pit.dye, "3a6fbf");
    assert.equal(world._storagePublic(pit, chunk).dye, "3a6fbf");

    world.handleAction(pawn.id, {
        type: Protocol.Actions.STORAGE,
        op: "pickup",
        uid: pit.uid,
        x: pit.x,
        y: pit.y
    });
    const held = pawn.inventory.find((s) => s && s.id === "storage_pit");
    assert.equal(held.dye, "3a6fbf");

    world._give(pawn, "storage_pit", 1, { dye: "c44536" });
    const stacks = pawn.inventory.filter((s) => s && s.id === "storage_pit");
    assert.equal(stacks.length, 2);

    for (const c of world.chunks.values()) c.tiles = Array(64).fill("grass");
    pawn.hotbarIndex = pawn.inventory.indexOf(stacks.find((s) => s.dye === "c44536"));
    world.handleAction(pawn.id, {
        type: Protocol.Actions.PLACE,
        tx: 2,
        ty: 1
    });
    const placed = (originChunk(world).things || []).find((t) => t.id === "storage_pit");
    assert.ok(placed);
    assert.equal(placed.dye, "c44536");
});

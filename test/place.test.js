const { test } = require("node:test");
const assert = require("node:assert/strict");
const Place = require("../shared/place");
const things = require("../data/Things.json");

const TS = 16;

function thingDef(id) {
    return things.find((t) => t && t.id === id);
}

function contains(rect, x, y) {
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

test("bench hitbox follows rotation instead of a 5×5 at the feet", () => {
    const def = thingDef("skinworking_bench");
    const x = 48;
    const y = 64;
    const r0 = Place.collisionWorldRect({ id: def.id, x, y, rot: 0 }, def, TS);
    assert.ok(r0);
    assert.ok(r0.right - r0.left >= 11, `0° should be wide, w=${r0.right - r0.left}`);
    assert.ok(r0.bottom - r0.top >= 6, `0° should cover the tabletop, h=${r0.bottom - r0.top}`);
    assert.ok(r0.top >= y - 8, "0° north slack lets you walk into the empty pixels above the bench");
    assert.equal(r0.bottom, y);
    assert.equal(contains(r0, x, y - 2), true);
    assert.equal(contains(r0, x - 5, y - 2), true, "covers the table ends a 5×5 would miss");
    assert.equal(contains(r0, x, y - 10), false, "sand above the bench is walkable");

    const r90 = Place.collisionWorldRect({ id: def.id, x, y, rot: 90 }, def, TS);
    assert.ok(r90.right - r90.left <= 7, `90° should be narrow, w=${r90.right - r90.left}`);
    assert.ok(r90.bottom - r90.top >= 10, `90° should be tall, h=${r90.bottom - r90.top}`);
    assert.equal(contains(r90, x, y - 8), true);
    assert.equal(contains(r90, x, y - 13), false, "north slack on the tall plank");
    assert.equal(contains(r90, x - 5, y - 2), false, "90° must not keep the 0° width");

    const r180 = Place.collisionWorldRect({ id: def.id, x, y, rot: 180 }, def, TS);
    assert.ok(r180.top < y - 10, "180° table sits at the north of the tile");
    assert.ok(r180.top >= y - 14, "180° north slack is not the full tile edge");
    assert.ok(r180.bottom <= y - 4, "180° must not keep a feet box in empty south pixels");
    assert.equal(contains(r180, x, y - 12), true);
    assert.equal(contains(r180, x, y - 15), false);
    assert.equal(contains(r180, x, y - 1), false);
});

test("grindstone placement rotates the stand tile and keeps variant art", () => {
    const def = thingDef("grindstone");
    assert.equal(Place.canRotate(def), true);
    const loads = Place.thingImageLoads(def).map((l) => l.key);
    assert.deepEqual(loads, ["grindstone_1", "grindstone_2"]);
    const x = 40;
    const y = 48;
    const e0 = { id: def.id, x, y, rot: 0 };
    const origin = Place.originTileOf(e0, TS);
    const t0 = Place.interactTileOf(e0, TS, def);
    assert.equal(t0.tx, origin.tx);
    assert.equal(t0.ty, origin.ty + 1);
    const t90 = Place.interactTileOf({ ...e0, rot: 90 }, TS, def);
    assert.equal(t90.tx, origin.tx - 1);
    assert.equal(t90.ty, origin.ty);
    const t180 = Place.interactTileOf({ ...e0, rot: 180 }, TS, def);
    assert.equal(t180.tx, origin.tx);
    assert.equal(t180.ty, origin.ty - 1);
    const t270 = Place.interactTileOf({ ...e0, rot: 270 }, TS, def);
    assert.equal(t270.tx, origin.tx + 1);
    assert.equal(t270.ty, origin.ty);
    const tiles = Place.placeOccupyTiles(origin.tx, origin.ty, 90, def);
    assert.equal(tiles.length, 2);
    assert.ok(tiles.some((t) => t.tx === origin.tx - 1 && t.ty === origin.ty));
});

test("skinworking bench interact tile is south at 0° and rotates with the bench", () => {
    const def = thingDef("skinworking_bench");
    const x = 40;
    const y = 48;
    const e0 = { id: def.id, x, y, rot: 0 };
    const origin = Place.originTileOf(e0, TS);
    const t0 = Place.interactTileOf(e0, TS, def);
    assert.equal(t0.tx, origin.tx);
    assert.equal(t0.ty, origin.ty + 1);
    const stand = Place.interactWorldPos(e0, TS, def);
    assert.equal(stand.x, t0.tx * TS + TS / 2);
    assert.equal(stand.y, t0.ty * TS + TS);

    const t90 = Place.interactTileOf({ ...e0, rot: 90 }, TS, def);
    assert.equal(t90.tx, origin.tx - 1);
    assert.equal(t90.ty, origin.ty);
    const t180 = Place.interactTileOf({ ...e0, rot: 180 }, TS, def);
    assert.equal(t180.tx, origin.tx);
    assert.equal(t180.ty, origin.ty - 1);
    const t270 = Place.interactTileOf({ ...e0, rot: 270 }, TS, def);
    assert.equal(t270.tx, origin.tx + 1);
    assert.equal(t270.ty, origin.ty);

    const rect = Place.collisionWorldRect(e0, def, TS);
    assert.equal(contains(rect, stand.x, stand.y - 2), false, "interact tile stays walkable");
});

test("skinworking bench interact tile occupies placement and blocks other things", () => {
    const def = thingDef("skinworking_bench");
    const basket = thingDef("wicker_basket");
    const tx = 4;
    const ty = 4;
    const tiles = Place.placeOccupyTiles(tx, ty, 0, def);
    assert.equal(tiles.length, 2);
    assert.ok(tiles.some((t) => t.tx === tx && t.ty === ty));
    assert.ok(tiles.some((t) => t.tx === tx && t.ty === ty + 1));

    const bench = {
        id: def.id,
        x: tx * TS + TS / 2,
        y: ty * TS + TS,
        rot: 0
    };
    assert.equal(Place.entryOnTile(bench, tx, ty + 1, TS, def), true);
    assert.equal(Place.canPlaceOnTile({
        tileKey: "grass",
        things: [bench],
        lootables: [],
        tx: tx,
        ty: ty + 1,
        tileSize: TS,
        getThing: (id) => id === def.id ? def : basket
    }), false);

    const onSpot = {
        id: "wicker_basket",
        x: tx * TS + TS / 2,
        y: (ty + 1) * TS + TS,
        rot: 0
    };
    assert.equal(Place.canPlaceOnTile({
        tileKey: "grass",
        things: [onSpot],
        lootables: [],
        tx: tx,
        ty: ty + 1,
        tileSize: TS,
        getThing: (id) => id === "wicker_basket" ? basket : def
    }), false);
    assert.equal(Place.canPlaceOnTiles(
        Place.placeOccupyTiles(tx, ty, 0, def),
        (otx, oty) => ({
            tileKey: "grass",
            things: otx === tx && oty === ty + 1 ? [onSpot] : [],
            lootables: [],
            tileSize: TS,
            getThing: (id) => id === "wicker_basket" ? basket : def
        })
    ), false);
});

test("drying rack hitbox covers both posts, not the gap between them", () => {
    const def = thingDef("drying_rack");
    const x = 40;
    const y = 48;
    const rect = Place.collisionWorldRect({ id: def.id, x, y, rot: 0 }, def, TS);
    assert.ok(rect, "drying rack is solid");
    assert.ok(rect.right - rect.left >= 12, "both posts are inside one solid");
    assert.equal(contains(rect, x - 5, y - 3), true, "left post");
    assert.equal(contains(rect, x + 5, y - 3), true, "right post");
    assert.equal(contains(rect, x, y - 3), true, "feet between the posts stay blocked");
    assert.equal(contains(rect, x, y - 12), false, "empty sky above the posts is walkable");
});

test("basket hitbox is wide at 0° and narrow at 90°", () => {
    const def = thingDef("wicker_basket");
    const x = 32;
    const y = 32;
    const r0 = Place.collisionWorldRect({ id: def.id, x, y, rot: 0 }, def, TS);
    const r90 = Place.collisionWorldRect({ id: def.id, x, y, rot: 90 }, def, TS);
    assert.ok(r0.right - r0.left > r90.right - r90.left);
    assert.ok(r0.right - r0.left >= 9);
    assert.ok(r90.right - r90.left <= 7);
    assert.ok(r0.top >= y - 9, "0° must not use the empty pixels above the handle");
    assert.equal(contains(r0, x, y - 11), false, "sand / handle above the basket body is walkable");
    assert.equal(contains(r0, x, y - 2), true);
});

test("lean-to facings are a floor and a wall", () => {
    const loads = Place.thingImageLoads(thingDef("lean_to"));
    assert.deepEqual(loads.map((l) => l.key), [
        "lean_to_floor_0", "lean_to_wall_0",
        "lean_to_floor_90", "lean_to_wall_90",
        "lean_to_floor_180", "lean_to_wall_180",
        "lean_to_floor_270", "lean_to_wall_270"
    ]);
    assert.deepEqual(loads.map((l) => l.path), [
        "assets/things/lean_to/floor_0.png",
        "assets/things/lean_to/wall_0.png",
        "assets/things/lean_to/floor_90.png",
        "assets/things/lean_to/wall_90.png",
        "assets/things/lean_to/floor_180.png",
        "assets/things/lean_to/wall_180.png",
        "assets/things/lean_to/floor_270.png",
        "assets/things/lean_to/wall_270.png"
    ]);
});

test("lean-to collision matches the wooden frame", () => {
    const def = thingDef("lean_to");
    const tx = 8;
    const ty = 8;

    const pos90 = Place.footprintWorldPos(tx, ty, 90, def.footprint, TS);
    const e90 = { id: "lean_to", tx, ty, rot: 90, x: pos90.x, y: pos90.y };
    const w90 = Place.collisionWorldRect(e90, def, TS);
    const tiles90 = Place.entryFootprintTiles(e90, TS, def);
    const left = Math.min(...tiles90.map((t) => t.tx)) * TS;
    const right = (Math.max(...tiles90.map((t) => t.tx)) + 1) * TS;
    const midY = (w90.top + w90.bottom) / 2;
    assert.ok(w90.left > left + 4, "rot 90 open west side is walkable");
    assert.equal(contains(w90, left + 3, midY), false, "bedding/west pixels are not solid");
    assert.equal(contains(w90, right - 2, midY), true, "wooden east back is solid");

    const pos270 = Place.footprintWorldPos(tx, ty, 270, def.footprint, TS);
    const e270 = { id: "lean_to", tx, ty, rot: 270, x: pos270.x, y: pos270.y };
    const w270 = Place.collisionWorldRect(e270, def, TS);
    const tiles270 = Place.entryFootprintTiles(e270, TS, def);
    const left270 = Math.min(...tiles270.map((t) => t.tx)) * TS;
    const right270 = (Math.max(...tiles270.map((t) => t.tx)) + 1) * TS;
    const mid270 = (w270.top + w270.bottom) / 2;
    assert.ok(w270.right < right270 - 4, "rot 270 open east side is walkable");
    assert.equal(contains(w270, right270 - 3, mid270), false, "bedding/east pixels are not solid");
    assert.equal(contains(w270, left270 + 2, mid270), true, "wooden west back is solid");

    const pos0 = Place.footprintWorldPos(tx, ty, 0, def.footprint, TS);
    const e0 = { id: "lean_to", tx, ty, rot: 0, x: pos0.x, y: pos0.y };
    const w0 = Place.collisionWorldRect(e0, def, TS);
    const tiles0 = Place.entryFootprintTiles(e0, TS, def);
    const top0 = Math.min(...tiles0.map((t) => t.ty)) * TS;
    const bottom0 = (Math.max(...tiles0.map((t) => t.ty)) + 1) * TS;
    const left0 = Math.min(...tiles0.map((t) => t.tx)) * TS;
    const right0 = (Math.max(...tiles0.map((t) => t.tx)) + 1) * TS;
    const midX = (w0.left + w0.right) / 2;
    assert.equal(w0.top, top0 + 6, "rot 0 north edge tucks under the roof");
    assert.equal(w0.bottom, bottom0);
    assert.equal(contains(w0, midX, top0 + 2), false, "rot 0 roof overhang is walkable");
    assert.equal(contains(w0, midX, top0 + 6), true, "rot 0 lower roof is still solid");
    assert.equal(contains(w0, midX, bottom0 - 2), true, "rot 0 south interior is solid");
    assert.equal(contains(w0, left0 + 2, bottom0 - 2), true, "rot 0 front posts are solid");
    assert.equal(contains(w0, right0 - 2, bottom0 - 2), true, "rot 0 front posts are solid");

    const pos180 = Place.footprintWorldPos(tx, ty, 180, def.footprint, TS);
    const e180 = { id: "lean_to", tx, ty, rot: 180, x: pos180.x, y: pos180.y };
    const w180 = Place.collisionWorldRect(e180, def, TS);
    const tiles180 = Place.entryFootprintTiles(e180, TS, def);
    const top180 = Math.min(...tiles180.map((t) => t.ty)) * TS;
    const bottom180 = (Math.max(...tiles180.map((t) => t.ty)) + 1) * TS;
    const mid180 = (w180.left + w180.right) / 2;
    assert.equal(w180.top, top180 + 6, "rot 180 north edge tucks under the roof");
    assert.equal(w180.bottom, bottom180);
    assert.equal(contains(w180, mid180, top180 + 2), false, "rot 180 roof overhang is walkable");
    assert.equal(contains(w180, mid180, top180 + 6), true, "rot 180 lower wall is still solid");
    assert.equal(contains(w180, mid180, bottom180 - 2), true, "rot 180 back wall is solid");

    const occupy = Place.footprintWorldRect(e0, def, TS);
    assert.ok(occupy);
    assert.equal(contains(occupy, midX, bottom0 - 2), true, "footprint covers the laying spot");
    assert.equal(contains(occupy, midX, top0 + 2), true);
    assert.equal(occupy.right - occupy.left, 32);
    assert.equal(occupy.bottom - occupy.top, 16);
});

test("itemIconKey uses null when the item has no texture", () => {
    const have = new Set(["stick", "null", "lean_to_floor_0"]);
    const has = (k) => have.has(k);
    assert.equal(Place.itemIconKey({ id: "stick", key: "stick" }, () => null, has), "stick");
    assert.equal(Place.itemIconKey({ id: "hut", key: "hut" }, () => null, has), "null");
    assert.equal(
        Place.itemIconKey(
            { id: "lean_to", key: "lean_to", place: { thing: "lean_to" } },
            () => ({ id: "lean_to", key: "lean_to", sleep: { slots: 2 }, rotations: [0, 90, 180, 270] }),
            has
        ),
        "lean_to_floor_0"
    );
});

test("figurines and unclassified lumps are held-placeable", () => {
    const items = require("../data/Items.json");
    const things = require("../data/Things.json");
    const figItem = items.find((i) => i && i.id === "clay_figurine");
    const figThing = things.find((t) => t && t.id === "clay_figurine");
    assert.equal(figItem.place.thing, "clay_figurine");
    assert.equal(figThing.figurine, true);
    assert.equal(figThing.hitboxSize, 0);
    assert.deepEqual(Place.thingImageLoads(figThing), []);
    assert.equal(Place.placeThingId(figItem), "clay_figurine");
    assert.equal(Place.heldPlaceThingId(figItem, { id: "clay_figurine", formClass: "human" }), "clay_figurine");
    assert.equal(Place.heldPlaceThingId(figItem, { id: "clay_figurine", formClass: "animal" }), "clay_figurine");
    assert.equal(Place.heldPlaceThingId(figItem, { id: "clay_figurine", formClass: "deity" }), "clay_figurine");
    assert.equal(Place.heldPlaceThingId(figItem, { id: "clay_figurine", formClass: "lump" }), "clay_figurine");
    assert.equal(Place.heldPlaceThingId(figItem, { id: "clay_figurine" }), "clay_figurine");
    assert.equal(Place.heldPlaceThingId({ id: "clay" }, { id: "clay" }), null);
    assert.equal(Place.collisionWorldRect({ id: "clay_figurine", x: 8, y: 16 }, figThing, 16), null);
    assert.equal(Place.canRotate(figThing), true);
});

test("storage tooltip sums stacks of the same item without touching the slots", () => {
    const slots = [
        { id: "stick", quantity: 2 },
        null,
        { id: "stick", quantity: 2 },
        { id: "blueberry", quantity: 2 },
        { id: "stick", quantity: 2 },
        { id: "flint", quantity: 99 },
        { id: "flint", quantity: 99 },
        null
    ];
    const tip = Place.storageTooltipStacks(slots, 8);
    assert.deepEqual(tip.map((s) => [s.id, s.quantity]), [
        ["stick", 6],
        ["blueberry", 2],
        ["flint", 198]
    ]);
    assert.equal(slots[0].quantity, 2);
    assert.equal(slots[5].quantity, 99);
    assert.notEqual(tip[0], slots[0]);
});

test("storage tooltip keeps first-seen order, left to right then down", () => {
    // Pit is 2×3. Top row is the first three slots.
    const slots = [
        { id: "blueberry", quantity: 1 },
        { id: "stick", quantity: 2 },
        { id: "blueberry", quantity: 4 },
        { id: "flint", quantity: 1 },
        { id: "stick", quantity: 99 },
        { id: "leaf", quantity: 3 }
    ];
    const tip = Place.storageTooltipStacks(slots, 6);
    assert.deepEqual(tip.map((s) => [s.id, s.quantity]), [
        ["blueberry", 5],
        ["stick", 101],
        ["flint", 1],
        ["leaf", 3]
    ]);
});

test("storage tooltip rows match the container width", () => {
    const distinct = ["a", "b", "c", "d", "e"].map((id) => ({ id, quantity: 1 }));
    const basket = Place.storageTooltipRows(distinct, 8);
    assert.equal(Place.storageLayoutCols(8), 4);
    assert.deepEqual(basket.map((row) => row.map((s) => s.id)), [
        ["a", "b", "c", "d"],
        ["e"]
    ]);
    const pit = Place.storageTooltipRows(distinct.slice(0, 4), 6);
    assert.equal(Place.storageLayoutCols(6), 3);
    assert.deepEqual(pit.map((row) => row.map((s) => s.id)), [
        ["a", "b", "c"],
        ["d"]
    ]);
});

test("storage tooltip keeps unlike stacks apart", () => {
    const slots = [
        { id: "pebble", quantity: 3, stone: "granite" },
        { id: "pebble", quantity: 4, stone: "limestone" },
        { id: "pebble", quantity: 1, stone: "granite" },
        { id: "hand_axe", quantity: 1, toolClass: "hand_axe" },
        { id: "hand_axe", quantity: 1, toolClass: "hand_axe" }
    ];
    const tip = Place.storageTooltipStacks(slots, slots.length);
    assert.deepEqual(tip.map((s) => [s.id, s.quantity, s.stone || s.toolClass]), [
        ["pebble", 4, "granite"],
        ["pebble", 4, "limestone"],
        ["hand_axe", 1, "hand_axe"],
        ["hand_axe", 1, "hand_axe"]
    ]);
});

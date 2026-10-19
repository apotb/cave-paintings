const { test } = require("node:test");
const assert = require("node:assert/strict");
const Stone = require("../shared/stone");
const SF = require("../shared/storageFilter");
const WorldGen = require("../shared/sim/WorldGen");
const Content = require("../shared/mods/content");
const { loadDefs } = require("./helpers/load");

loadDefs();
Content.boot({ mods: false });

test("each climate's wide band is its preferred stone", () => {
    assert.equal(Stone.pickStone(-0.1, 0, 0.1, "gravel"), "limestone");
    assert.equal(Stone.pickStone(-0.18, -0.5, 0.1, "snow_beach"), "limestone");
    assert.equal(Stone.pickStone(0.1, 0.6, 0.1, "sand"), "sandstone");
    assert.equal(Stone.pickStone(0.4, 0.6, 0.1, "mesa"), "sandstone");
    assert.equal(Stone.pickStone(0.05, 0, 0.1, "grass"), "andesite");
    assert.equal(Stone.pickStone(0.2, 0, 0.1, "grass_hill"), "andesite");
    assert.equal(Stone.pickStone(0.1, -0.5, 0.1, "snow"), "diorite");
    assert.equal(Stone.pickStone(0.4, -0.5, 0.1, "snow_mountain"), "diorite");
    assert.equal(Stone.pickStone(0.4, 0, 0.1, "mountain"), "granite");
});

test("nearby noise in one climate stays one stone, and the pick is stable", () => {
    const a = Stone.pickStone(0.05, 0, 0.2, "grass");
    const b = Stone.pickStone(0.05, 0, 0.4, "grass");
    assert.equal(a, "andesite");
    assert.equal(b, "andesite");
    assert.equal(Stone.pickStone(0.4, 0, 0.1, "mountain"), Stone.pickStone(0.4, 0, 0.1, "mountain"));
});

test("palette swap maps the two grays and leaves transparency alone", () => {
    const data = new Uint8ClampedArray([
        0x71, 0x71, 0x71, 255,
        0x4d, 0x4d, 0x4d, 255,
        10, 20, 30, 0
    ]);
    Stone.recolorImageData(data, "granite");
    assert.deepEqual(Array.from(data), [
        0xc4, 0xa9, 0x9a, 255,
        0x8a, 0x6a, 0x62, 255,
        10, 20, 30, 0
    ]);
    const same = new Uint8ClampedArray([0x71, 0x71, 0x71, 255]);
    Stone.recolorImageData(same, "andesite");
    assert.deepEqual(Array.from(same), [0x71, 0x71, 0x71, 255]);
});

test("enclosed transparent pixels become the secondary color", () => {
    const w = 3;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 0xff;
        data[i + 1] = 0xff;
        data[i + 2] = 0xff;
        data[i + 3] = 255;
    }
    const hole = (1 * w + 1) * 4;
    data[hole + 3] = 0;
    const edge = 0;
    data[edge + 3] = 0;
    Stone.recolorImageData(data, "andesite");
    Stone.fillEnclosedTransparent(data, w, h, "andesite");
    assert.equal(data[edge + 3], 0);
    assert.deepEqual(Array.from(data.slice(hole, hole + 4)), [0x4d, 0x4d, 0x4d, 255]);
});

test("shade marks stamp the secondary color onto the body", () => {
    const body = new Uint8ClampedArray([
        0x71, 0x71, 0x71, 255,
        0x71, 0x71, 0x71, 255
    ]);
    const marks = new Uint8ClampedArray([
        0, 0, 0, 0,
        255, 255, 255, 255
    ]);
    Stone.recolorImageData(body, "granite");
    Stone.stampSecondary(body, marks, "granite");
    assert.deepEqual(Array.from(body.slice(0, 4)), [0xc4, 0xa9, 0x9a, 255]);
    assert.deepEqual(Array.from(body.slice(4, 8)), [0x8a, 0x6a, 0x62, 255]);
});

test("a stone token accepts the id or the display name", () => {
    assert.equal(Stone.fromToken("granite"), "granite");
    assert.equal(Stone.fromToken("Limestone"), "limestone");
    assert.equal(Stone.fromToken("sand-stone"), null);
    assert.equal(Stone.fromToken("pebble"), null);
    assert.equal(Stone.fromToken("flint"), null);
    assert.equal(Stone.fromToken("5"), null);
    assert.equal(Stone.stuffId("stone_spear", "flint"), "flint");
    assert.equal(Stone.stuffId("stone_spear", "Flint"), "flint");
    assert.equal(Stone.stuffId("stone_spear", "granite"), "granite");
    assert.equal(Stone.stuffId("pebble", "flint"), null);
    assert.equal(Stone.stuffId("grindstone", "flint"), null);
    assert.equal(Stone.stuffId("rock", "flint"), null);
});

test("pebble stacks of different stones do not merge, and a blank is andesite", () => {
    assert.equal(SF.stacksMatch(
        { id: "pebble", quantity: 1, stone: "granite" },
        { id: "pebble", quantity: 1, stone: "limestone" }
    ), false);
    assert.equal(SF.stacksMatch(
        { id: "pebble", quantity: 1 },
        { id: "pebble", quantity: 1, stone: "andesite" }
    ), true);
    assert.equal(SF.stacksMatch({ id: "stick", quantity: 1 }, { id: "stick", quantity: 1 }), true);
    assert.equal(Stone.displayName({ id: "pebble" }), "Andesite Pebble");
    assert.equal(Stone.displayName({ id: "pebble", stone: "granite" }), "Granite Pebble");
    assert.equal(Stone.displayName({ id: "grindstone" }), "Andesite Grindstone");
    assert.equal(Stone.displayName({ id: "grindstone", stone: "diorite" }), "Diorite Grindstone");
    assert.equal(Stone.displayName({ id: "grindstone", stone: "granite" }), "Granite Grindstone");
    assert.equal(Stone.displayName({ id: "painting_circle" }), "Andesite Painting Circle");
    assert.equal(Stone.displayName({ id: "painting_circle", stone: "granite" }), "Granite Painting Circle");
    assert.equal(Stone.displayName({ id: "painting_circle", stone: "diorite" }), "Diorite Painting Circle");
    assert.equal(Stone.isStuffableItem("grindstone"), true);
    assert.equal(Stone.isStuffableItem("painting_circle"), true);
    assert.equal(Stone.craftTakesStuff("painting_circle"), true);
    assert.equal(Stone.stuffId("painting_circle", "flint"), null);
    assert.equal(Stone.stuffId("painting_circle", "granite"), "granite");
    assert.equal(SF.stacksMatch(
        { id: "painting_circle", quantity: 1, stone: "granite" },
        { id: "painting_circle", quantity: 1, stone: "diorite" }
    ), false);
    assert.equal(SF.stacksMatch(
        { id: "painting_circle", quantity: 1 },
        { id: "painting_circle", quantity: 1, stone: "andesite" }
    ), true);
    assert.equal(Stone.isStuffableItem("stone_spear"), true);
    assert.equal(Stone.isStuffableItem("wooden_spear"), false);
    assert.equal(Stone.craftTakesStuff("pebble"), false);
    assert.equal(Stone.craftTakesStuff("grindstone"), true);
    assert.equal(SF.stacksMatch(
        { id: "grindstone", quantity: 1, stone: "granite" },
        { id: "grindstone", quantity: 1, stone: "diorite" }
    ), false);
    assert.equal(SF.stacksMatch(
        { id: "grindstone", quantity: 1 },
        { id: "grindstone", quantity: 1, stone: "andesite" }
    ), true);
    assert.equal(Stone.rockLabel({ stone: "diorite" }), "Diorite Rock");
    assert.equal(Stone.handAxeGate("diorite"), null);
    assert.equal(Stone.handAxeGate("granite"), "brittle");
    assert.equal(Stone.handAxeGate("limestone"), "soft");
    assert.ok(Stone.durationScale("limestone") > Stone.durationScale("andesite"));
    assert.ok(Stone.durationScale("granite") < Stone.durationScale("andesite"));
});

test("craft preview follows the first stuff stack and clears when it is gone", () => {
    const spear = {
        id: "stone_spear",
        ingredients: [
            { id: "wooden_spear", qty: 1 },
            { id: "stone_tool", qty: 1, toolClass: "spear_tip" },
            { id: "leaf_cord", qty: 2 }
        ]
    };
    const hotbar = [
        { id: "stone_tool", quantity: 1, toolClass: "knife", knapMaterial: "pebble", stone: "granite" },
        { id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "pebble", stone: "diorite", knapQuality: "fine" },
        { id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "flint" }
    ];
    const diorite = Stone.craftPreviewStack(spear, [hotbar]);
    assert.equal(diorite.stone, "diorite");
    assert.equal(diorite.knapQuality, "fine");
    assert.equal(Stone.displayName(diorite), "Fine Diorite Spear");

    hotbar[1] = { id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "pebble", stone: "limestone" };
    assert.equal(Stone.craftPreviewStack(spear, [hotbar]).stone, "limestone");

    hotbar[1] = null;
    assert.equal(Stone.craftPreviewStack(spear, [hotbar]).knapMaterial, "flint");
    assert.equal(Stone.displayName(Stone.craftPreviewStack(spear, [hotbar])), "Flint Spear");

    hotbar[2] = null;
    assert.equal(Stone.craftPreviewStack(spear, [hotbar]), null);

    const fromPack = Stone.craftPreviewStack(spear, [
        [],
        [{ id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "pebble", stone: "sandstone" }]
    ]);
    assert.equal(fromPack.stone, "sandstone");
    const hotbarWins = Stone.craftPreviewStack(spear, [
        [{ id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "pebble", stone: "granite" }],
        [{ id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "pebble", stone: "sandstone" }]
    ]);
    assert.equal(hotbarWins.stone, "granite");
    const fromBasket = Stone.craftPreviewStack(spear, [
        [],
        [],
        [{ id: "stone_tool", quantity: 1, toolClass: "spear_tip", knapMaterial: "pebble", stone: "limestone" }]
    ]);
    assert.equal(fromBasket.stone, "limestone");
});

test("grindstone preview uses the first pebble, and other recipes stay plain", () => {
    const grind = { id: "grindstone", ingredients: [{ id: "pebble", qty: 3 }] };
    const bags = [[
        { id: "leaf", quantity: 4 },
        { id: "pebble", quantity: 1, stone: "granite" },
        { id: "pebble", quantity: 5, stone: "limestone" }
    ]];
    const granite = Stone.craftPreviewStack(grind, bags);
    assert.equal(granite.stone, "granite");
    assert.equal(Stone.displayName(granite), "Granite Grindstone");

    bags[0][1] = { id: "pebble", quantity: 1, stone: "diorite" };
    assert.equal(Stone.craftPreviewStack(grind, bags).stone, "diorite");

    bags[0][1] = null;
    bags[0][2] = null;
    assert.equal(Stone.craftPreviewStack(grind, bags), null);

    const plain = Stone.craftPreviewStack(grind, [[
        { id: "pebble", quantity: 3 }
    ]]);
    assert.equal(plain.stone, "andesite");
    assert.equal(Stone.displayName(plain), "Andesite Grindstone");

    const stick = { id: "sharp_stick", ingredients: [{ id: "stick", qty: 1 }] };
    assert.equal(Stone.craftPreviewStack(stick, bags), null);
    const circle = { id: "painting_circle", ingredients: [{ id: "pebble", qty: 12 }, { id: "leaf_cord", qty: 6 }] };
    const graniteCircle = Stone.craftPreviewStack(circle, [[
        { id: "pebble", quantity: 12, stone: "granite" }
    ]]);
    assert.equal(graniteCircle.stone, "granite");
    assert.equal(Stone.displayName(graniteCircle), "Granite Painting Circle");
    assert.equal(Stone.craftPreviewStack(circle, [[]]), null);

    const settling = {
        id: "settling_stone",
        ingredients: [{ id: "pebble", qty: 8 }]
    };
    assert.equal(Stone.craftPreviewStack(settling, [[
        { id: "pebble", quantity: 8, stone: "granite" }
    ]]), null);
});

test("new ground stamps stone without an extra decor roll", () => {
    let calls = 0;
    const tile = WorldGen.generateTileKey(160, 160, () => {
        calls += 1;
        return 0.5;
    });
    assert.equal(calls, 1);
    assert.ok(tile.key);

    let found = null;
    for (let ty = 0; ty < 12000 && !found; ty += 48) {
        for (let tx = 0; tx < 12000 && !found; tx += 48) {
            const next = WorldGen.generateTileKey(tx, ty, () => 0.182);
            const rock = (next.things || []).find((t) => t && t.id === "rock");
            if (rock?.stone && (rock.variant === 1 || rock.variant === 2)) {
                found = { tx, ty, stone: rock.stone };
            }
        }
    }
    assert.ok(found, "a grass rock spawn exists");
    const again = WorldGen.generateTileKey(found.tx, found.ty, () => 0.182);
    const rock = again.things.find((t) => t && t.id === "rock");
    assert.equal(rock.stone, found.stone);
    const neighbor = WorldGen.generateTileKey(found.tx + 16, found.ty, () => 0.182);
    const beside = (neighbor.things || []).find((t) => t && t.id === "rock");
    if (beside) assert.equal(beside.stone, found.stone);
});

test("a pebble pile can sit on the tile next to a rock and share its stone", () => {
    const chunk = WorldGen.generateChunk(3, -5, 42);
    const again = WorldGen.generateChunk(3, -5, 42);
    assert.deepEqual(again.lootableThings, chunk.lootableThings);
    const beside = (entry, rock) => {
        if (!rock || rock.id !== "rock" || rock.uid !== entry.parentUid) return false;
        if (rock.stone !== entry.stone) return false;
        const dx = Math.abs(rock.x - entry.x);
        const dy = Math.abs(rock.y - entry.y);
        return dx <= 16 && dy <= 16 && (dx > 0 || dy > 0);
    };
    let pile = chunk.lootableThings.find((entry) => entry.id === "pebbles" && chunk.things.some((rock) => beside(entry, rock)));
    if (!pile) {
        for (let cy = -6; cy <= 6 && !pile; cy++) {
            for (let cx = -6; cx <= 6 && !pile; cx++) {
                const next = WorldGen.generateChunk(cx, cy, 42);
                pile = next.lootableThings.find((entry) => entry.id === "pebbles" && next.things.some((rock) => beside(entry, rock)));
            }
        }
    }
    assert.ok(pile, "a rock has a neighboring pebble pile of the same stone");
});

test("queueTextures does not request the old pebble item icon", () => {
    const scene = {
        load: {
            image(key, url) { this._queued.push({ key, url }); },
            spritesheet(key, url) { this._queued.push({ key, url }); }
        },
        textures: { exists: () => false },
        __cpQueuedTextures: new Set(),
        _queued: []
    };
    scene.load._queued = scene._queued;
    Content.queueTextures(scene);
    assert.equal(scene._queued.some((q) => q.url === "assets/items/pebble.png"), false);
    assert.ok(scene._queued.some((q) => q.key === "pebble_1" && q.url === "assets/things/pebble_1.png"));
});

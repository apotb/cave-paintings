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
    assert.equal(Stone.rockLabel({ stone: "diorite" }), "Diorite Rock");
    assert.equal(Stone.handAxeGate("diorite"), null);
    assert.equal(Stone.handAxeGate("granite"), "brittle");
    assert.equal(Stone.handAxeGate("limestone"), "soft");
    assert.ok(Stone.durationScale("limestone") > Stone.durationScale("andesite"));
    assert.ok(Stone.durationScale("granite") < Stone.durationScale("andesite"));
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
    const pile = chunk.lootableThings.find((entry) => entry.id === "pebbles" && chunk.things.some((rock) => {
        if (rock.id !== "rock" || rock.stone !== entry.stone) return false;
        const dx = Math.abs(rock.x - entry.x);
        const dy = Math.abs(rock.y - entry.y);
        return (dx === 16 && dy === 0) || (dx === 0 && dy === 16);
    }));
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

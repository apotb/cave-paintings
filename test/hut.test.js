const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const { loadDefs, DataStore } = require("./helpers/load");
const Place = require("../shared/place");
const Sleep = require("../shared/sleep");
const Research = require("../shared/research");
const Settlement = require("../shared/settlement");

loadDefs();

const TS = 16;

function thingDef(id) {
    return DataStore.getThing(id);
}

function hit(rects, x, y) {
    return rects.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
}

/** 2-bit indexed hut_wall.png, decoded once. */
function wallOpaqueGrid() {
    const data = fs.readFileSync(path.join(__dirname, "../assets/things/hut/hut_wall.png"));
    let pos = 8;
    let w = 0;
    let h = 0;
    let bit = 0;
    let idat = Buffer.alloc(0);
    let trns = null;
    while (pos < data.length) {
        const ln = data.readUInt32BE(pos);
        const typ = data.slice(pos + 4, pos + 8).toString();
        const chunk = data.slice(pos + 8, pos + 8 + ln);
        pos += 12 + ln;
        if (typ === "IHDR") {
            w = chunk.readUInt32BE(0);
            h = chunk.readUInt32BE(4);
            bit = chunk[8];
        } else if (typ === "tRNS") trns = chunk;
        else if (typ === "IDAT") idat = Buffer.concat([idat, chunk]);
        else if (typ === "IEND") break;
    }
    const raw = zlib.inflateSync(idat);
    const rowBytes = Math.ceil((w * bit) / 8);
    const rows = [];
    let i = 0;
    let prev = Buffer.alloc(rowBytes);
    const paeth = (a, b, c) => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    };
    for (let yy = 0; yy < h; yy++) {
        const filt = raw[i++];
        const row = Buffer.from(raw.slice(i, i + rowBytes));
        i += rowBytes;
        if (filt === 1) {
            for (let xx = 0; xx < rowBytes; xx++) row[xx] = (row[xx] + (xx ? row[xx - 1] : 0)) & 255;
        } else if (filt === 2) {
            for (let xx = 0; xx < rowBytes; xx++) row[xx] = (row[xx] + prev[xx]) & 255;
        } else if (filt === 3) {
            for (let xx = 0; xx < rowBytes; xx++) {
                row[xx] = (row[xx] + (((xx ? row[xx - 1] : 0) + prev[xx]) >> 1)) & 255;
            }
        } else if (filt === 4) {
            for (let xx = 0; xx < rowBytes; xx++) {
                row[xx] = (row[xx] + paeth(xx ? row[xx - 1] : 0, prev[xx], xx ? prev[xx - 1] : 0)) & 255;
            }
        } else if (filt !== 0) {
            throw new Error(`filt ${filt}`);
        }
        rows.push(row);
        prev = row;
    }
    const grid = [];
    for (let yy = 0; yy < h; yy++) {
        const row = [];
        for (let xx = 0; xx < w; xx++) {
            const bitpos = xx * bit;
            const byte = rows[yy][bitpos >> 3];
            const shift = 8 - bit - (bitpos % 8);
            const idx = (byte >> shift) & ((1 << bit) - 1);
            const a = trns && idx < trns.length ? trns[idx] : 255;
            row.push(a >= 16);
        }
        grid.push(row);
    }
    return grid;
}

const WALL_OPAQUE = wallOpaqueGrid();

function placed(rot) {
    return { id: "hut", tx: 0, ty: 1, rot, x: 16, y: 32 };
}

test("hut footprint is a 2x2 square and a lean-to stays a strip", () => {
    const hut = thingDef("hut");
    const seen = new Set();
    for (const rot of [0, 90, 180, 270]) {
        const tiles = Place.footprintTiles(4, 6, rot, hut.footprint);
        assert.equal(tiles.length, 4, `rot ${rot}`);
        const keys = tiles.map((t) => `${t.tx},${t.ty}`);
        assert.equal(new Set(keys).size, 4, `rot ${rot} unique`);
        for (const k of keys) seen.add(`${rot}:${k}`);
    }
    const south = Place.footprintTiles(4, 6, 0, hut.footprint);
    assert.deepEqual(south.map((t) => [t.tx, t.ty]).sort(), [[4, 5], [4, 6], [5, 5], [5, 6]]);
    const lean = Place.footprintTiles(4, 6, 0, [2, 1]);
    assert.deepEqual(lean.map((t) => [t.tx, t.ty]), [[4, 6], [5, 6]]);
    const lean90 = Place.footprintTiles(4, 6, 90, [2, 1]);
    assert.equal(lean90.length, 2);
});

test("hut beds sit on the leaf patches and turn with the building", () => {
    const def = thingDef("hut");
    const entry = placed(0);
    const anchor = Place.spriteAnchor(entry, def, TS);
    assert.equal(anchor.x, 16);
    assert.equal(anchor.y, 32);
    const expect = [
        [9.5, 12.7],
        [22.5, 12.4],
        [9.5, 19.7],
        [22.3, 19.3]
    ];
    for (let i = 0; i < 4; i++) {
        const pos = Sleep.sleeperWorldPos(entry, i, TS, def);
        assert.ok(Math.abs(pos.x - expect[i][0]) < 0.05, `slot ${i} x ${pos.x}`);
        assert.ok(Math.abs(pos.y - expect[i][1]) < 0.05, `slot ${i} y ${pos.y}`);
    }
    const turned = Sleep.sleeperWorldPos({ ...entry, rot: 90 }, 0, TS, def);
    const off = Place.rotateAnchorOffset(-6.5, -19.3, 90, 32);
    const anchor90 = Place.spriteAnchor({ ...entry, rot: 90 }, def, TS);
    assert.ok(Math.abs(turned.x - (anchor90.x + off.dx)) < 0.05);
    assert.ok(Math.abs(turned.y - (anchor90.y + off.dy)) < 0.05);
    assert.equal(Sleep.restRotation(0, def), Math.PI / 2);
    assert.equal(Sleep.restRotation(90, def), Math.PI);
    assert.equal(Sleep.restRotation(180, def), -Math.PI / 2);
    assert.equal(Sleep.restRotation(270, def), 0);
    assert.equal(Sleep.restRotation(0, thingDef("lean_to")), Math.PI / 2);
});

test("hut wall mask matches the sprite and the doorway stays walkable", () => {
    const def = thingDef("hut");
    for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
            assert.equal(
                Place.wallMaskSolid(def.wallMask, x, y, 32),
                WALL_OPAQUE[y][x],
                `mask ${x},${y}`
            );
        }
    }
    const entry = placed(0);
    const rects = Place.collisionWorldRects(entry, def, TS);
    assert.ok(rects.length > 4);
    assert.equal(hit(rects, 16.5, 16.5), false, "interior");
    assert.equal(hit(rects, 2.5, 10.5), true, "west wall");
    assert.equal(Place.doorClearsPixel(def, 10, 29), true);
    assert.equal(hit(rects, 10.5, 29.5), false, "inner door post is carved open");
    assert.equal(hit(rects, 9.5, 29.5), true, "door jamb stays solid");
    let bodyBlocked = false;
    for (let y = 24; y < 32; y++) {
        for (let x = 12; x < 20; x++) {
            if (hit(rects, x + 0.5, y + 0.5)) bodyBlocked = true;
        }
    }
    assert.equal(bodyBlocked, false, "8px body fits the south door");

    const turned = Place.collisionWorldRects({ ...entry, rot: 90 }, def, TS);
    const anchor = Place.spriteAnchor({ ...entry, rot: 90 }, def, TS);
    const door = Place.rotateAnchorOffset(15.5 - 16, 29.5 - 32, 90, 32);
    assert.equal(hit(turned, anchor.x + door.dx, anchor.y + door.dy), false, "door follows rotation");
    const wall = Place.rotateAnchorOffset(2.5 - 16, 10.5 - 32, 90, 32);
    assert.equal(hit(turned, anchor.x + wall.dx, anchor.y + wall.dy), true, "wall follows rotation");
});

test("hut is researched after camping and crafts just after the lean-to", () => {
    const items = require("../data/Items.json");
    const ids = items.filter(Boolean).map((it) => it.id);
    assert.equal(ids.indexOf("hut"), ids.indexOf("lean_to") + 1);
    const item = DataStore.getItem("hut");
    assert.equal(item.recipe.log, 12);
    assert.equal(item.recipe.stick, 20);
    assert.equal(item.recipe.leaf_cord, 12);
    assert.equal(item.recipe.leaf, 40);
    assert.equal(item.recipe.stick_frame, 4);
    assert.equal(Research.techIsWip("hut"), false);
    assert.ok(Research.techById("hut").unlocks.items.includes("hut"));
    const s = Settlement.createSettlement({ x: 0, y: 0, ownerId: "p1" });
    assert.equal(Research.recipeUnlocked("hut", s), false);
    Research.unlock(s, "hut");
    assert.equal(Research.recipeUnlocked("hut", s), true);
    assert.equal(Sleep.healBonus(thingDef("hut")), 12);
    assert.equal(Sleep.healBonus(thingDef("lean_to")), 8);
    const loads = Place.thingImageLoads(thingDef("hut"));
    assert.deepEqual(loads.map((l) => l.path), [
        "assets/things/hut/hut_floor.png",
        "assets/things/hut/hut_wall.png"
    ]);
});

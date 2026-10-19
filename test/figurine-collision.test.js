const { test } = require("node:test");
const assert = require("node:assert/strict");
const Forming = require("../shared/forming");
const Place = require("../shared/place");
const { loadDefs } = require("./helpers/load");
const { createTestWorld, originChunk } = require("./helpers/simWorld");

loadDefs();

const things = require("../data/Things.json");
const figThing = things.find((t) => t && t.id === "clay_figurine");

function fillColumns(grid, x0, x1, z0, z1) {
    for (let x = x0; x < x1; x++) {
        for (let z = z0; z < z1; z++) grid[x][0][z] = true;
    }
}

function entryAt(grid, rot = 0) {
    return {
        id: "clay_figurine",
        uid: "fig",
        x: 24,
        y: 32,
        rot,
        formVoxels: Forming.pack(grid)
    };
}

function contains(rect, x, y) {
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function hit(rects, x, y) {
    return rects.some((r) => contains(r, x, y));
}

test("walk solid is a short strip on the feet", () => {
    const body = Place.walkBodyAt(40, 48, 16, 16, 8);
    assert.equal(body.left, 44);
    assert.equal(body.right, 52);
    assert.equal(body.bottom, 48);
    assert.equal(body.top, 44);
    assert.equal(body.bottom - body.top, 4);
});

test("figurine blocks follow filled clay and ignore a thin arm", () => {
    const grid = Forming.emptyGrid();
    fillColumns(grid, 4, 12, 4, 8);
    fillColumns(grid, 0, 1, 4, 8);
    const rects = Place.collisionWorldRects(entryAt(grid), figThing, 16);
    assert.ok(rects.length >= 1);
    assert.equal(hit(rects, 24, 22), true, "the body of the sculpture blocks");
    assert.equal(hit(rects, 20.5, 22), true, "the solid reaches the clay, without an extra inset");
    assert.equal(hit(rects, 16.5, 22), false, "a one-column arm does not snag");
    const wide = rects.reduce((n, r) => n + (r.right - r.left), 0);
    assert.ok(wide > 4, `wide clay should cover more than one cell, got ${wide}`);
});

test("a speck of clay still has a core block", () => {
    const grid = Forming.emptyGrid();
    grid[8][0][8] = true;
    const rects = Place.collisionWorldRects(entryAt(grid), figThing, 16);
    assert.equal(rects.length, 1);
    assert.equal(hit(rects, 25, 25), true);
    assert.ok(rects[0].right - rects[0].left <= 2);
    assert.ok(rects[0].bottom - rects[0].top <= 2);
});

test("figurine blocks yaw with place rotation", () => {
    const grid = Forming.emptyGrid();
    fillColumns(grid, 0, 4, 4, 8);
    const r0 = Place.collisionWorldRects(entryAt(grid, 0), figThing, 16);
    const r90 = Place.collisionWorldRects(entryAt(grid, 90), figThing, 16);
    assert.equal(hit(r0, 18, 22), true);
    assert.equal(hit(r90, 18, 22), false);
});

test("people and animals are stopped by a figurine", () => {
    const { world } = createTestWorld();
    const grid = Forming.emptyGrid();
    fillColumns(grid, 4, 12, 4, 12);
    const entry = {
        id: "clay_figurine",
        uid: "fig-sim",
        x: 48,
        y: 64,
        rot: 0,
        formVoxels: Forming.pack(grid)
    };
    originChunk(world).things.push(entry);
    world._chunkRectCache = null;
    const rects = Place.collisionWorldRects(entry, world._thingDef("clay_figurine"), 16);
    const r = rects[0];
    const px = (r.left + r.right) * 0.5;
    const py = (r.top + r.bottom) * 0.5;
    assert.equal(world.isBlocked(px, py), true);
    assert.equal(world.isBlocked(px, py, { thingR: 16 * 0.3 }), true, "animals use the clay blocks");
    assert.equal(world.isBlocked(r.left - 6, py), false);

    const c = world.players.get("p1").creature;
    const body = world._creatureBodyAt(c, px - 8, py + 1);
    assert.ok(body.bottom > r.top && body.top < r.bottom && body.right > r.left && body.left < r.right);
    world._chunkRectCache = null;
    assert.equal(world._partyPoseBlocked(c, px - 8, py + 1, 0, { load: false }), true);
});

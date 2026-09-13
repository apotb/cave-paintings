const { test } = require("node:test");
const assert = require("node:assert/strict");
const Forming = require("../shared/forming");
const CraftTemplates = require("../shared/craftTemplates");

function box(grid, x0, x1, y0, y1, z0, z1) {
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) grid[x][y][z] = true;
        }
    }
    return grid;
}

function lumpShape() {
    const g = Forming.emptyGrid();
    box(g, 6, 10, 0, 4, 6, 10);
    return g;
}

function smallShape() {
    const g = Forming.emptyGrid();
    box(g, 7, 9, 0, 3, 7, 9);
    return g;
}

test("extra clay lumps from mass gap", () => {
    assert.equal(CraftTemplates.extraClayLumps(12, 12, 12), 0);
    assert.equal(CraftTemplates.extraClayLumps(13, 12, 12), 1);
    assert.equal(CraftTemplates.extraClayLumps(36, 12, 12), 2);
    assert.equal(CraftTemplates.extraClayLumps(24, 12, 12), 1);
    assert.equal(CraftTemplates.extraClayLumps(10, 20, 12), 0);
});

test("loadCost uses packed mass and startMass", () => {
    const packed = Forming.pack(lumpShape());
    const need = Forming.mass(lumpShape());
    const cost = CraftTemplates.loadCost(packed, 12, 12, Forming);
    assert.equal(cost.need, need);
    assert.equal(cost.available, 12);
    assert.equal(cost.extra, CraftTemplates.extraClayLumps(need, 12, 12));
    assert.equal(CraftTemplates.loadCost("nope", 12, 12, Forming), null);
});

test("sanitize drops junk and below MIN_MASS", () => {
    const packed = Forming.pack(lumpShape());
    const empty = Forming.pack(Forming.emptyGrid());
    const list = CraftTemplates.sanitizeList([
        { id: "a", name: "Wolf", packed, savedAt: 2 },
        { id: "b", name: "  ", packed, savedAt: 3 },
        { name: "Bad", packed: "@@@", savedAt: 4 },
        { id: "c", name: "Dust", packed: empty, savedAt: 5 },
        null,
        "x"
    ], Forming);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Wolf");
    assert.equal(list[0].packed, packed);
});

test("case-insensitive overwrite keeps new casing", () => {
    const a = Forming.pack(lumpShape());
    const b = Forming.pack(smallShape());
    let list = [];
    const first = CraftTemplates.upsert(list, { name: "Wolf", packed: a, id: "t1" }, 10);
    assert.equal(first.replaced, false);
    const second = CraftTemplates.upsert(first.list, { name: "wolf", packed: b }, 20);
    assert.equal(second.replaced, true);
    assert.equal(second.list.length, 1);
    assert.equal(second.list[0].id, "t1");
    assert.equal(second.list[0].name, "wolf");
    assert.equal(second.list[0].packed, b);
    assert.equal(second.list[0].savedAt, 20);
    const cleaned = CraftTemplates.sanitizeList([
        { id: "old", name: "WOLF", packed: a, savedAt: 1 },
        { id: "new", name: "wolf", packed: b, savedAt: 9 }
    ], Forming);
    assert.equal(cleaned.length, 1);
    assert.equal(cleaned[0].id, "new");
});

test("alphabetical listing is case-insensitive", () => {
    const packed = Forming.pack(lumpShape());
    const list = CraftTemplates.sanitizeList([
        { id: "z", name: "zebra", packed, savedAt: 1 },
        { id: "a", name: "Ant", packed, savedAt: 1 },
        { id: "m", name: "moose", packed, savedAt: 1 }
    ], Forming);
    assert.deepEqual(list.map((e) => e.name), ["Ant", "moose", "zebra"]);
});

test("removeById", () => {
    const packed = Forming.pack(lumpShape());
    const list = CraftTemplates.sanitizeList([
        { id: "a", name: "Ant", packed, savedAt: 1 },
        { id: "b", name: "Bat", packed, savedAt: 1 }
    ], Forming);
    const next = CraftTemplates.removeById(list, "a");
    assert.equal(next.length, 1);
    assert.equal(next[0].id, "b");
    assert.equal(CraftTemplates.findByName(next, "ant"), null);
    assert.equal(CraftTemplates.findByName(next, "BAT")?.id, "b");
});

test("clampName trims and caps at NAME_MAX", () => {
    assert.equal(CraftTemplates.clampName("  Wolf  "), "Wolf");
    assert.equal(CraftTemplates.clampName("x".repeat(40)).length, CraftTemplates.NAME_MAX);
    assert.equal(CraftTemplates.nameKey(" Wolf "), "wolf");
});

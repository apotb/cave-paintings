const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

const Phaser = { Math: { Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } };
const context = { Phaser };
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(require.resolve("../js/Knapping.js"), "utf8") + "\nthis.Knapping = Knapping;\n",
    context
);
const Knapping = context.Knapping;

function gridFrom(cells) {
    const g = Knapping.emptyGrid();
    for (const [x, y] of cells) g[y][x] = true;
    return g;
}

/** Even bar, 2 cells thick. dir 0 = upright, 1 = diagonal staircase. */
function bar(len, dir) {
    const cells = [];
    for (let i = 0; i < len; i++) {
        if (dir) {
            cells.push([i, i], [i, i + 1]);
        } else {
            cells.push([i, 4], [i, 5]);
        }
    }
    return gridFrom(cells);
}

test("upright thin bar is a spear tip", () => {
    const r = Knapping.classify(bar(12, 0));
    assert.equal(r.toolClass, "spear_tip");
});

test("diagonal thin bar is a spear tip", () => {
    const r = Knapping.classify(bar(12, 1));
    assert.equal(r.toolClass, "spear_tip");
});

test("short diagonal spear from the knapping well is a spear tip", () => {
    const rows = [
        "................",
        "................",
        "................",
        "................",
        "..........##....",
        ".........###....",
        ".......#####....",
        "......#####.....",
        ".....#####......",
        "......##........",
        "......#.........",
        "................",
        "................",
        "................",
        "................",
        "................"
    ];
    const g = Knapping.emptyGrid();
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) g[y][x] = rows[y][x] === "#";
    }
    assert.equal(Knapping.classify(g).toolClass, "spear_tip");
});

test("filled block is not read as a spear tip", () => {
    const cells = [];
    for (let y = 2; y < 10; y++) {
        for (let x = 2; x < 10; x++) cells.push([x, y]);
    }
    const r = Knapping.classify(gridFrom(cells));
    assert.notEqual(r.toolClass, "spear_tip");
    assert.ok(r.elong < 2.15);
});

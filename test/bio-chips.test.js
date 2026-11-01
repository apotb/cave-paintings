const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console, Phaser: { Geom: {}, Math: {}, Textures: { FilterMode: { NEAREST: 0 } } } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/Utils.js"), "utf8"), sandbox);
const { flowChipRows } = sandbox;

test("chips share a row until the next one does not fit", () => {
    const flow = flowChipRows([40, 40, 40], 100, 4, 4, 16, 2);
    assert.equal(flow.places.length, 3);
    assert.equal(flow.places[0].x, 0);
    assert.equal(flow.places[0].y, 0);
    assert.equal(flow.places[1].x, 44);
    assert.equal(flow.places[1].y, 0);
    assert.equal(flow.places[2].x, 0);
    assert.equal(flow.places[2].y, 20);
    assert.equal(flow.reservedH, 16 * 2 + 4);
    assert.equal(flow.width, 84);
});

test("a chip wider than the row stays put and the next row still starts", () => {
    const flow = flowChipRows([120, 40], 100, 4, 4, 16, 2);
    assert.equal(flow.places[0].x, 0);
    assert.equal(flow.places[0].row, 0);
    assert.equal(flow.places[1].row, 1);
    assert.equal(flow.width, 120);
});

test("rows past the reserved pair are placed but do not grow the section", () => {
    const flow = flowChipRows([80, 80, 80, 80], 100, 4, 4, 16, 2);
    assert.equal(flow.places[2].row, 2);
    assert.equal(flow.places[3].row, 3);
    assert.equal(flow.places[3].y, 3 * (16 + 4));
    assert.equal(flow.reservedH, 16 * 2 + 4);
    assert.ok(flow.places[2].y >= flow.reservedH);
});

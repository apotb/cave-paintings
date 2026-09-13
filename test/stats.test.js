const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDefs, DataStore } = require("./helpers/load");
const Stats = require("../shared/stats");

loadDefs();

test("cactus flower has +1.0 Beauty", () => {
    const flower = DataStore.getItem("cactus_flower");
    assert.ok(flower);
    assert.equal(Stats.valueOf(flower, "beauty"), 1);
    assert.deepEqual(Stats.tooltipLines(flower), ["Beauty: +1.0"]);
});

test("items without beauty omit the stat from tooltips", () => {
    const stick = DataStore.getItem("stick");
    assert.equal(Stats.valueOf(stick, "beauty"), 0);
    assert.deepEqual(Stats.tooltipLines(stick), []);
});

test("stack beauty overrides the item def", () => {
    const def = DataStore.getItem("clay_figurine");
    assert.deepEqual(Stats.tooltipLines(def), []);
    assert.deepEqual(Stats.tooltipLines(def, { beauty: 2 }), ["Beauty: +2.0"]);
    assert.deepEqual(Stats.tooltipLines(def, { beauty: 0 }), []);
    assert.equal(Stats.valueOf(def, "beauty", { beauty: 1 }), 1);
});

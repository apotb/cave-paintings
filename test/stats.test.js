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

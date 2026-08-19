const { test } = require("node:test");
const assert = require("node:assert/strict");
const Carry = require("../shared/carry");
const { loadDefs, DataStore } = require("./helpers/load");

loadDefs();

test("carryCap is strength times 2", () => {
    assert.equal(Carry.carryCap(15), 30);
    assert.equal(Carry.carryCap(0), 0);
});

test("countFit weightless vs over cap", () => {
    assert.equal(Carry.countFit(9, 0, 0, 10), 9);
    assert.equal(Carry.countFit(9, 5, 28, 30), 0);
    assert.equal(Carry.countFit(9, 1, 28, 30), 2);
});

test("knapped stack uses def.weight", () => {
    const def = { weight: 1.5 };
    const knap = { id: "blank", toolClass: "chopper", weight: 99 };
    assert.equal(Carry.unitWeight(knap, def), 1.5);
});

test("encumbrance matches Player formula", () => {
    const none = Carry.encumbrance(10, 15);
    assert.equal(none.hungerRate, 1);
    assert.equal(none.cannotSprint, false);
    const mid = Carry.encumbrance(22.5, 15);
    assert.ok(Math.abs(mid.hungerRate - 1.25) < 1e-9);
    assert.equal(mid.cannotSprint, true);
    const max = Carry.encumbrance(40, 15);
    assert.ok(Math.abs(max.hungerRate - 1.5) < 1e-9);
});

test("resolveCraftedWeights hide-stage averaging", () => {
    const cord = DataStore.getItem("leaf_cord");
    assert.ok(cord);
    assert.ok(Math.abs(cord.weight - 0.05) < 1e-9);
});

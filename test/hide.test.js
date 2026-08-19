const { test } = require("node:test");
const assert = require("node:assert/strict");
const Hide = require("../shared/hide");
const { loadDefs, DataStore } = require("./helpers/load");

loadDefs();

test("hide stage predicates follow the processing chain", () => {
    const raw = DataStore.getItem("deer_hide");
    const fleshed = DataStore.getItem("deer_hide_fleshed") || DataStore.getItem("deer_hide_flesh");
    const dried = DataStore.getItem("deer_hide_dry") || DataStore.getItem("deer_hide_dried");
    assert.ok(Hide.isRawHide(raw));
    assert.ok(fleshed && Hide.isFleshedHide(fleshed));
    assert.ok(dried && Hide.isDriedHide(dried));
});

test("tickDryMinute advances fleshed hide then converts", () => {
    const fleshed = DataStore.getItem("deer_hide_fleshed") || DataStore.getItem("deer_hide_flesh");
    assert.ok(fleshed);
    const getItem = (id) => DataStore.getItem(id);
    const stack = { id: fleshed.id, quantity: 1, dryProgress: Hide.DRY_MINUTES - 1 };
    const mid = Hide.tickDryMinute({ ...stack, dryProgress: 10 }, getItem);
    assert.equal(mid.converted, undefined);
    assert.ok(mid.stack.dryProgress > 10);
    const done = Hide.tickDryMinute(stack, getItem);
    assert.equal(done.converted, true);
    assert.ok(done.stack.id !== fleshed.id);
});

test("beginSoak stamps soakDoneAt", () => {
    const dried = DataStore.getItem("deer_hide_dry");
    assert.ok(dried);
    const stack = { id: dried.id, quantity: 1 };
    Hide.beginSoak(stack, 100);
    assert.ok(Number.isFinite(stack.soakDoneAt));
});

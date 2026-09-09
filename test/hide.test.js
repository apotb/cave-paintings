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

test("settlers may only take dried hide or leather off a drying rack", () => {
    const raw = DataStore.getItem("deer_hide");
    const fleshed = DataStore.getItem("deer_hide_fleshed");
    const soaked = DataStore.getItem("deer_hide_soaked");
    const dehaired = DataStore.getItem("deer_hide_dehaired");
    const brained = DataStore.getItem("deer_hide_brained");
    const dried = DataStore.getItem("deer_hide_dry");
    const leather = DataStore.getItem("deer_leather");
    assert.equal(Hide.canTakeFromRack(raw), false);
    assert.equal(Hide.canTakeFromRack(fleshed), false);
    assert.equal(Hide.canTakeFromRack(soaked), false);
    assert.equal(Hide.canTakeFromRack(dehaired), false);
    assert.equal(Hide.canTakeFromRack(brained), false);
    assert.equal(Hide.canTakeFromRack(dried), true);
    assert.equal(Hide.canTakeFromRack(leather), true);
});

test("drying rack pauses spoil only while fleshed hide is drying", () => {
    const getItem = (id) => DataStore.getItem(id);
    const now = 1000;
    assert.equal(Hide.pausesRackSpoil(getItem("deer_hide_fleshed")), true);
    assert.equal(Hide.pausesRackSpoil(getItem("deer_hide_dehaired")), false);
    assert.equal(Hide.pausesRackSpoil(getItem("deer_hide")), false);
    assert.equal(Hide.pausesRackSpoil(getItem("deer_hide_soaked")), false);
    assert.equal(Hide.pausesRackSpoil(getItem("deer_hide_brained")), false);
    assert.equal(Hide.pausesRackSpoil(getItem("deer_hide_dry")), false);

    const drying = Hide.hangStack(
        { id: "deer_hide_fleshed", quantity: 1, spoilAt: now + 180 },
        now,
        getItem
    );
    assert.equal(drying.spoilLeft, 180);
    assert.equal(drying.spoilAt, undefined);

    const waiting = ["deer_hide", "deer_hide_soaked", "deer_hide_dehaired", "deer_hide_brained"];
    for (const id of waiting) {
        const hung = Hide.hangStack({ id, quantity: 1, spoilLeft: 90 }, now, getItem);
        assert.equal(hung.spoilAt, now + 90, `${id} should keep spoiling on the rack`);
        assert.equal(hung.spoilLeft, undefined);
    }
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

test("haulers leave fleshed hides in water, not other drops", () => {
    const fleshed = DataStore.getItem("deer_hide_fleshed") || DataStore.getItem("deer_hide_flesh");
    const soaked = DataStore.getItem("deer_hide_soaked");
    const stick = DataStore.getItem("stick");
    assert.ok(fleshed);
    assert.equal(Hide.leaveHaulInWater(fleshed, true), true);
    assert.equal(Hide.leaveHaulInWater(fleshed, false), false);
    assert.equal(Hide.leaveHaulInWater(soaked, true), false);
    assert.equal(Hide.leaveHaulInWater(stick, true), false);
});

test("canonicalItemId remaps old beef ids to human flesh", () => {
    assert.equal(Hide.canonicalItemId("raw_beef"), "raw_human_flesh");
    assert.equal(Hide.canonicalItemId("roast_beef"), "roasted_human_flesh");
    assert.equal(Hide.canonicalItemId("roast_human_flesh"), "roasted_human_flesh");
    const raw = DataStore.getItem("raw_beef");
    const roast = DataStore.getItem("roast_beef");
    assert.equal(raw?.id, "raw_human_flesh");
    assert.equal(raw?.name, "Raw Human Flesh");
    assert.equal(raw?.food?.kc, 160);
    assert.equal(raw?.food?.satietyRatio, 0.08);
    assert.equal(roast?.id, "roasted_human_flesh");
    assert.equal(roast?.name, "Roasted Human Flesh");
    assert.equal(roast?.food?.kc, 220);
    assert.equal(roast?.food?.satietyRatio, 0.16);
    assert.deepEqual(roast?.tooltip, ["'You are a horrible person'"]);
});

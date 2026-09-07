const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadDefs } = require("./helpers/load");
const FF = require("../shared/fuelFilter");
const Fire = require("../shared/fire");

function items() {
    return loadDefs()._store.itemsList;
}

function getItem(id) {
    return loadDefs().getItem(id);
}

function walkIds(nodes, out = []) {
    for (const n of nodes || []) {
        for (const it of n.items || []) out.push(it.id);
        if (n.children) walkIds(n.children, out);
    }
    return out;
}

test("defaults are always on and prefer logs, and persist as null", () => {
    const f = FF.emptyFilter();
    assert.equal(f.alwaysOn, true);
    assert.equal(f.preferLogs, true);
    assert.equal(FF.isDefault(null), true);
    assert.equal(FF.isDefault(undefined), true);
    assert.equal(FF.persist(f), null);
    const off = FF.normalize({ alwaysOn: false });
    assert.equal(off.alwaysOn, false);
    assert.equal(off.preferLogs, true);
    assert.equal(FF.persist(off).alwaysOn, false);
    assert.equal(FF.allows(f, { id: "stick" }, getItem), true);
    assert.equal(FF.allows(f, { id: "log" }, getItem), true);
    assert.equal(FF.allows(f, { id: "leaf" }, getItem), false);
});

test("fuel tree only lists items with fuel kj greater than 0", () => {
    const ids = walkIds(FF.buildTree(items()));
    assert.ok(ids.includes("log"));
    assert.ok(ids.includes("stick"));
    assert.ok(ids.includes("leaf"));
    assert.equal(ids.includes("apple"), false);
    assert.equal(ids.includes("rot"), false);
    for (const id of ids) {
        assert.ok(FF.isFuelItem(getItem(id)), id);
    }
    assert.equal(FF.allows(null, { id: "apple" }, getItem), false);
    assert.equal(FF.allows(null, { id: "log" }, getItem), true);
    assert.equal(FF.allows(null, { id: "stick" }, getItem), true);
    assert.equal(FF.allows(null, { id: "leaf" }, getItem), false);
});

test("prefer logs picks logs over sticks when both fit", () => {
    const entry = { fuel: [null, null] };
    const stacks = [
        { id: "stick", quantity: 8 },
        { id: "log", quantity: 3 }
    ];
    assert.equal(FF.pickFuelId({ preferLogs: true }, stacks, entry, getItem), "log");
    assert.equal(FF.pickFuelId({ preferLogs: false }, stacks, entry, getItem), "stick");
    const noLog = FF.pickFuelId(
        { preferLogs: true, offItems: ["log"] },
        stacks,
        entry,
        getItem
    );
    assert.equal(noLog, "stick");
});

test("always-on keep minutes is 12 hours", () => {
    assert.equal(FF.KEEP_HOURS, 12);
    assert.equal(FF.KEEP_MINUTES, 720);
    const entry = {
        id: "campfire",
        burnRemaining: 10,
        pitTemp: 600,
        maxTemp: 600,
        fuel: [null, null]
    };
    assert.equal(Fire.burnMinutes(entry, getItem) < FF.KEEP_MINUTES, true);
    FF.addFuelUnit(entry, "log");
    FF.addFuelUnit(entry, "log");
    FF.addFuelUnit(entry, "log");
    FF.addFuelUnit(entry, "log");
    FF.addFuelUnit(entry, "log");
    assert.ok(Fire.burnMinutes(entry, getItem) >= FF.KEEP_MINUTES);
});

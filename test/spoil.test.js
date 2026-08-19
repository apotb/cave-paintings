const { test } = require("node:test");
const assert = require("node:assert/strict");
const Spoil = require("../shared/spoil");

test("mergeSpoilAt weighted average", () => {
    assert.equal(Spoil.mergeSpoilAt(1, 10, 1, 20), 15);
    assert.equal(Spoil.mergeSpoilAt(1, 10, 1, null), 10);
});

test("mergeSpoilLeft weighted average", () => {
    assert.equal(Spoil.mergeSpoilLeft(2, 10, 2, 20), 15);
});

test("tickSpoilLeft decrements and floors at 0", () => {
    const s = { id: "meat", spoilLeft: 2 };
    assert.equal(Spoil.tickSpoilLeft(s), true);
    assert.equal(s.spoilLeft, 1);
    Spoil.tickSpoilLeft(s);
    Spoil.tickSpoilLeft(s);
    assert.equal(s.spoilLeft, 0);
});

test("spoilStackIfDue converts at due, no-op before", () => {
    const rot = { id: "rot" };
    const early = Spoil.spoilStackIfDue({ id: "meat", spoilAt: 50, quantity: 2 }, 10, rot);
    assert.equal(early.changed, false);
    const due = Spoil.spoilStackIfDue({ id: "meat", spoilAt: 10, quantity: 2 }, 10, rot);
    assert.equal(due.changed, true);
    assert.equal(due.stack.id, "rot");
    assert.equal(due.stack.quantity, 2);
});

test("spoilLeft and spoilAt round-trip", () => {
    const now = 500;
    const left = 120;
    const at = Spoil.spoilAtFromLeft(left, now);
    assert.equal(Spoil.spoilLeftFromAt(at, now), left);
});

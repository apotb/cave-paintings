const { test } = require("node:test");
const assert = require("node:assert/strict");
const Durability = require("../shared/durability");

test("applyDurabilityUse clamps to broke", () => {
    const def = { durability: 10 };
    const stack = { id: "tool", durability: 3 };
    const r = Durability.applyDurabilityUse(stack, 5, def);
    assert.equal(r.broke, true);
    assert.equal(stack.durability, undefined);
});

test("carryDurabilityAfterRework keeps remaining fraction across max change", () => {
    const oldDef = { durability: 100 };
    const newDef = { durability: 50 };
    const oldStack = { id: "a", durability: 40, knapQuality: "rough" };
    const newStack = { id: "a", knapQuality: "fine" };
    Durability.carryDurabilityAfterRework(oldStack, newStack, oldDef, newDef);
    const rem = Durability.remainingDurability(newStack, newDef);
    assert.ok(rem <= Durability.maxDurability(newStack, newDef));
    assert.ok(rem > 0);
});

test("knapQualityMult and maxDurability", () => {
    assert.equal(Durability.knapQualityMult("crude"), 0.65);
    const def = { durability: 100 };
    assert.equal(Durability.maxDurability({ knapQuality: "fine" }, def), 135);
});

test("wearInventorySlot mutates only the target index", () => {
    const def = { durability: 10, name: "Axe" };
    const inv = [
        { id: "axe", quantity: 1, durability: 10 },
        { id: "axe", quantity: 1, durability: 10 }
    ];
    const r = Durability.wearInventorySlot(inv, 0, 1, () => def);
    assert.equal(r.broke, false);
    assert.ok(inv[0].durability < 10);
    assert.equal(inv[1].durability, 10);
});

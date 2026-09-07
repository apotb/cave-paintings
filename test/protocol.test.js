const { test } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol");

function pawnWithSticks() {
    return {
        inventorySize: 5,
        overflowSize: 0,
        inventory: [{ id: "stick", quantity: 4 }, { id: "leaf", quantity: 2 }, null, null, null],
        overflow: [],
        equipment: {
            head: null,
            torso: { id: "leaf_wrap", quantity: 1 },
            legs: null,
            feet: null,
            back: null,
            waist: []
        },
        hotbarIndex: 0
    };
}

test("explicit empty inventory snapshot clears a filled settler bag", () => {
    const pawn = pawnWithSticks();
    const row = {
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: pawn.equipment,
        hotbarIndex: 0
    };
    const sig = Protocol.netGearSig(row.inventory, row.equipment, row.hotbarIndex, row.overflow);
    assert.equal(Protocol.applyNetPawnGear(pawn, row, null, sig), true);
    assert.equal(pawn.inventory.some((s) => s && s.id), false);
    assert.equal(pawn.equipment.torso.id, "leaf_wrap");
    assert.equal(pawn._netGearSig, sig);
});

test("omitted inventory does not wipe a filled settler bag", () => {
    const pawn = pawnWithSticks();
    const row = { name: "pose-only" };
    assert.equal(Protocol.applyNetPawnGear(pawn, row, null, "pose"), false);
    assert.equal(pawn.inventory[0].id, "stick");
});

test("empty snapshot still applies after a stale empty gear sig", () => {
    const pawn = pawnWithSticks();
    const row = {
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: pawn.equipment,
        hotbarIndex: 0
    };
    const sig = Protocol.netGearSig(row.inventory, row.equipment, row.hotbarIndex, row.overflow);
    pawn._netGearSig = sig;
    assert.equal(Protocol.netGearShouldApply(pawn, row, sig), true);
    assert.equal(Protocol.applyNetPawnGear(pawn, row, null, sig), true);
    assert.equal(pawn.inventory.some((s) => s && s.id), false);
});

test("matching empty sig does not re-apply once bags agree", () => {
    const pawn = {
        inventorySize: 5,
        overflowSize: 0,
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: { head: null, torso: null, legs: null, feet: null, back: null, waist: [] }
    };
    const row = {
        inventory: [null, null, null, null, null],
        overflow: [],
        equipment: pawn.equipment,
        hotbarIndex: 0
    };
    const sig = Protocol.netGearSig(row.inventory, row.equipment, row.hotbarIndex, row.overflow);
    pawn._netGearSig = sig;
    assert.equal(Protocol.netGearShouldApply(pawn, row, sig), false);
    assert.equal(Protocol.applyNetPawnGear(pawn, row, null, sig), false);
});

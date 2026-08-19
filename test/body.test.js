const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Body } = require("../shared/body/Body");
const Capacities = require("../shared/body/Capacities");
const { loadDefs, bodyCtx, seedRng, restoreRng } = require("./helpers/load");

loadDefs();

function makeHuman() {
    const owner = { kind: "player", name: "T", _dead: false };
    owner.anatomy = new Body(bodyCtx(), "human", owner);
    owner.capacities = new Capacities(owner.anatomy);
    return owner;
}

test("human plan has hp and round-trips JSON", () => {
    seedRng(7);
    const owner = makeHuman();
    const arm = owner.anatomy.part("Left Arm");
    assert.ok(arm);
    assert.ok(arm.hp() > 0);
    const json = owner.anatomy.toJSON();
    const cloneOwner = { kind: "player" };
    const clone = new Body(bodyCtx(), "human", cloneOwner);
    clone.loadJSON(json);
    assert.ok(clone.part("Left Arm"));
    restoreRng();
});

test("destroying a child zeros efficiency / isCutOff", () => {
    const owner = makeHuman();
    const hand = owner.anatomy.part("Left Hand");
    assert.ok(hand);
    hand.destroy();
    assert.ok(hand.isDead() || hand.isCutOff());
    assert.equal(hand.efficiency(), 0);
});

test("destroying both eyes zeros sight", () => {
    const owner = makeHuman();
    const left = owner.anatomy.part("Left Eye");
    const right = owner.anatomy.part("Right Eye");
    assert.ok(left && right);
    left.destroy();
    right.destroy();
    owner.capacities = new Capacities(owner.anatomy);
    assert.equal(owner.capacities.sight(), 0);
});

test("destroyed core is dead from capacities", () => {
    const owner = makeHuman();
    owner.anatomy.core.destroy();
    owner.capacities = new Capacities(owner.anatomy);
    assert.equal(owner.capacities.isDeadFromCapacities(), true);
});

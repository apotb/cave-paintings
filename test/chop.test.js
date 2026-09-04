const { test } = require("node:test");
const assert = require("node:assert/strict");
const Chop = require("../shared/chop");
const { seedRng } = require("./helpers/load");

test("chopFraction by class and quality", () => {
    const rough = Chop.chopFraction({ toolClass: "chopper", knapQuality: "rough" });
    const crude = Chop.chopFraction({ toolClass: "chopper", knapQuality: "crude" });
    assert.ok(rough > 0);
    assert.ok(crude < rough);
    assert.equal(Chop.chopFraction({ toolClass: "knife" }), 0);
    assert.equal(Chop.isChopper({ toolClass: "chopper", knapQuality: "rough" }), true);
    assert.equal(Chop.isChopper({ id: "stick" }), false);
});

test("trunkHitsSegment hit and miss", () => {
    const boxHit = Chop.trunkHitsSegment(
        { a: { x: 0, y: -2 }, b: { x: 0, y: 2 } },
        0, 0, 5, 3
    );
    const miss = Chop.trunkHitsSegment(
        { a: { x: 40, y: 40 }, b: { x: 50, y: 50 } },
        0, 0, 5, 0
    );
    assert.equal(boxHit, true);
    assert.equal(miss, false);
});

test("aimHitsTrunk matches player chop reach", () => {
    assert.equal(Chop.aimHitsTrunk(0, 14, -Math.PI / 2, 0, 0, 5), true);
    assert.equal(Chop.aimHitsTrunk(40, 40, 0, 0, 0, 5), false);
});

test("standDist is inside short chopper reach", () => {
    const d = Chop.standDist(5);
    assert.ok(d >= 7 && d <= 10);
    assert.equal(Chop.aimHitsTrunk(0, d, -Math.PI / 2, 0, 0, 5), true);
    const padded = Chop.standDist(5, 4);
    assert.ok(padded > d);
    assert.equal(Chop.aimHitsTrunk(0, padded, -Math.PI / 2, 0, 0, 5), true);
    assert.equal(Chop.stillChoppable({ choppable: { stump: "tree_stump" } }, { id: "tree" }), true);
    assert.equal(Chop.stillChoppable({ choppable: { stump: "tree_stump" } }, { id: "tree", chopProgress: 1 }), false);
    assert.equal(Chop.stillChoppable({}, { id: "tree_stump" }), false);
});

test("ringStand stays on the approach side and never on the trunk", () => {
    const east = Chop.ringStand(20, 0, 0, 0, 5, 4);
    assert.ok(east.aimX > 0);
    assert.ok(Math.abs(east.aimY) < 0.01);
    assert.ok(east.dist > 8);
    assert.equal(Chop.aimHitsTrunk(east.aimX, east.aimY, Math.PI, 0, 0, 5), true);
    const south = Chop.ringStand(0, 20, 0, 0, 5, 4);
    assert.ok(south.aimY > 0);
    assert.ok(Math.abs(south.aimX) < 0.01);
});

test("applyChop reaches stump threshold", () => {
    const entry = { id: "tree", chopProgress: 0 };
    let r = Chop.applyChop(entry, 0.4);
    assert.equal(r.felled, false);
    r = Chop.applyChop(entry, 0.7);
    assert.equal(r.felled, true);
});

test("rollDrops is seeded", () => {
    const def = { choppable: { drops: { log: [2, 2], stick: [1, 1], leaf: [0, 0] } } };
    const a = Chop.rollDrops(def, () => 0);
    const b = Chop.rollDrops(def, () => 0);
    assert.deepEqual(a, b);
    assert.ok(a.some((d) => d.id === "log" && d.quantity === 2));
});

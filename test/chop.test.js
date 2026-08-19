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

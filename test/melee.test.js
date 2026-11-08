const { test } = require("node:test");
const assert = require("node:assert/strict");
const Melee = require("../shared/melee");

test("meleeThrustCurve shape", () => {
    assert.equal(Melee.meleeThrustCurve(0), 0);
    assert.ok(Math.abs(Melee.meleeThrustCurve(0.4) - 1) < 1e-9);
    assert.ok(Melee.meleeThrustCurve(1) < 0.01);
});

test("meleeSegmentsIntersect true and false", () => {
    assert.equal(Melee.meleeSegmentsIntersect(0, 0, 10, 0, 5, -5, 5, 5), true);
    assert.equal(Melee.meleeSegmentsIntersect(0, 0, 2, 0, 5, -1, 5, 1), false);
});

test("meleeSegmentHitsRect with padding", () => {
    const box = { left: 10, right: 20, top: 10, bottom: 20 };
    assert.equal(Melee.meleeSegmentHitsRect(0, 15, 9, 15, box, 0), false);
    assert.equal(Melee.meleeSegmentHitsRect(0, 15, 9, 15, box, 2), true);
    assert.equal(Melee.meleeSegmentHitsRect(15, 15, 16, 16, box, 0), true);
});

test("meleeSwingWouldHit in and out of range", () => {
    const target = { x: 80, y: 0, hitboxSize: 8 };
    assert.equal(Melee.meleeSwingWouldHit(0, 0, 0, 4, target), false);
    assert.equal(Melee.meleeSwingWouldHit(0, 0, 0, 90, target), true);
});

test("a spear tip reaches a side-on human the shaft segment misses", () => {
    const human = {
        kind: "player",
        role: "wanderer",
        x: 28,
        y: 8,
        facing: "left",
        width: 16,
        height: 16
    };
    const samples = [0.25, 0.4, 0.55];
    const shaft = samples.some((p) => {
        const seg = Melee.unarmedHitSegmentAt(8, 0, 0, 12, p);
        return Melee.meleeSegmentHitsTarget(seg.a, seg.b, 3, human);
    });
    const tip = samples.some((p) => {
        const seg = Melee.spearHitSegmentAt(8, 0, 0, 12, p);
        return Melee.meleeSegmentHitsTarget(seg.a, seg.b, 3, human);
    });
    assert.equal(shaft, false);
    assert.equal(tip, true);
    assert.equal(Melee.meleeSwingWouldHit(8, 0, 0, 12, human, { radius: 3, spear: true }), true);
    assert.equal(Melee.meleeSwingWouldHit(8, 0, 0, 12, human, { radius: 3 }), false);
});

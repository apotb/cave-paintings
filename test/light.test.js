const { test } = require("node:test");
const assert = require("node:assert/strict");
const Light = require("../shared/light");

test("kindOf defaults to steady and accepts flame aliases", () => {
    assert.equal(Light.kindOf(), Light.KIND.STEADY);
    assert.equal(Light.kindOf("electric"), Light.KIND.STEADY);
    assert.equal(Light.kindOf("normal"), Light.KIND.STEADY);
    assert.equal(Light.kindOf("flame"), Light.KIND.FLAME);
    assert.equal(Light.kindOf("fire"), Light.KIND.FLAME);
    assert.equal(Light.kindOf({ lightKind: "flame" }), Light.KIND.FLAME);
    assert.equal(Light.kindOf({ light: { kind: "steady" } }), Light.KIND.STEADY);
    assert.equal(Light.kindOf({}, Light.KIND.FLAME), Light.KIND.FLAME);
});

test("steady lights do not flicker", () => {
    const a = Light.flicker(Light.KIND.STEADY, 0, 1);
    const b = Light.flicker(Light.KIND.STEADY, 800, 1);
    assert.deepEqual(a, { radiusMul: 1, core: 1, x: 0, y: 0, radiusPx: 0 });
    assert.deepEqual(b, a);
});

test("flame flicker is a Terrax hold-then-pop, not a sine pulse", () => {
    const still = { radiusMul: 1, core: 1, x: 0, y: 0, radiusPx: 0 };
    const miss = Light.flicker(Light.KIND.FLAME, 0, 0, () => 0.99);
    assert.deepEqual(miss, still);

    const seq = [0, 0.5];
    let i = 0;
    const hit = Light.flicker(Light.KIND.FLAME, 0, 0, () => seq[i++]);
    assert.equal(hit.radiusMul, 1);
    assert.equal(hit.x, 0);
    assert.equal(hit.y, 0);
    assert.ok(hit.radiusPx >= 1 && hit.radiusPx <= Light.FIRE_RADIUS_PX);
});

test("smoothRadius eases toward the target instead of snapping", () => {
    const mid = Light.smoothRadius(3, 9, 200, 520);
    assert.ok(mid > 3 && mid < 9);
    const later = Light.smoothRadius(mid, 9, 200, 520);
    assert.ok(later > mid && later < 9);
    assert.equal(Light.smoothRadius(8.99, 9, 200, 520), 9);
});

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const GameMath = require("../shared/gameMath");
const { seedRng, restoreRng } = require("./helpers/load");

beforeEach(() => seedRng(1));
afterEach(() => restoreRng());

test("clamp", () => {
    assert.equal(GameMath.clamp(5, 0, 10), 5);
    assert.equal(GameMath.clamp(-1, 0, 10), 0);
    assert.equal(GameMath.clamp(99, 0, 10), 10);
});

test("setRng makes between deterministic", () => {
    seedRng(42);
    const a = [GameMath.between(1, 10), GameMath.between(1, 10), GameMath.pick([1, 2, 3])];
    seedRng(42);
    const b = [GameMath.between(1, 10), GameMath.between(1, 10), GameMath.pick([1, 2, 3])];
    assert.deepEqual(a, b);
});

test("between when max < min returns lo", () => {
    assert.equal(GameMath.between(5, 1), 5);
});

test("setRng(null) restores Math.random", () => {
    GameMath.setRng(() => 0);
    assert.equal(GameMath.random(), 0);
    restoreRng();
    const v = GameMath.random();
    assert.ok(v >= 0 && v < 1);
    assert.notEqual(v, 0);
});

test("jitteredRegrowAt is 85–115% of base", () => {
    const now = 1000;
    const lo = GameMath.jitteredRegrowAt(100, now, () => 0);
    const hi = GameMath.jitteredRegrowAt(100, now, () => 0.999999);
    assert.equal(lo, now + 85);
    assert.ok(hi >= now + 114 && hi <= now + 115);
});

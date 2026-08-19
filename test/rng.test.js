const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32, hash2D, uuid } = require("../shared/rng");

test("mulberry32 is stable for a seed", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    assert.deepEqual(seqA, seqB);
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test("hash2D is stable and changes with args", () => {
    assert.equal(hash2D(3, 4, 5), hash2D(3, 4, 5));
    assert.notEqual(hash2D(3, 4, 5), hash2D(3, 4, 6));
    assert.notEqual(hash2D(3, 4, 5), hash2D(4, 3, 5));
});

test("uuid format", () => {
    const id = uuid();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

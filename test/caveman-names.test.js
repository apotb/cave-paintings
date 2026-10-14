const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32 } = require("../shared/rng");
const CavemanNames = require("../shared/cavemanNames");

test("generated names are short, capitalized, and pronounceable", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 400; i++) {
        const name = CavemanNames.generate(rng);
        assert.match(name, /^[A-Z][a-z]{1,11}$/);
        assert.doesNotMatch(name, /([aeiou])\1/i);
        assert.doesNotMatch(name, /([bcdfghjklmnpqrstvwxyz])\1\1/i);
    }
});

test("generate skips names already in use", () => {
    const rng = mulberry32(3);
    const avoid = [];
    for (let i = 0; i < 40; i++) {
        const name = CavemanNames.generate(rng, { avoid });
        assert.equal(avoid.some((n) => n.toLowerCase() === name.toLowerCase()), false);
        avoid.push(name);
    }
});

test("the same seed produces the same name", () => {
    const a = CavemanNames.generate(mulberry32(11));
    const b = CavemanNames.generate(mulberry32(11));
    assert.equal(a, b);
});

test("no single name dominates the pool", () => {
    const rng = mulberry32(99);
    const counts = new Map();
    const n = 8000;
    for (let i = 0; i < n; i++) {
        const name = CavemanNames.generate(rng);
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    let top = 0;
    for (const c of counts.values()) top = Math.max(top, c);
    assert.ok(counts.size > 500, `expected a wide pool, got ${counts.size}`);
    assert.ok(top / n < 0.02, `top name was ${(top / n * 100).toFixed(2)}% of rolls`);
});

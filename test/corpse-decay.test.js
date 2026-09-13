const { test } = require("node:test");
const assert = require("node:assert/strict");
const CorpseDecay = require("../shared/corpseDecay");

test("canSkin is false for a carcass and for a body that has aged into one", () => {
    const now = 20_000;
    assert.equal(CorpseDecay.canSkin({ skinned: false, stage: "corpse", diedAt: now }, now), true);
    assert.equal(CorpseDecay.canSkin({ skinned: true, stage: "corpse", diedAt: now }, now), false);
    assert.equal(
        CorpseDecay.canSkin({ skinned: false, stage: "carcass", diedAt: now - 100 }, now),
        false
    );
    assert.equal(
        CorpseDecay.isCarcass({ stage: "corpse", diedAt: now - CorpseDecay.CORPSE_MINUTES }, now),
        true
    );
    assert.equal(
        CorpseDecay.canSkin({
            skinned: false,
            stage: "corpse",
            diedAt: now - CorpseDecay.CORPSE_MINUTES
        }, now),
        false
    );
});

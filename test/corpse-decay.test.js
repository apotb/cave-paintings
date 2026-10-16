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

test("a cleaver adds 2 meat and leaves hide, brain, and bone", () => {
    const knife = CorpseDecay.skinLootTable("deer", { toolClass: "knife" });
    const cleaver = CorpseDecay.skinLootTable("deer", { toolClass: "cleaver" });
    assert.deepEqual(knife[0], { id: "raw_venison", min: 2, max: 4 });
    assert.deepEqual(cleaver[0], { id: "raw_venison", min: 4, max: 6 });
    assert.deepEqual(knife.slice(1), cleaver.slice(1));
    assert.deepEqual(CorpseDecay.skinLootTable("boar", { toolClass: "cleaver" })[0], {
        id: "raw_pork", min: 5, max: 7
    });
    assert.deepEqual(CorpseDecay.skinLootTable("human", { toolClass: "cleaver" })[0], {
        id: "raw_human_flesh", min: 4, max: 6
    });
    assert.deepEqual(CorpseDecay.skinLootTable("human", { toolClass: "knife" })[0], {
        id: "raw_human_flesh", min: 2, max: 4
    });
    const noBrain = CorpseDecay.skinLootTable("deer", { toolClass: "cleaver", brainDestroyed: true });
    assert.equal(noBrain.some((d) => d.id === "brain"), false);
    assert.deepEqual(noBrain[0], { id: "raw_venison", min: 4, max: 6 });
    assert.equal(CorpseDecay.isSkinTool("knife"), true);
    assert.equal(CorpseDecay.isSkinTool("cleaver"), true);
    assert.equal(CorpseDecay.isSkinTool("hand_axe"), false);
});

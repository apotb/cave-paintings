const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Body } = require("../shared/body/Body");
const BodyHealing = require("../shared/body/Healing");
const Hediffs = require("../shared/body/Hediff");
const GameMath = require("../shared/gameMath");
const { loadDefs, DataStore, bodyCtx } = require("./helpers/load");

loadDefs();

function makeOwner() {
    const owner = {
        kind: "player",
        name: "T",
        _dead: false,
        _resting: false,
        isBodyDead() { return this._dead; },
        onBodyFatal() { this._dead = true; }
    };
    owner.anatomy = new Body(bodyCtx(), "human", owner);
    return owner;
}

test("bleedRateTotal and minutesToBleedOut", () => {
    const owner = makeOwner();
    const part = owner.anatomy.part("Left Arm") || owner.anatomy.core;
    part.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    const rate = BodyHealing.bleedRateTotal(owner.anatomy);
    assert.ok(rate > 0);
    const mins = BodyHealing.minutesToBleedOut(owner.anatomy);
    assert.ok(mins > 0);
});

test("applyTend sets tended and quality", () => {
    const owner = makeOwner();
    const part = owner.anatomy.part("Left Arm") || owner.anatomy.core;
    const inj = {
        id: "cut",
        severity: 4,
        bleeding: true,
        bleedRate: 0.06,
        tended: false,
        tendQuality: 0
    };
    part.injure(inj);
    const ok = BodyHealing.applyTend(owner.anatomy, { part, inj }, 0.4);
    assert.equal(ok, true);
    assert.equal(inj.tended, true);
    assert.equal(inj.tendQuality, 0.4);
    assert.equal(inj.bleeding, false);
});

test("pickTendTargets finds the wound", () => {
    const owner = makeOwner();
    const part = owner.anatomy.part("Left Arm") || owner.anatomy.core;
    part.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    const batch = BodyHealing.pickTendTargets(owner.anatomy, { batchSeverity: 20 });
    assert.ok(batch.length >= 1);
    assert.ok(batch[0].inj);
});

test("pickTendTargets with batchSeverity 0 covers one wound only", () => {
    const owner = makeOwner();
    const arm = owner.anatomy.part("Left Arm") || owner.anatomy.core;
    const other = owner.anatomy.part("Right Arm") || owner.anatomy.core;
    arm.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    other.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    const one = BodyHealing.pickTendTargets(owner.anatomy, { batchSeverity: 0 });
    assert.equal(one.length, 1);
    const batch = BodyHealing.pickTendTargets(owner.anatomy, { batchSeverity: 20 });
    assert.equal(batch.length, 2);
});

test("bandageUsesNeeded counts a poultice batch plus an infection", () => {
    const owner = makeOwner();
    const arm = owner.anatomy.part("Left Arm") || owner.anatomy.core;
    const other = owner.anatomy.part("Right Arm") || owner.anatomy.core;
    arm.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    other.injure({
        id: "cut",
        severity: 8,
        bleeding: true,
        bleedRate: 0.06,
        tended: false
    });
    Hediffs.startInfection(owner, owner.anatomy, "Torso", owner.anatomy.ctx);
    assert.equal(BodyHealing.bandageUsesNeeded(owner.anatomy, 20), 2);
    const plan = BodyHealing.planMedicineTakes(owner.anatomy, 1, {
        poulticeBatch: 20,
        cordBatch: 0
    });
    assert.equal(plan.poultice, 1);
    assert.equal(plan.poulticeNeeded, 2);
    assert.equal(plan.cord, 1);
});

test("pickBestBandage prefers poultice over leaf cord", () => {
    const getItem = (id) => DataStore.getItem(id);
    const bags = [
        {
            bag: "hotbar",
            slots: [
                { id: "leaf_cord", quantity: 4 },
                { id: "poultice", quantity: 1 },
                null, null, null
            ],
            source: "doc"
        }
    ];
    const pick = BodyHealing.pickBestBandage(bags, getItem);
    assert.equal(pick.stack.id, "poultice");
    assert.equal(pick.slot, 1);
});

test("rollTendQuality respects self-tend factor", () => {
    const q = BodyHealing.rollTendQuality(
        0.4, 0.7,
        { floatBetween: () => 1, clamp: GameMath.clamp },
        { selfTend: true }
    );
    assert.ok(Math.abs(q - 0.4 * 0.7) < 1e-9);
});

test("minuteTick with food poisoning does not throw", () => {
    const owner = makeOwner();
    owner.anatomy.addHediff("food_poisoning", 0.5);
    Hediffs.minuteTick(owner, owner.anatomy.ctx);
    const h = owner.anatomy.hediff?.("food_poisoning");
    assert.ok(h);
    assert.ok(h.severity < 0.5);
});

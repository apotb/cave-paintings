const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Body } = require("../shared/body/Body");
const BodyHealing = require("../shared/body/Healing");
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

test("rollTendQuality respects self-tend factor", () => {
    const q = BodyHealing.rollTendQuality(
        0.4, 0.7,
        { floatBetween: () => 1, clamp: GameMath.clamp },
        { selfTend: true }
    );
    assert.ok(Math.abs(q - 0.4 * 0.7) < 1e-9);
});

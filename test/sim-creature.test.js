const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPlayerCreature, createMobCreature, BodyCombat } = require("../shared/sim/SimCreature");
const { loadDefs, DataStore, seedRng, restoreRng } = require("./helpers/load");

loadDefs();

function deer() {
    const def = DataStore.getMob("deer");
    return createMobCreature(
        { uid: "mob-test-deer", id: "deer", x: 40, y: 0, homeX: 40, homeY: 0 },
        def,
        DataStore,
        { worldMinuteIndex: () => 100 }
    );
}

function player() {
    return createPlayerCreature(
        {
            id: "p1",
            name: "Tester",
            x: 0,
            y: 0,
            facing: "right",
            inventory: [null, null, null, null, null],
            hotbarIndex: 0
        },
        DataStore,
        { worldMinuteIndex: () => 100 }
    );
}

test("applyHit injures a deer (deterministic)", () => {
    seedRng(4);
    const p = player();
    const d = deer();
    const atk = BodyCombat.pickAttack(p);
    assert.ok(atk);
    atk.def = { ...(atk.def || {}), variance: 0 };
    const before = Object.values(d.anatomy.parts()).reduce(
        (n, part) => n + (part.injuries?.length || 0),
        0
    );
    BodyCombat.applyHit(p, d, atk);
    const after = Object.values(d.anatomy.parts()).reduce(
        (n, part) => n + (part.injuries?.length || 0),
        0
    );
    assert.ok(after > before || d.anatomy._dirty || d.isBodyDead());
    restoreRng();
});

test("startMeleeAttack sets timers", () => {
    seedRng(2);
    const p = player();
    assert.equal(p.startMeleeAttack(0), true);
    assert.equal(p.isAttacking(), true);
    assert.ok(p.attackTimer > 0);
    restoreRng();
});

test("die() loot has finite spoilAt", () => {
    seedRng(8);
    const d = deer();
    const corpse = d.die();
    assert.ok(corpse && Array.isArray(corpse.loot));
    assert.ok(corpse.loot.every((s) => s.spoilAt == null || Number.isFinite(s.spoilAt)));
    restoreRng();
});

test("die() corpse sits at the downed body center, not the feet pose", () => {
    const d = deer();
    d.x = 48;
    d.y = 64;
    d._prone = true;
    const corpse = d.die();
    const c = d.bodyCenter();
    assert.equal(corpse.x, c.x);
    assert.equal(corpse.y, c.y);
    assert.equal(corpse.x, 48 + 8);
    assert.equal(corpse.y, 64 - 8);
});

test("refreshCapacities ends a mid-swing when knocked down", () => {
    seedRng(2);
    const p = player();
    assert.equal(p.startMeleeAttack(0), true);
    assert.ok(p.attackTimer > 0);
    p.isIncapacitated = () => true;
    p.refreshCapacities();
    assert.equal(p._prone, true);
    assert.equal(p.attackTimer, 0);
    assert.equal(p.isAttacking(), false);
    restoreRng();
});

test("boar tusk swing art is white; other unarmed verbs stay uncolored", () => {
    const def = DataStore.getMob("boar");
    const boar = createMobCreature(
        { uid: "b-art", id: "boar", x: 0, y: 0, homeX: 0, homeY: 0 },
        def,
        DataStore,
        { worldMinuteIndex: () => 100 }
    );
    const atks = BodyCombat.collectAttacks(boar);
    const tusk = atks.find((a) => a.verb === "gored" || a.verb === "slashed");
    const other = atks.find((a) => a.verb !== "gored" && a.verb !== "slashed");
    assert.ok(tusk && other);
    boar.currentAttack = tusk;
    boar.attackMax = 800;
    const tuskArt = boar.getAttackArt();
    assert.equal(tuskArt.unarmed, true);
    assert.equal(tuskArt.color, 0xffffff);
    boar.currentAttack = other;
    const otherArt = boar.getAttackArt();
    assert.equal(otherArt.unarmed, true);
    assert.equal(otherArt.color, undefined);
});

test("startMeleeAttack refuses a prone creature", () => {
    seedRng(2);
    const p = player();
    p._prone = true;
    assert.equal(p.startMeleeAttack(0), false);
    restoreRng();
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPlayerCreature, createMobCreature, BodyCombat } = require("../server/SimCreature");
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

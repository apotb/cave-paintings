const { test } = require("node:test");
const assert = require("node:assert/strict");
const BodyCombat = require("../shared/body/Combat");
const { createPlayerCreature, createMobCreature } = require("../server/SimCreature");
const { loadDefs, DataStore, seedRng, restoreRng } = require("./helpers/load");

loadDefs();

function player(id = "p1") {
    return createPlayerCreature(
        {
            id,
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

test("collectAttacks returns unarmed verbs", () => {
    const p = player();
    const atks = BodyCombat.collectAttacks(p);
    assert.ok(atks.length >= 1);
    assert.ok(atks.some((a) => a.unarmed || a.def?.unarmed || a.verb));
});

test("seeded pickAttack is stable", () => {
    seedRng(11);
    const a = BodyCombat.pickAttack(player("a"));
    seedRng(11);
    const b = BodyCombat.pickAttack(player("b"));
    assert.ok(a && b);
    assert.equal(a.name || a.verb, b.name || b.verb);
    restoreRng();
});

test("applyHit injures a deer", () => {
    seedRng(3);
    const atk = player("atk");
    const deerDef = DataStore.getMob("deer");
    const deer = createMobCreature(
        { uid: "d1", id: "deer", x: 8, y: 0, homeX: 8, homeY: 0 },
        deerDef,
        DataStore,
        { worldMinuteIndex: () => 100 }
    );
    const attack = BodyCombat.pickAttack(atk);
    assert.ok(attack);
    attack.def = { ...(attack.def || {}), variance: 0 };
    const before = Object.values(deer.anatomy.parts()).reduce(
        (n, p) => n + (p.injuries?.length || 0),
        0
    );
    const result = BodyCombat.applyHit(atk, deer, attack);
    assert.ok(result);
    const after = Object.values(deer.anatomy.parts()).reduce(
        (n, p) => n + (p.injuries?.length || 0),
        0
    );
    assert.ok(after > before || deer.anatomy._dirty || deer.isBodyDead?.());
    restoreRng();
});

test("meleeWeaponAverageDps is finite for a held spear def", () => {
    const spear = DataStore.getItem("sharp_stick");
    assert.ok(spear?.weapon);
    const dps = BodyCombat.meleeWeaponAverageDps(spear.weapon);
    if (dps) assert.ok(dps.dps > 0);
});

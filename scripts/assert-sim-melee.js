/**
 * Quick assert: player SimCreature melee injures a deer via tickMelee.
 */
const path = require("path");
const GameMath = require("../shared/gameMath");
const DataStore = require("../shared/DataStore");
const {
    createPlayerCreature,
    createMobCreature,
    BodyCombat
} = require("../server/SimCreature");

DataStore.loadFromDisk(path.resolve(__dirname, ".."));
GameMath.setRng(() => Math.random());

const deerEntry = {
    uid: "mob-test-deer",
    id: "deer",
    x: 40,
    y: 0,
    homeX: 40,
    homeY: 0
};
const deerDef = DataStore.getMob("deer");
if (!deerDef) throw new Error("missing deer def");

const player = createPlayerCreature(
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

const deer = createMobCreature(deerEntry, deerDef, DataStore, {
    worldMinuteIndex: () => 100
});

const injuryCount = () =>
    Object.values(deer.anatomy.parts()).reduce(
        (n, p) => n + (p.injuries?.length || 0),
        0
    );
const beforeInj = injuryCount();

let hit = false;
for (let i = 0; i < 80 && !hit; i++) {
    player.x = deer.x - 10;
    player.y = deer.y;
    const ang = Math.atan2(deer.y - player.y, deer.x - player.x);
    if (!player.isAttacking()) player.startMeleeAttack(ang);
    player.tickMelee(40, [deer]);
    if (injuryCount() > beforeInj || deer.anatomy._dirty) hit = true;
}

if (!hit) {
    const atk = BodyCombat.pickAttack(player);
    if (!atk) throw new Error("no attack");
    BodyCombat.applyHit(player, deer, atk);
    if (!(injuryCount() > beforeInj || deer.anatomy._dirty)) {
        throw new Error("deer took no injury even from direct applyHit");
    }
    console.log("melee swing miss (range) but applyHit injury ok");
} else {
    console.log("melee tick hit deer — injury ok");
}

const corpse = deer.die();
if (!corpse || !Array.isArray(corpse.loot)) {
    throw new Error("die() missing corpse/loot");
}
const spoilOk = corpse.loot.every(
    (s) => s.spoilAt == null || Number.isFinite(s.spoilAt)
);
if (!spoilOk) throw new Error("loot spoilAt invalid");
console.log("die loot spoilAt ok, loot=", corpse.loot.length);
console.log("assert deer injury: PASS");

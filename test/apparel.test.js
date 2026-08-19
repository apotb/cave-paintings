const { test } = require("node:test");
const { loadDefs, DataStore, GameMath } = require("./helpers/load");
const Apparel = require("../shared/apparel");
const Durability = require("../shared/durability");
const BodyCombat = require("../shared/body/Combat");
const { createPlayerCreature } = require("../server/SimCreature");

loadDefs();

test("ported apparel asserts", () => {
function assert(cond, msg) {
    if (!cond) throw new Error(msg || "assert failed");
}
function emptyEquip() {
    return { head: null, torso: null, legs: null, feet: null, back: null, waist: [] };
}

function rngSeq(values) {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}

const wrap = DataStore.getItem("leaf_wrap");
const loin = DataStore.getItem("leaf_loincloth");
const sandals = DataStore.getItem("leaf_sandals");
const pouch = DataStore.getItem("leaf_pouch");
assert(wrap && loin && sandals && pouch, "missing leaf items");
assert(wrap.equip.layer === "skin" && wrap.durability === 60, "wrap def");
assert(Math.abs(wrap.equip.armor.sharp - 0.12) < 1e-9, "wrap sharp");
assert(pouch.equip.layer === "belt" && !pouch.durability, "pouch utility");

const heart = { name: "Heart", baseId: "Heart" };
const pelvis = { name: "Pelvis", baseId: "Pelvis" };
const rShoulder = { name: "Right Shoulder", baseId: "Shoulder" };
const lShoulder = { name: "Left Shoulder", baseId: "Shoulder" };
const lArm = { name: "Left Arm", baseId: "Arm" };
const lFoot = { name: "Left Foot", baseId: "Foot" };
const lToe = { name: "Left Big Toe", baseId: "Big Toe" };
const lLeg = { name: "Left Leg", baseId: "Leg" };
const femur = { name: "Left Femur", baseId: "Femur" };

assert(Apparel.itemCoversPart(wrap, heart), "wrap covers heart");
assert(Apparel.itemCoversPart(wrap, pelvis), "wrap covers pelvis (torso group)");
assert(Apparel.itemCoversPart(wrap, rShoulder), "wrap covers right shoulder");
assert(!Apparel.itemCoversPart(wrap, lShoulder), "wrap skips left shoulder");
assert(!Apparel.itemCoversPart(wrap, lArm), "wrap skips arm");
assert(Apparel.itemCoversPart(loin, lLeg), "loincloth covers leg");
assert(Apparel.itemCoversPart(loin, femur), "loincloth covers femur");
assert(!Apparel.itemCoversPart(loin, lFoot), "loincloth skips feet");
assert(Apparel.itemCoversPart(sandals, lFoot), "sandals cover feet");
assert(!Apparel.itemCoversPart(sandals, lToe), "sandals skip toes");

assert(Apparel.occupancyConflict(wrap, wrap), "two wraps conflict");
assert(!Apparel.occupancyConflict(wrap, loin), "wrap + loincloth ok");
assert(!Apparel.occupancyConflict(wrap, sandals), "wrap + sandals ok");

const getItem = (id) => DataStore.getItem(id);
const eq = emptyEquip();
eq.torso = { id: "leaf_wrap", quantity: 1 };

let hit = Apparel.resolveHit({
    equipment: eq,
    getItem,
    part: lArm,
    damage: 10,
    damageType: "sharp",
    armorPen: 0,
    random: () => 0
});
assert(hit.damage === 10 && !hit.deflected && hit.rolled.length === 0, "arm bypasses wrap");

hit = Apparel.resolveHit({
    equipment: eq,
    getItem,
    part: heart,
    damage: 10,
    damageType: "sharp",
    armorPen: 0,
    random: rngSeq([0.01])
});
assert(hit.deflected && hit.damage === 0, "low roll deflects");
assert(hit.rolled.length === 1 && hit.rolled[0].outcome === "deflect", "deflect rolled wrap");
assert(Math.abs(hit.rolled[0].wear - 10 / 4) < 1e-9, "wear is reached/4");

hit = Apparel.resolveHit({
    equipment: eq,
    getItem,
    part: heart,
    damage: 10,
    damageType: "sharp",
    armorPen: 0,
    random: rngSeq([0.08])
});
assert(hit.glanced && !hit.deflected, "mid roll glances");
assert(hit.damage === 5, "glance halves");
assert(hit.damageType === "blunt", "sharp glance becomes blunt");

hit = Apparel.resolveHit({
    equipment: eq,
    getItem,
    part: heart,
    damage: 10,
    damageType: "sharp",
    armorPen: 0,
    random: rngSeq([0.5])
});
assert(!hit.glanced && !hit.deflected && hit.damage === 10, "high roll no effect");
assert(hit.damageType === "sharp", "unaffected stays sharp");

eq.head = { id: "fake_outer", quantity: 1 };
const getItem2 = (id) => {
    if (id === "fake_outer") {
        return {
            id: "fake_outer",
            name: "Outer",
            durability: 100,
            equip: {
                slot: "head",
                layer: "outer",
                covers: ["torso"],
                armor: { sharp: 2, blunt: 2 }
            }
        };
    }
    return DataStore.getItem(id);
};
hit = Apparel.resolveHit({
    equipment: eq,
    getItem: getItem2,
    part: heart,
    damage: 10,
    damageType: "sharp",
    armorPen: 0,
    random: rngSeq([0.5])
});
assert(hit.deflected && hit.rolled.length === 1, "outer 200% always deflects; inner not rolled");
assert(hit.rolled[0].def.id === "fake_outer", "outer first");

eq.head = null;
eq.torso = { id: "leaf_wrap", quantity: 1 };
let broke = Apparel.applyRolledWear(
    eq,
    [{ key: "torso", stack: eq.torso, def: wrap, wear: 60 }],
    getItem,
    Durability
);
assert(broke.length === 1 && broke[0].key === "torso", "full wear destroys");
assert(eq.torso == null, "slot cleared");

eq.torso = { id: "leaf_wrap", quantity: 1 };
Apparel.applyRolledWear(
    eq,
    [{ key: "torso", stack: eq.torso, def: wrap, wear: 2.5 }],
    getItem,
    Durability
);
assert(eq.torso && Math.abs(eq.torso.durability - 57.5) < 1e-6, "partial wear writes remaining");

eq.torso = { id: "leaf_wrap", quantity: 1 };
Apparel.applyDeathWear(eq, getItem, rngSeq([0]), Durability);
const rem = Durability.remainingDurability(eq.torso, wrap);
assert(rem > 60 * 0.59 && rem < 60 * 0.86, `death wear 15-40% (got ${rem})`);

eq.torso = { id: "leaf_wrap", quantity: 1 };
Apparel.applyDailyWear(eq, getItem, rngSeq([0.1]), Durability);
assert(Math.abs(Durability.remainingDurability(eq.torso, wrap) - 59) < 1e-6, "daily 40% chance of 1 HP");
eq.torso = { id: "leaf_wrap", quantity: 1 };
Apparel.applyDailyWear(eq, getItem, rngSeq([0.9]), Durability);
assert(eq.torso.durability == null, "daily miss leaves full");

assert(Apparel.isDayBoundary(1440), "day boundary");
assert(!Apparel.isDayBoundary(1441), "not day boundary");
assert(!Apparel.isDayBoundary(0), "zero not a boundary");

const lines = Apparel.armorTooltipLines(wrap);
assert(lines.some((l) => /12% sharp/.test(l)), "tooltip sharp");
assert(lines.some((l) => /torso/.test(l) && /right shoulder/.test(l)), "tooltip covers");

eq.torso = { id: "leaf_wrap", quantity: 1 };
const coverLines = Apparel.coveringTooltipLines(eq, getItem, heart);
assert(coverLines.length === 1 && /Leaf Wrap/.test(coverLines[0]), "covering tooltip");

GameMath.setRng(() => 0.5);
const player = createPlayerCreature(
    {
        id: "p-armor",
        name: "Armored",
        x: 0,
        y: 0,
        facing: "right",
        inventory: [null, null, null, null, null],
        hotbarIndex: 0,
        equipment: {
            head: null,
            torso: { id: "leaf_wrap", quantity: 1 },
            legs: null,
            feet: null,
            back: null,
            waist: []
        }
    },
    DataStore,
    { worldMinuteIndex: () => 100 }
);
player.anatomy.rollLimb = () => player.anatomy.part("Heart") || player.anatomy.core;
const before = Durability.remainingDurability(player.equipment.torso, wrap);
const attacker = createPlayerCreature(
    {
        id: "p-atk",
        name: "Stabber",
        x: 0,
        y: 0,
        inventory: [null, null, null, null, null],
        hotbarIndex: 0
    },
    DataStore,
    { worldMinuteIndex: () => 100 }
);
const result = BodyCombat.applyHit(attacker, player, {
    damage: 8,
    type: "sharp",
    verb: "thrust",
    weaponName: "stick",
    unarmed: false,
    def: { variance: 0 },
    sourcePart: { name: "hand" }
});
assert(result, "applyHit returned");
const after = player.equipment.torso
    ? Durability.remainingDurability(player.equipment.torso, wrap)
    : 0;
assert(after < before, "applyHit wore wrap on torso hit");

const hideTunic = DataStore.getItem("hide_tunic");
const leatherTunic = DataStore.getItem("leather_tunic");
const hideLoin = DataStore.getItem("hide_loincloth");
const leatherKilt = DataStore.getItem("leather_kilt");
assert(hideTunic && leatherTunic && hideLoin && leatherKilt, "missing hide/leather clothes");
assert(hideTunic.equip.layer === "middle" && hideTunic.durability === 110, "hide tunic def");
assert(Math.abs(hideTunic.equip.armor.sharp - 0.32) < 1e-9, "hide tunic sharp");
assert(Math.abs(leatherTunic.equip.armor.sharp - 0.5) < 1e-9, "leather tunic sharp");
assert(leatherKilt.recipe.leaf_cord === 5, "leather kilt 5 cord");
assert(hideLoin.equip.effects.addSlot.length === 2, "hide loin waist slots");
assert(leatherKilt.equip.effects.addSlot.length === 2, "leather kilt waist slots");
assert(Apparel.itemCoversPart(hideTunic, heart), "hide tunic covers heart");
assert(Apparel.itemCoversPart(hideTunic, rShoulder), "hide tunic covers right shoulder");
assert(Apparel.itemCoversPart(hideTunic, lShoulder), "hide tunic covers left shoulder");
assert(!Apparel.itemCoversPart(hideTunic, lArm), "hide tunic skips arms");
assert(Apparel.itemCoversPart(leatherKilt, lLeg), "kilt covers legs");
assert(wrap.equip.slot === hideTunic.equip.slot, "wrap + hide tunic same torso slot");
assert(loin.equip.slot === leatherKilt.equip.slot, "loin + kilt same legs slot");
assert(!Apparel.occupancyConflict(hideTunic, hideLoin), "tunic + loin ok");

const Carry = require("../shared/carry");
Carry.resolveCraftedWeights(DataStore._store.itemsList);
assert(Math.abs(DataStore.getItem("deer_hide_dry").weight - 1.2) < 1e-9, "dried hide 1.2");
assert(Math.abs(DataStore.getItem("deer_leather").weight - 1.2) < 1e-9, "leather 1.2");
assert(Math.abs(DataStore.getItem("leaf_cord").weight - 0.05) < 1e-9, "cord inherits leaves");
assert(Math.abs(DataStore.getItem("hide_pouch").weight - 1.4) < 1e-9, `pouch inherit (${DataStore.getItem("hide_pouch").weight})`);
assert(Math.abs(DataStore.getItem("hide_tunic").weight - 4) < 1e-9, `hide tunic inherit (${DataStore.getItem("hide_tunic").weight})`);
assert(Math.abs(DataStore.getItem("hide_loincloth").weight - 2.65) < 1e-9, "hide loin inherit");
assert(Math.abs(DataStore.getItem("leather_kilt").weight - 2.65) < 1e-9, "kilt inherit");
assert(Math.abs(DataStore.getItem("leather_tunic").weight - 4) < 1e-9, "leather tunic inherit");
assert(Math.abs(DataStore.getItem("leather_pack").weight - 3.9) < 1e-9, "pack inherit");
assert(Math.abs(DataStore.getItem("hide_bundle").weight - 2.7) < 1e-9, "bundle inherit");
assert(!DataStore.getItem("hide_pouch").weightFixed, "pouch not weightFixed");



});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Content = require("../shared/mods/content");
const CharacterStore = require("../js/net/CharacterStore");

const ROOT = path.resolve(__dirname, "..");
Content.boot({ mods: false, root: ROOT });

const { SimWorld } = require("../shared/sim/SimWorld");

const SPEAR = "example.mod.token";
const KNIFE = "example.mod.other";
const BOUND = "example.mod.bound";
const BASKET = "example.mod.marker";
const TECH = "example.mod.studies";

function savedWorld() {
    return {
        v: 1,
        genVersion: 2,
        seed: 9,
        mods: [{ id: "example.mod", version: "1.0.0" }],
        contentHash: "not-the-live-hash",
        chunks: {
            "0,0": {
                x: 0,
                y: 0,
                things: [{
                    id: "wicker_basket",
                    uid: "chest1",
                    x: 24,
                    y: 24,
                    slots: [{ id: SPEAR, quantity: 1 }, null, null, null, null, null, null, null]
                }, {
                    id: BASKET,
                    uid: "basket1",
                    x: 40,
                    y: 24
                }],
                lootableThings: [],
                drops: [],
                mobs: [{ id: "example.mod.not_a_mob", uid: "mob-example", x: 32, y: 32 }],
                corpses: []
            }
        },
        settlements: [{
            id: "camp-flint",
            name: "Camp",
            techs: { [TECH]: true }
        }]
    };
}

test("a missing mod warns and leaves world content in place", () => {
    const loaded = SimWorld.loadFromData(savedWorld(), { worldName: "missing-mod" });
    assert.deepEqual(loaded.contentWarnings, [
        "Missing mod example.mod@1.0.0. World content from that mod is left in place."
    ]);
    const warning = loaded.contentWarnings[0];
    assert.equal(warning.includes("does not match the loaded mods"), false);
    assert.equal(warning.includes("REJECT"), false);
    const chunk = loaded.chunks.get("0,0");
    assert.equal(chunk.things[0].slots[0].id, SPEAR);
    assert.equal(chunk.things[1].id, BASKET);
    assert.equal(chunk.mobs[0].id, "example.mod.not_a_mob");
    assert.equal(loaded.mobs.get("mob-example").aiType, "doofus");
    assert.equal(loaded.settlements[0].techs[TECH], true);
    assert.equal(require("../shared/DataStore").getItem(SPEAR), null);
});

test("unknown character gear is quarantined, reported on YOU, and kept by applyYou", () => {
    const world = SimWorld.createNew({ worldName: "quarantine" });
    const snap = CharacterStore.toJoinSnapshot({
        id: "leader00000001",
        name: "Leader",
        inventory: [
            { id: SPEAR, quantity: 1 },
            { id: "stick", quantity: 2 },
            null, null, null
        ],
        overflow: [{ id: KNIFE, quantity: 1 }],
        equipment: {
            head: null,
            torso: { id: BOUND, quantity: 1 },
            legs: null,
            feet: null,
            back: null,
            waist: []
        },
        quarantine: [{ id: "missing.mod.kept", quantity: 1 }],
        techs: { gathering: true, [TECH]: true },
        party: [{
            id: "companion00001",
            name: "Pal",
            inventory: [{ id: BASKET, quantity: 1 }, { id: "stick", quantity: 1 }, null, null, null],
            quarantine: [{ id: "missing.mod.party", quantity: 1 }],
            techs: { gathering: true, [TECH]: true }
        }]
    });
    assert.equal(snap.quarantine[0].id, "missing.mod.kept");
    assert.equal(snap.party[0].quarantine[0].id, "missing.mod.party");

    const pawn = world.addPlayer(snap.id, snap.name, snap, { silentJoin: true });
    assert.equal(pawn.inventory.some((s) => s?.id === SPEAR), false);
    assert.equal(pawn.inventory.some((s) => s?.id === "stick"), true);
    assert.equal(pawn.overflow.some((s) => s?.id === KNIFE), false);
    assert.equal(pawn.equipment.torso, null);
    const ids = pawn.quarantine.map((s) => s.id);
    assert.ok(ids.includes("missing.mod.kept"));
    assert.ok(ids.includes(SPEAR));
    assert.ok(ids.includes(KNIFE));
    assert.ok(ids.includes(BOUND));
    assert.equal(world._held(pawn)?.id, undefined);
    assert.ok(!world._itemDef(SPEAR));

    const pal = pawn.party[0];
    assert.equal(pal.inventory.some((s) => s?.id === BASKET), false);
    assert.equal(pal.inventory.some((s) => s?.id === "stick"), true);
    assert.ok(pal.quarantine.map((s) => s.id).includes(BASKET));
    assert.ok(pal.quarantine.map((s) => s.id).includes("missing.mod.party"));
    assert.equal(pawn.techs.gathering, true);
    assert.equal(pawn.techs[TECH], undefined);
    assert.equal(pal.techs.gathering, true);
    assert.equal(pal.techs[TECH], undefined);

    const you = world.youPayload(pawn.id);
    assert.ok(you.quarantine.map((s) => s.id).includes(SPEAR));
    assert.ok(you.party[0].quarantine.map((s) => s.id).includes(BASKET));
    assert.equal(you.techs[TECH], undefined);
    assert.equal(you.inventory.some((s) => s?.id === SPEAR), false);

    const character = CharacterStore.defaultCharacter("Leader");
    character.id = pawn.id;
    const stored = CharacterStore.applyYou(character, you);
    assert.ok(stored.quarantine.map((s) => s.id).includes(SPEAR));
    assert.ok(stored.party[0].quarantine.map((s) => s.id).includes(BASKET));
    const autosaved = CharacterStore.applyYou(stored, you);
    assert.ok(autosaved.quarantine.map((s) => s.id).includes(SPEAR));
    assert.ok(autosaved.quarantine.map((s) => s.id).includes(KNIFE));
    assert.ok(autosaved.quarantine.map((s) => s.id).includes(BOUND));
    assert.equal(autosaved.inventory.some((s) => s?.id === SPEAR), false);
    assert.equal(autosaved.equipment.torso, null);
});

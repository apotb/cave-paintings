const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Protocol = require("../shared/protocol");
const Content = require("../shared/mods/content");

const ROOT = path.resolve(__dirname, "..");
Content.boot({ root: ROOT, modsDir: path.join(ROOT, "mods") });

const { SimWorld } = require("../shared/sim/SimWorld");

const TOKEN = "cavepaintings.examplemod.token";
const MARKER = "cavepaintings.examplemod.marker";

function chestChunk() {
    return {
        cx: 1,
        cy: 1,
        tiles: [],
        things: [{
            id: "wicker_basket",
            uid: "chest1",
            x: 40,
            y: 40,
            slots: [
                { id: TOKEN, quantity: 1 },
                null, null, null, null, null, null, null
            ]
        }, {
            id: MARKER,
            uid: "basket1",
            x: 56,
            y: 40
        }],
        lootableThings: [],
        drops: [],
        mobs: [{
            id: "example.mod.not_a_mob",
            uid: "mob-example",
            x: 48,
            y: 48
        }],
        corpses: [],
        bloodStains: [],
        generated: true
    };
}

test("old save without mods loads, and an example save round-trips one content hash", () => {
    const old = SimWorld.loadFromData({
        v: 1,
        genVersion: 2,
        seed: 3,
        chunks: {
            "0,0": {
                x: 0,
                y: 0,
                things: [{ id: "rock", x: 8, y: 8 }],
                lootableThings: [],
                drops: [],
                mobs: [],
                corpses: []
            }
        }
    }, { worldName: "old" });
    assert.deepEqual(old.contentWarnings, []);
    assert.equal(old.chunks.get("0,0").things[0].id, "rock");

    const world = SimWorld.createNew({ worldName: "phase3" });
    world.modData = { note: "keep" };
    world.chunks.set("1,1", chestChunk());
    const saved = world.toSaveData();
    assert.equal(saved.v, 1);
    assert.equal(Protocol.PROTOCOL_VERSION, 2);
    assert.deepEqual(saved.mods, [{ id: "cavepaintings.examplemod", version: "1.0.0" }]);
    assert.equal(saved.contentHash, Content.simHash());
    assert.equal(saved.mods[0].hash, undefined);
    assert.equal(saved.modHashes, undefined);
    assert.deepEqual(saved.modData, { note: "keep" });
    assert.equal(saved.chunks["1,1"].things[0].slots[0].id, TOKEN);

    const loaded = SimWorld.loadFromData(saved, { worldName: "phase3" });
    assert.deepEqual(loaded.contentWarnings, []);
    assert.equal(loaded.chunks.get("1,1").things[0].slots[0].id, TOKEN);
    assert.equal(loaded.chunks.get("1,1").things[1].id, MARKER);
    assert.equal(loaded.modData.note, "keep");
    assert.equal(loaded.toSaveData().v, 1);
});

test("content hash mismatch warns without rejecting or stripping the chest", () => {
    const world = SimWorld.createNew({ worldName: "phase3-mismatch" });
    world.chunks.set("1,1", chestChunk());
    const saved = world.toSaveData();
    saved.contentHash = "abc";
    const loaded = SimWorld.loadFromData(saved, { worldName: "phase3-mismatch" });
    assert.equal(loaded.contentWarnings.length, 1);
    const warning = loaded.contentWarnings[0];
    assert.match(warning, /Saved simulation content does not match the loaded mods/);
    assert.match(warning, /saved hash abc/);
    assert.match(warning, new RegExp(Content.simHash()));
    assert.match(warning, /World content is left in place/);
    assert.equal(warning.includes("Missing mod"), false);
    assert.equal(warning.includes("REJECT"), false);
    assert.equal(loaded.chunks.get("1,1").things[0].slots[0].id, TOKEN);
});

test("a loaded mod restores quarantined stacks into free slots and leaves the rest", () => {
    const world = SimWorld.createNew({ worldName: "phase3-restore" });
    const restored = world.addPlayer("restore000001", "Restored", {
        inventory: [null, null, null, null, null],
        quarantine: [
            { id: TOKEN, quantity: 1 },
            { id: TOKEN, quantity: 1 }
        ]
    }, { silentJoin: true });
    assert.deepEqual(restored.quarantine, []);
    assert.equal(restored.inventory[0].id, TOKEN);
    assert.equal(restored.inventory[1].id, TOKEN);

    const full = world.addPlayer("restore000002", "Full", {
        inventory: [
            { id: "stick", quantity: 1 },
            { id: "stick", quantity: 1 },
            { id: "stick", quantity: 1 },
            { id: "stick", quantity: 1 },
            { id: "stick", quantity: 1 }
        ],
        quarantine: [{ id: TOKEN, quantity: 1 }]
    }, { silentJoin: true });
    assert.equal(full.quarantine[0].id, TOKEN);
    assert.equal(full.inventory.some((s) => s?.id === TOKEN), false);

    const held = world.addPlayer("restore000003", "Held", {
        inventory: [{ id: TOKEN, quantity: 1 }, null, null, null, null]
    }, { silentJoin: true });
    assert.deepEqual(held.quarantine, []);
    assert.equal(held.inventory[0].id, TOKEN);
});

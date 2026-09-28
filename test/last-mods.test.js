const { test } = require("node:test");
const assert = require("node:assert/strict");
const LastMods = require("../js/net/lastMods");
const CharacterStore = require("../js/net/CharacterStore");
const WorldStore = require("../js/net/WorldStore");

const EXAMPLE = { id: "cavepaintings.examplemod", name: "Example Mod" };
const FLINT = { id: "example.flint_tools", name: "Flint Tools" };

test("missing lastMods is not a difference", () => {
    assert.equal(LastMods.hasRecord({}), false);
    assert.equal(LastMods.diff(undefined, [EXAMPLE]), null);
    assert.equal(LastMods.diff(null, [EXAMPLE]), null);
    assert.deepEqual(LastMods.lines(null), []);
});

test("id membership ignores order and keeps an empty snapshot", () => {
    assert.equal(LastMods.diff([EXAMPLE, FLINT], [FLINT, EXAMPLE]), null);
    assert.equal(LastMods.diff([], []), null);
    assert.equal(LastMods.hasRecord({ lastMods: [] }), true);
    const added = LastMods.diff([], [FLINT, EXAMPLE]);
    assert.deepEqual(added.added.map((mod) => mod.id), [FLINT.id, EXAMPLE.id]);
    assert.deepEqual(added.removed, []);
});

test("tooltip lines prefix added then removed by display name", () => {
    const change = LastMods.diff(
        [{ id: EXAMPLE.id, name: "Example Mod" }, { id: "gone.mod", name: "Old Basket" }],
        [FLINT, { id: EXAMPLE.id, name: "Renamed In The Save" }]
    );
    assert.deepEqual(
        LastMods.lines(change, { [EXAMPLE.id]: "Example Mod", [FLINT.id]: "Flint Tools" }),
        ["+ Flint Tools", "- Old Basket"]
    );
});

test("removed mods fall back to the saved name, then the id", () => {
    const change = LastMods.diff(
        [{ id: "z.mod" }, { id: "named.mod", name: "Amber" }],
        []
    );
    assert.deepEqual(LastMods.lines(change), ["- Amber", "- z.mod"]);
});

test("character import keeps a mod snapshot and leaves old files unmarked", () => {
    const stamped = CharacterStore.importJson(CharacterStore.exportJson({
        id: "char-1",
        name: "Og",
        lastMods: [EXAMPLE, { id: EXAMPLE.id, name: "duplicate" }, { name: "no id" }, null]
    }));
    assert.deepEqual(stamped.lastMods, [EXAMPLE]);

    const old = CharacterStore.importJson(CharacterStore.exportJson({
        id: "char-2",
        name: "Bo"
    }));
    assert.equal(Object.prototype.hasOwnProperty.call(old, "lastMods"), false);
});

test("world import keeps a mod snapshot and leaves old files unmarked", () => {
    const stamped = WorldStore.importJson(WorldStore.exportJson({
        name: "Camp",
        lastMods: [FLINT]
    }));
    assert.deepEqual(stamped.lastMods, [FLINT]);

    const old = WorldStore.importJson(WorldStore.exportJson({ name: "Bare" }));
    assert.equal(Object.prototype.hasOwnProperty.call(old, "lastMods"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(WorldStore.defaultWorld("New"), "lastMods"), false);
});

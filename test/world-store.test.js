const { test } = require("node:test");
const assert = require("node:assert/strict");
const WorldStore = require("../js/net/WorldStore");

test("fresh worlds are never played", () => {
    const w = WorldStore.defaultWorld("Camp");
    assert.equal(w.lastPlayedAt, 0);
    assert.equal(WorldStore.looksPlayed(w), false);
    assert.equal(WorldStore.lastPlayedAt(w), 0);
});

test("stamped lastPlayedAt wins", () => {
    const w = WorldStore.defaultWorld("Camp");
    w.lastPlayedAt = 1_700_000_000_000;
    w.updatedAt = 1_800_000_000_000;
    assert.equal(WorldStore.lastPlayedAt(w), 1_700_000_000_000);
});

test("played worlds missing a stamp fall back to updatedAt", () => {
    const w = WorldStore.defaultWorld("Camp");
    w.lastPlayedAt = 0;
    w.updatedAt = 1_700_000_000_000;
    w.chunks = { "0,0": { x: 0, y: 0, tiles: [] } };
    assert.equal(WorldStore.looksPlayed(w), true);
    assert.equal(WorldStore.lastPlayedAt(w), 1_700_000_000_000);
});

test("clock progress counts as played", () => {
    const w = WorldStore.defaultWorld("Camp");
    w.clock.gameMinutes = 9 * 60;
    w.updatedAt = 42;
    assert.equal(WorldStore.lastPlayedAt(w), 42);
});

test("legacy rows without lastPlayedAt use updatedAt", () => {
    const row = { name: "Old", updatedAt: 99, chunks: {} };
    assert.equal(WorldStore.lastPlayedAt(row), 99);
});

test("import stamps lastPlayedAt when the file looks played", () => {
    const json = WorldStore.exportJson({
        name: "Import",
        chunks: { "0,0": { x: 0, y: 0 } },
        lastPlayedAt: 0,
        updatedAt: 1
    });
    const w = WorldStore.importJson(json);
    assert.ok(w.lastPlayedAt > 0);
    assert.equal(w.lastPlayedAt, w.updatedAt);
});
